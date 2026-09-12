# Fase 1 — checkpoints e como provar cada um

Modo cuidado: nada é mergeado sem os quatro passados. Este arquivo é o
roteiro de verificação, para o teste ser o mesmo em qualquer sessão.

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

### 3.2 Com JWT do cliente A → só a linha de A

```bash
curl -s "$URL/rest/v1/customer_profiles?select=id,user_id,email" \
  -H "apikey: $PUB" -H "Authorization: Bearer $JWT_A"
```

**Esperado:** exatamente 1 linha, a de A.

### 3.3 Com JWT de A, pedindo a linha de B → vazio

```bash
curl -s "$URL/rest/v1/customer_profiles?select=*&id=eq.<ID_DE_B>" \
  -H "apikey: $PUB" -H "Authorization: Bearer $JWT_A"
```

**Esperado: `[]`.** Não 403 — a RLS filtra, não acusa. Repetir com
`user_id=eq.<USER_ID_DE_B>`.

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

---

## C4 — exclusão de conta

- [ ] "Excluir minha conta" no perfil chama a Function `account-delete`
- [ ] A linha em `customer_profiles` **sobrevive**, com `deleted_at`
      preenchido e `email`/`full_name`/`phone`/`linked_accounts`
      anonimizados
- [ ] `user_id` virou `NULL` (é o `ON DELETE SET NULL` — ver o bloco 1 da
      migration, que explica por que não é CASCADE)
- [ ] O usuário sumiu de `auth.users`
- [ ] Login com aquele e-mail falha
- [ ] Pedidos no `localStorage` continuam intactos (retenção fiscal)
- [ ] Nenhum PII no log da Function (padrão `safeDetail` do reload: do
      erro do PostgREST só o SQLSTATE)

---

## Merge

Só depois do C4 aprovado. Antes do commit final:

```bash
grep -rInE 'sb_secret|re_[A-Za-z0-9_-]{20,}|service_role|eyJhbGciOi' \
  --exclude-dir=.git --exclude-dir=docs .
```

Único resultado aceitável é o comentário de `netlify/edge-functions/gate.ts`,
que cita o nome da variável, não um valor.
