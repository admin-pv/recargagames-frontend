# Fase 1 — checkpoints e como provar cada um

Modo cuidado: nada é mergeado sem os quatro passados. Este arquivo é o
roteiro de verificação, para o teste ser o mesmo em qualquer sessão.

## Estado

| | Estado | Quando |
|---|---|---|
| **C1** migration | ✅ passado | 11/09 — 16 colunas, RLS on, 2 policies, 9 colunas com UPDATE, 2 triggers, anon zerado |
| **C2** fluxo completo | ✅ passado | 12/09 — com OTP de 6 dígitos, depois do incidente do scanner |
| **C3** RLS por curl | ✅ passado | 12/09 — ver "Resultado" em cada item |
| **C4** exclusão de conta | 🟡 parcial | 12/09 — lado cliente provado; falta a conferência SQL da linha (só a secret key a enxerga) |

Contas de teste usadas no C3: `vinicius.esteves+5678@gmail.com` (A) e
`vinicius.esteves+1234@gmail.com` (B). **Nenhum token entrou neste repo** —
foram passados por chat, usados em variável de ambiente e destruídos.

**Convenção:** `$URL` = URL do projeto Supabase. `$PUB` = publishable key
`storefront_v1`. `$JWT_A` / `$JWT_B` = access tokens de dois clientes
diferentes. Nenhum desses valores entra neste repo — pegue do arquivo
local de credenciais e do DevTools (Application → Local Storage → a chave
`sb-*-auth-token`, campo `access_token`).

---

## C1 — migration escrita e aplicada

**Antes de aplicar:** rodar o bloco 0 (PRÉ-VOO) de
`supabase/migrations/0002_customer_profiles.sql` e ler a saída.

Condição de parada, definida pelo Vinicius em 11/09:

> Se houver um trigger em `auth.users` que insere em `public.profiles` a
> cada usuário novo, a migration precisa garantir que ele **não** conceda
> `user_type = 'admin'` por default. Se conceder, **parar** antes de rodar
> o resto.

Onde isso aparece na saída: query `1b` (corpo da função — procure por
`user_type`) e query `1c` (default da coluna). O trigger novo desta
migration insere **só** em `customer_profiles` e nunca escreve
`user_type`.

**Depois de aplicar:** rodar o bloco de conferência do fim do arquivo.
Esperado: 16 colunas, `rowsecurity = true`, 2 policies (ambas só para
`authenticated`), 2 triggers, `anon` sem nenhum privilégio.

---

## C2 — fluxo completo no Deploy Preview

> **Mudança de 12/09: cadastro e reset usam CÓDIGO DE 6 DÍGITOS, não link.**
>
> O primeiro cadastro real deu 504 na confirmação. O scanner de links do
> Gmail abriu o `/verify` antes do usuário e gastou o token de uso único.
> Post-mortem completo em
> `docs/incidents/2026-09-otp-link-scanner.md`.
>
> **Pré-requisito deste checkpoint:** os templates "Confirm signup" e
> "Reset password" já atualizados no painel com as versões de
> `docs/email-templates/`. Se o template antigo (com link) ainda estiver
> lá, o e-mail chega sem código e o campo de 6 dígitos não tem o que
> receber.

Feito pelo Vinicius com e-mail próprio, atrás do gate:

- [ ] Cadastro → e-mail chega via Resend, **DKIM pass** (ver cabeçalho original)
- [ ] O e-mail traz um **código de 6 dígitos** e **nenhum link**
- [ ] Digitar o código na tela "Confirme seu e-mail" cria a sessão
- [ ] Código errado mostra "código inválido ou expirado" e não derruba a tela
- [ ] "Reenviar código" manda outro, e o novo funciona
- [ ] Confirma → loga
- [ ] Onboarding de 3 passos aparece e grava (`onboarding_done` vira true)
- [ ] Sair e logar de novo **não** repete o onboarding
- [ ] Edita dados pessoais → recarrega → persistiu
- [ ] Salva um ID de jogo → aparece pré-preenchido no `product.html`
- [ ] Troca de senha → desloga → entra com a senha nova
- [ ] Reset de senha → e-mail com código → digitar o código abre o painel
      "Escolha uma nova senha" → senha nova funciona
- [ ] Resposta do "esqueci minha senha" é a mesma para e-mail existente e
      inexistente (não revela cadastro) — **inclusive o reenvio**, que
      devolve a mesma confirmação nos dois casos

---

## C3 — RLS por curl

Mesmo padrão da Dívida #1. Os quatro primeiros são o brief original; o
quinto foi acrescentado pelo Vinicius em 11/09.

### 3.1 Sem JWT, só com a publishable key → nada

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "$URL/rest/v1/customer_profiles?select=*" \
  -H "apikey: $PUB" -H "Authorization: Bearer $PUB"
```

**Esperado: 401.** Não 200 com `[]`. A migration faz
`REVOKE ALL ... FROM anon` justamente para o Postgres negar antes da RLS
— lista vazia seria "existe e está vazia", 401 é "você não tem nada aqui".

**Resultado 12/09 ✅** — GET, POST, PATCH e DELETE todos `401`, com
`42501 permission denied for table customer_profiles`. O REVOKE está
fazendo o Postgres negar antes de a RLS ser consultada.

### 3.2 Com JWT do cliente A → só a linha de A

```bash
curl -s "$URL/rest/v1/customer_profiles?select=id,user_id,email" \
  -H "apikey: $PUB" -H "Authorization: Bearer $JWT_A"
```

**Esperado:** exatamente 1 linha, a de A.

**Resultado 12/09 ✅** — 1 linha para A, 1 para B, cada um só a própria.
De quebra confirma o trigger: `full_name` chegou de
`raw_user_meta_data` ("Vini 5678" / "Vini 1234").

### 3.3 Com JWT de A, pedindo a linha de B → vazio

```bash
curl -s "$URL/rest/v1/customer_profiles?select=*&id=eq.<ID_DE_B>" \
  -H "apikey: $PUB" -H "Authorization: Bearer $JWT_A"
```

**Esperado: `[]`.** Não 403 — a RLS filtra, não acusa. Repetir com
`user_id=eq.<USER_ID_DE_B>`.

**Resultado 12/09 ✅** — `[]`. E sem filtro nenhum, A enxerga 1 linha (a
dele), não 2.

**Cuidado ao ler o PATCH cruzado:** tentar alterar a linha de B com o
token de A devolve **`200` com corpo `[]`**, não um erro. Isso é a RLS
filtrando — zero linhas casaram, zero foram alteradas. Um `200` aqui
pode ser lido como sucesso por engano, então o teste foi fechado lendo a
linha de B com o token de B: `full_name` continuava `"Vini 1234"`,
intacta.

### 3.4 INSERT com JWT válido → falha

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "$URL/rest/v1/customer_profiles" \
  -H "apikey: $PUB" -H "Authorization: Bearer $JWT_A" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"<qualquer>","email":"x@x.com"}'
```

**Esperado: 401 ou 403.** Não há policy de INSERT: perfil nasce só pelo
trigger.

**Resultado 12/09 ✅** — INSERT `403 42501`, DELETE da própria linha
`403`.

### 3.4b GRANT por coluna

Acrescentado na revisão de 11/09. Com o token de A, tentar escrever cada
coluna fora da whitelist:

| Coluna | Resultado 12/09 |
|---|---|
| `email` | `403 42501` ✅ |
| `user_id` | `403 42501` ✅ |
| `country_code` | `403 42501` ✅ |
| `deleted_at` | `403 42501` ✅ |
| `created_at` | `403 42501` ✅ |
| `updated_at` | `403 42501` ✅ |
| `full_name` (controle positivo) | `204` ✅ |

O controle positivo importa tanto quanto os negativos: sem ele, um GRANT
quebrado que negasse tudo passaria como "muito seguro".

Vale também tentar o UPDATE que o `WITH CHECK` fecha — deve falhar:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH \
  "$URL/rest/v1/customer_profiles?user_id=eq.<USER_ID_DE_A>" \
  -H "apikey: $PUB" -H "Authorization: Bearer $JWT_A" \
  -H "Content-Type: application/json" \
  -d '{"deleted_at":"2020-01-01T00:00:00Z"}'
```

### 3.5 `is_admin()` com JWT de cliente → false

> Condição do Vinicius, 11/09: confirmar que `is_admin()` devolve `false`
> para um **JWT de cliente**, não só para anon.

```bash
curl -s -X POST "$URL/rest/v1/rpc/is_admin" \
  -H "apikey: $PUB" -H "Authorization: Bearer $JWT_A" \
  -H "Content-Type: application/json" -d '{}'
```

**Esperado: `false`.**

Já verificado nesta sessão que anon devolve `false`. O caso do cliente é
diferente e é o que importa: um cliente **tem** `auth.uid()`, então se
`is_admin()` testar apenas "existe sessão" em vez de "existe linha com
`user_type='admin'`", ele passaria. Um `true` aqui significa que cadastrar-se
na loja dá acesso ao painel e a todas as tabelas `pv_*` e
`bonus_vouchers` — **parar tudo e tratar como incidente.**

Complemento, se o pré-voo do C1 mostrou que um trigger cria linha em
`profiles` para todo usuário novo — confirmar que a linha do cliente
nasceu sem privilégio:

```bash
curl -s "$URL/rest/v1/profiles?select=id,user_type" \
  -H "apikey: $PUB" -H "Authorization: Bearer $JWT_A"
```

**Esperado:** `[]` (se `profiles` não abre leitura ao próprio dono) ou uma
linha com `user_type` diferente de `admin`. **Nunca** `"admin"`.

**Resultado 12/09 ✅** — `is_admin()` devolveu `false` para A, para B e
para anon. `profiles` com JWT de cliente devolveu `[]`: **o cliente não
tem linha lá**, que é exatamente o que fecha o caminho de auto-promoção
descrito em `docs/divida-tecnica-2-rls.md`. `admin_users`, de onde
`is_admin()` lê, também devolveu `[]`.

---

## C4 — exclusão de conta

Executado em 12/09 com a conta B (`vinicius.esteves+1234@gmail.com`),
chamando a Function direto no Deploy Preview com o JWT dela.

**Estado ANTES**, para comparação — `profile.id`
`9f6dc340-227b-4b22-955b-59a24808f409`, `user_id`
`27baa35f-710f-48b3-a243-ffe7262baead`, `email`
`vinicius.esteves+1234@gmail.com`, `full_name` `Vini 1234`,
`linked_accounts` com um ID de Free Fire salvo no C2, `deleted_at` `null`.

### Provado pelo lado do cliente ✅

- [x] Function devolveu `200 {"ok":true}`
- [x] **Usuário sumiu de `auth.users`** — `GET /auth/v1/user` com o mesmo
      JWT passou a devolver `403 user_not_found`
      ("User from sub claim in JWT does not exist")
- [x] **A linha ficou invisível para o antigo dono** — `GET
      customer_profiles` com o JWT de B devolve `[]`. É a consequência
      direta de `user_id` virar `NULL`: a policy exige
      `user_id = auth.uid()`, e `auth.uid()` nunca é NULL
- [x] **Login com aquele e-mail falha** — `400 invalid_credentials`
- [x] **Idempotente** — chamar a Function de novo devolve `401
      invalid_token`, não erro 500. Um duplo-clique no botão não vira
      incidente

### Só a secret key enxerga — conferir no SQL Editor

A linha anonimizada é invisível para qualquer token de cliente **por
desenho**. Isso significa que o item mais importante do C4 não pode ser
provado por curl com a publishable key. Rode:

```sql
SELECT id, user_id, email, full_name, phone,
       linked_accounts, notifications, deleted_at, created_at, updated_at
  FROM public.customer_profiles
 WHERE id = '9f6dc340-227b-4b22-955b-59a24808f409';
```

Esperado, linha a linha:

| Coluna | Esperado |
|---|---|
| (a linha) | **existe** — 1 resultado, não 0. Se vier 0, o `ON DELETE SET NULL` virou CASCADE em algum lugar e o histórico da Fase 2 está em risco |
| `user_id` | `NULL` |
| `email` | `deleted+27baa35f@invalid.local` |
| `full_name` | `[excluído a pedido do titular]` |
| `phone` | `NULL` |
| `linked_accounts` | `[]` — **o ID de Free Fire tem que ter sumido** |
| `notifications` | `{}` |
| `deleted_at` | timestamp de 12/09 |
| `created_at` | inalterado |

E que o usuário não existe mais:

```sql
SELECT count(*) FROM auth.users
 WHERE id = '27baa35f-710f-48b3-a243-ffe7262baead';   -- esperado: 0
```

### Também fora do meu alcance

- [ ] **Log da Function sem PII** — Netlify → Functions → `account-delete`
      → logs. Esperado: `account-delete: ok ref=27baa35f` e nada mais.
      Nenhum e-mail, nome, telefone ou corpo de erro do PostgREST
- [ ] **Pedidos no `localStorage` intactos** — é o navegador em que você
      testou. Abrir `my-orders.html` logado com a conta A e confirmar que
      a lista continua lá. (Enquanto os pedidos forem locais, eles nem
      passam perto da exclusão — ver o cabeçalho FASE 2 do `store.js`)

---

## Merge

Só depois do C4 aprovado. Antes do commit final:

```bash
grep -rInE 'sb_secret|re_[A-Za-z0-9_-]{20,}|service_role|eyJhbGciOi' \
  --exclude-dir=.git --exclude-dir=docs .
```

Único resultado aceitável é o comentário de `netlify/edge-functions/gate.ts`,
que cita o nome da variável, não um valor.
