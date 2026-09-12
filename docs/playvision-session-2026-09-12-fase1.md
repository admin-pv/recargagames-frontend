# Playvision — Log de Sessão 11–12/09/2026 (Frontend / Fase 1)

**Foco:** trocar a sessão e o perfil falsos do protótipo por Supabase Auth
de verdade. Pedidos ficam em `localStorage` até a Fase 2.
**Modo:** cuidado — toca auth, dado pessoal e RLS. Migration escrita no
repo e aplicada pelo Vinicius, quatro checkpoints, nada mergeado sem o C4.
**Repo:** `admin-pv/recargagames-frontend` · **Branch:** `feat/customer-auth`
· **PR:** #3 · 12 commits, 32 arquivos, +3205 −295.
**Motivador:** a Fase 0 subiu um frontend cujo "login" não checava senha
nenhuma. Enquanto isso for verdade, nada acima dele pode ser construído.

> **Estrutura:** §1 é o que mudou. §2–§6 são as decisões de banco e de
> arquitetura. §7 os dois incidentes. §8 os bugs. §9 a validação. §10 o
> rollback. §11–§13 fecham.

---

## Resumo executivo

- **Entregue, testado, não mergeado.** Cadastro, confirmação por código,
  login, logout, reset, troca de senha, perfil persistido e exclusão LGPD
  funcionando no Deploy Preview, atrás do gate.
- **A migration não criou `public.profiles`** — essa tabela **já existia**
  e é a identidade do painel admin. O storefront ganhou
  `customer_profiles`, e nada existente foi tocado (§2).
- **Dois desvios do brief, ambos porque a instrução era internamente
  contraditória ou perigosa:** a PK não referencia `auth.users`
  (§3), e o `GRANT UPDATE` é por coluna (§4, revisão do Vinicius).
- 🔴 **Achado de segurança fora deste repo:** existe um caminho de
  auto-promoção a admin em `public.profiles`. A Fase 1 **não o abre nem o
  alarga**, e isso foi provado por curl (§5).
- 🔴 **Incidente em produção-adjacente:** o scanner de links do Gmail
  consumiu o token de confirmação antes do usuário. Cadastro e reset
  passaram a usar **código de 6 dígitos** (§7.1).
- **O header mentia em 15 páginas** — dizia "Cadastre-se" para quem já
  estava logado (§7.2).
- **Quatro bugs do fornecedor** corrigidos no caminho, um deles capaz de
  fazer o comprador pagar pelo produto errado (§8).
- **C1, C2 e C3 passados. C4 parcial** — o lado cliente está provado; a
  linha anonimizada só a secret key enxerga, e essa chave não é minha
  (§9).
- **Gasto: zero.** Nenhum pagamento, nenhuma escrita em tabela existente.
  Duas contas de teste criadas, uma delas destruída no C4.

---

## 1. O que mudou

```
supabase/migrations/0002_customer_profiles.sql   NOVO — 455 linhas, aplicada em 11/09
netlify/functions/account-delete.mjs             NOVO — primeira Function do repo
app/shared/js/supabase-client.js                 NOVO — a chave publishable, num lugar só
app/shared/js/header-session.js                  NOVO — o botão de conta, nas 18 páginas
app/shared/js/store.js                           sessão e perfil viraram async
app/shared/js/market.js                          formatMoney / formatDate / pagePath
app/account-login.html                           auth real, OTP, painel de nova senha
app/account-profile.html                         perfil no servidor, senha real, exclusão
app/*.html (16)                                  header-session + pilha de scripts
robots.txt                                       NOVO — Disallow: / enquanto o gate existir
docs/email-templates/                            NOVO — 4 templates pt-BR
docs/fase1-checkpoints.md                        NOVO — roteiro + resultados
docs/divida-tecnica-2-rls.md                     NOVO — a dívida #2 e o achado
docs/incidents/2026-09-otp-link-scanner.md       NOVO — post-mortem
```

---

## 2. A decisão central: `customer_profiles`, não `profiles`

**A premissa do brief não se sustentou.** A Tarefa 1 mandava criar
`public.profiles`. Uma sondagem antes de escrever uma linha de SQL mostrou
que a tabela **já existia**, com `id`, `email`, `full_name`, `created_at`
e — decisivo — **`user_type`**.

`user_type` é a coluna que quatro policies de escrita do admin consultam.
Um `CREATE TABLE` falharia; um `DROP`+`CREATE` derrubaria o login do
painel e, por tabela, `bonus_vouchers` e todas as `pv_*` do reload.

Levado como A/B. Decisão: **tabela nova, `profiles` intocada.** Separação
de identidade — `profiles` é quem opera a loja, `customer_profiles` é quem
compra nela.

**O que isso comprou além da segurança:** os dois grupos têm ciclos de
vida diferentes. Um admin não é excluído por pedido LGPD do titular; um
cliente é. Misturar os dois na mesma tabela faria a Function de exclusão
operar perto de linhas de admin.

### Nomes escolhidos para não colidir

Os nomes da documentação do Supabase — `handle_new_user()`,
`on_auth_user_created` — provavelmente estariam ocupados. Um
`CREATE OR REPLACE` neles trocaria o comportamento do admin **em
silêncio**. Tudo leva sufixo `_customer_profile`.

O pré-voo depois mostrou que `auth.users` **não tem trigger nenhum**, e
que `is_admin()` lê de `admin_users`, não de `profiles`. A precaução
acabou desnecessária — mas só se sabe disso depois de olhar, e o custo de
errar era o painel inteiro.

---

## 3. A PK não referencia `auth.users` — e por quê

O brief pedia, no mesmo fôlego:

- `id uuid PK REFERENCES auth.users ON DELETE CASCADE`
- uma exclusão que marca `deleted_at`, anonimiza a linha **e** chama
  `auth.admin.deleteUser()`

**As duas coisas não coexistem.** Com CASCADE, apagar o usuário apaga a
linha anonimizada junto — e o C4 ("linha anonimizada" + "auth.users sem o
usuário") vira impossível de verificar.

Solução: PK própria + `user_id uuid UNIQUE REFERENCES auth.users
ON DELETE SET NULL`. A linha **sobrevive**, órfã e anônima:

- o C4 passa a ser verificável exatamente como está escrito;
- a linha fica invisível para todo mundo — a policy exige
  `user_id = auth.uid()`, e `auth.uid()` nunca é NULL para quem está
  logado. Só a Function, com a secret key, a enxerga;
- **na Fase 2**, quando os pedidos virarem tabela, eles apontam para
  `customer_profiles.id`. Com CASCADE, excluir uma conta levaria o
  histórico fiscal junto. Esta escolha é o que evita uma migration
  corretiva depois.

Provado no C4: depois da exclusão, o `GET` com o JWT do antigo dono
devolve `[]`.

---

## 4. `GRANT UPDATE` por coluna, não por tabela

Revisão do Vinicius em 11/09, antes de aplicar. **A policy governa QUAIS
LINHAS; ela não diz nada sobre QUAIS COLUNAS.** Com UPDATE na tabela
inteira, o dono da linha reescreveria qualquer campo dela — inclusive os
que são estado do sistema, não dado de perfil.

```sql
GRANT SELECT ON public.customer_profiles TO authenticated;
GRANT UPDATE (full_name, phone, locale, nickname, favorite_games,
              marketing_opt_in, onboarding_done, linked_accounts,
              notifications) ON public.customer_profiles TO authenticated;
```

Fora do alcance do browser: `user_id` (identidade), `email` (é do GoTrue,
com confirmação), `country_code` (o mercado vem do path, não de escolha do
usuário), `deleted_at` (é da Function), `created_at`, `updated_at`.

**Três tranças sobre a mesma coisa, de propósito:** a policy filtra a
linha, o GRANT filtra a coluna, e a whitelist `WRITABLE` do `store.js` faz
o bug morrer no cliente, com nome, em vez de virar um 403 obscuro.

### Dois efeitos colaterais que a mudança obrigou

1. `country_code` estava na `WRITABLE` e não no GRANT. Teria virado 42501
   na primeira gravação. Um script comparou as duas listas; hoje são
   idênticas.
2. O `getUser()` sincronizava o espelho `email` quando ele divergia de
   `auth.users`. Sem privilégio de coluna, isso passou a ser negado — e
   **está certo assim**. Consequência registrada: a coluna virou um
   retrato do cadastro. Não afeta nada, porque `getUser()` já devolve o
   e-mail de `auth.users` como fonte da verdade.

O `42501` ganhou código de erro próprio. Um descompasso futuro entre as
duas listas apareceria como "salvar não salva", sem motivo; agora tem
nome.

---

## 5. 🔴 O caminho de auto-promoção a admin

Achado na introspecção que antecedeu a migration. Duas peças que, sozinhas,
parecem razoáveis:

1. As policies `admin write games/banners/game_packages/site_content`
   decidem quem é admin com
   `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND user_type = 'admin')`.
2. `profiles_update_own` permite editar a própria linha **sem restrição de
   coluna**.

Juntas: quem tem linha em `profiles` faz
`UPDATE profiles SET user_type='admin' WHERE id=auth.uid()` e passa a
escrever no catálogo, nos banners e na copy do site.

**A Fase 1 não abre nada novo**, e isso foi provado, não deduzido:

- `auth.users` não tem trigger, então cadastrar-se na loja **não cria
  linha em `profiles`** (pré-voo do C1);
- `profiles` não tem policy de INSERT para `authenticated`;
- com JWT de cliente real, `GET /rest/v1/profiles` devolve `[]` (C3.5).

O cliente não tem a linha que a escalação exige e não tem como obtê-la.
**A porta existente continua aberta; ela só não foi alargada.**

Conserto em `docs/divida-tecnica-2-rls.md`: trocar as quatro por
`is_admin()`, que lê de `admin_users` — tabela que o usuário não edita. E,
para fechar a classe e não só a instância, restringir
`profiles_update_own` por coluna, do mesmo jeito do §4.

---

## 6. A chave que quase entrou errada

O Vinicius mandou a publishable key e eu a comparei com o histórico do
repo antes de usar: era **byte-a-byte a chave legada**, presente desde
`ac5aa29`, anterior à Parte A.

**Isso valia parar**, porque o erro seria invisível: C2 passaria, C3
passaria, o merge aconteceria, e o storefront rodaria com uma chave
compartilhada com o gate e o offerwall. No dia em que ela precisasse ser
rotacionada por causa deles, a loja cairia junto — e ninguém ligaria uma
coisa à outra.

A `storefront_v1` correta veio em seguida. Registrado no comentário do
`supabase-client.js`, porque a lição não é sobre esta chave.

### O que mais ficou no `supabase-client.js`

- **versão exata + SRI** em vez de `@2`. O arquivo manipula sessão e
  senha; atualização silenciosa vinda de CDN é superfície de ataque, não
  conveniência.
- **`storageKey` próprio** (`rg-storefront-auth`). O painel admin usa
  Supabase Auth no **mesmo domínio**; com a chave padrão, logar na loja
  derrubaria o admin na aba ao lado.

---

## 7. Os dois incidentes

### 7.1 🔴 Scanner de e-mail consumindo token de uso único

**O primeiro cadastro real deu 504 na confirmação, e o usuário ficou
confirmado no banco.** O Auth Log mostrou duas chamadas a `/verify` para o
mesmo token: `172.253.15.227` (scanner de links do Gmail) com `303` e
`user_signedup`, e depois o clique do usuário, que falhou.

O token é de uso único. O scanner o gastou.

**Não é caso de borda:** todo provedor corporativo pré-varre links, não há
como pedir que não sigam, e o mesmo mecanismo quebra o reset de senha —
onde o dano é pior, porque a pessoa fica trancada fora. E manifesta-se de
forma intermitente, por provedor do destinatário: a pior forma de
descobrir, que é em produção, por chamado.

**Correção: código de 6 dígitos.** Um scanner que abre o e-mail não
consome nada. Os dois templates perderam `{{ .ConfirmationURL }}` e lideram
com `{{ .Token }}`.

**Ele não pode voltar.** Convivendo com o `{{ .Token }}`, o Supabase volta
a gerar link, o scanner volta a visitá-lo, e o código digitado passa a
falhar como "inválido" — o mesmo bug, agora com um caminho que funciona e
outro que não. O aviso está em três lugares.

**Assimetria do Supabase contornada:** `auth.resend()` aceita `signup`,
`email_change`, `sms` e `phone_change` — **não `recovery`**. Reenviar
código de redefinição é chamar `resetPasswordForEmail()` de novo.

Post-mortem completo em `docs/incidents/2026-09-otp-link-scanner.md`.

### 7.2 O header mentia em 15 páginas

O `.account-btn` dizia "Cadastre-se / Entrar" em HTML fixo. Quem estava
logado via um convite para criar a conta que já tinha.

16 páginas têm o botão; 15 estavam erradas (`account-profile.html` já
renderizava o nome). Dessas, 5 carregavam a camada de dados e **10 não
liam sessão nenhuma**.

Não há template compartilhado aqui — sem build step, header e footer são
copiados arquivo a arquivo. Então **o compartilhado é o comportamento, não
o markup**: `header-session.js` acha o botão que já está na página e o põe
em dia.

Pinta em duas etapas: `getSession()` primeiro (lê do storage, sem rede),
depois refina com o `full_name` do perfil. Esperar o perfil antes de pintar
reproduziria o mesmo bug em miniatura.

As 10 estáticas ganharam a pilha inteira, que caiu no `<head>` — 218KB
bloqueando a renderização de uma página de termos. Resolvido com `defer`,
depois de o script de migração **verificar** que nenhum inline delas toca
`RecargaStore`, `RecargaMarket` ou `window.sb`.

---

## 8. Bugs do fornecedor corrigidos no caminho

| Bug | Causa raiz | Por que importava |
|---|---|---|
| `"Cliente desde"` mostrava `Invalid Date` | `new Date(memberSince + 'T00:00:00')` — funcionava com a string date-only do mock, quebra com o ISO completo de `created_at` | Só aparece com usuário real; o mock escondia |
| Perfil dizia "salvo" sem salvar | Dois `try/catch` vazios em volta de `updateUser` | O usuário confiava numa gravação que não aconteceu |
| Toggles de notificação quebravam o perfil | `RecargaStore.login()` gravava só `{name,email}`; os toggles liam `user.notifications[key]` direto. Só o `MOCK_USER` tinha o objeto | `TypeError` em **todo** login real, matando o resto do script da página |
| `?id=` inválido vendia outro produto | Fallback incondicional para Free Fire | Com pagamento real, o comprador pagaria por outra coisa sem nenhum sinal |

O terceiro merece nota: o HANDOVER do fornecedor registra o bug de
persistência desses mesmos toggles como **"Fixed"**. O fix era real, mas
foi testado no caminho do `MOCK_USER`, o único onde o objeto existe. **Um
fix testado só no caminho do mock não é um fix.**

### Três coisas acrescentadas porque o fluxo ficaria inseguro

- **`?redirect=` restrito a caminho relativo.** Ia direto para
  `location.href`: `?redirect=https://site-parecido/` fazia da tela de
  credencial uma ponte de phishing sob o domínio real.
- **Painel "escolha uma nova senha".** O link de reset criava sessão e
  largava a pessoa na tela de login, sem caminho para fazer o que clicou.
- **SSO oculto.** Nenhum provider OAuth configurado, e os botões chamavam
  o `login()` falso que deixou de existir.

E uma que teria quebrado o deploy: **`account-delete` tem que ser `.mjs`**.
O repo não tem `package.json` — decisão do projeto — então não há
`"type": "module"`. Um `.js` com `export` morreria com
`SyntaxError: Unexpected token 'export'`, levando o C4 junto.

---

## 9. Validação

### Checkpoints

| | Estado | O que provou |
|---|---|---|
| **C1** | ✅ 11/09 | 16 colunas, RLS on, 2 policies só `authenticated`, tabela só com SELECT, 9 colunas com UPDATE, 2 triggers, `anon` zerado |
| **C2** | ✅ 12/09 | Fluxo completo com OTP, com e-mail real e DKIM pass |
| **C3** | ✅ 12/09 | RLS por curl, com dois JWTs de cliente reais |
| **C4** | 🟡 parcial | Lado cliente provado; a linha anonimizada só a secret key enxerga |

### C3 — o que foi provado com dois usuários reais

- sem JWT: os quatro verbos em `401 · 42501 permission denied for table`.
  Não `200 []` — o `REVOKE` faz o Postgres negar **antes** da RLS;
- cada usuário vê 1 linha, a própria. A de B com o token de A: `[]`;
- INSERT `403`, DELETE `403`;
- **GRANT por coluna:** as seis colunas proibidas em `403 42501`,
  `full_name` em `204`. O controle positivo importa tanto quanto os
  negativos — sem ele, um GRANT quebrado que negasse tudo passaria como
  "muito seguro";
- `is_admin()` = `false` para os dois clientes e para anon.

**Uma armadilha de leitura registrada:** o PATCH cruzado devolve **`200`
com corpo `[]`**, não erro. É a RLS filtrando, mas `200` lido rápido
parece sucesso. O teste foi fechado lendo a linha de B com o token de B —
`full_name` intacto.

### C4 — o que a publishable key não alcança

Executado na conta B. A Function devolveu `200`. Depois: `403
user_not_found` no mesmo JWT, `[]` no `customer_profiles`,
`invalid_credentials` no login, e `401` (não 500) numa segunda chamada.

**O item central não pode ser provado por curl**: a linha anonimizada é
invisível para qualquer token de cliente, por desenho. O estado **antes**
foi capturado para a comparação ser contra registro, e o SQL de
conferência está em `docs/fase1-checkpoints.md`.

### Fora dos checkpoints

Erro de credencial inexistente mapeado contra o GoTrue de produção; as
quatro tentativas de open redirect caindo em `index.html`; zero console
error nas 18 páginas, logado e deslogado; validação de senha ao digitar
nas três telas; header trocando de estado em página estática, de drawer e
de store.

---

## 10. Rollback — testado, com uma assimetria que o git não resolve

Merge simulado numa branch descartável e revertido:

```bash
git revert -m 1 <merge>      # limpo, sem conflito
```

**Mas `-m 1` exige um commit de merge.** No teste, o primeiro merge foi
**fast-forward** e não gerou nenhum — `revert -m 1` reverteu só o último
commit. Então: **mergear o PR #3 com "Create a merge commit"**, não com
squash nem rebase, ou este comando não tem alvo.

### O que o revert NÃO desfaz

| | |
|---|---|
| A tabela `customer_profiles` | **continua no banco.** Inerte — nada mais a consulta — mas a migration some do repo. Não tente "desaplicar": escreva uma `0003_*.sql` se for preciso |
| Os templates no painel | **continuam em OTP.** Inertes com o código revertido, que não manda e-mail nenhum |
| **As contas reais** | **ficam órfãs.** O revert traz de volta o `login()` falso; quem criou conta perde o acesso e o perfil no banco deixa de ser lido |

O terceiro é o que torna o rollback da Fase 1 diferente do da Fase 0.
Enquanto só existirem contas de teste, reverter é barato. Depois do
primeiro cliente real, **reverter é perda de dado do ponto de vista dele**,
e a saída passa a ser corrigir para a frente.

**Alternativa mais rápida:** publicar o deploy anterior pela UI do Netlify.
Não mexe no histórico e vale enquanto o diagnóstico não terminou.

---

## 11. Fechamento

**Contas de teste.** `vinicius.esteves+1234@gmail.com` (B) foi **destruída
no C4** — é o objeto do teste, não resíduo. `vinicius.esteves+5678@gmail.com`
(A) **continua ativa**, com um ID de Free Fire salvo em
`linked_accounts`. Decidir se fica como conta de fumaça ou se é excluída
pela mesma Function.

**Dado pessoal.** Os dois e-mails são do próprio owner, em alias `+`.
Nenhum dado de terceiro entrou no sistema.

**Tokens.** Os dois JWTs foram passados por chat, usados em variável de
ambiente e destruídos com `shred`. Um grep por strings com cara de JWT no
repo volta limpo, e isso é parte do critério de merge.

**Gasto: zero.** Nenhum pagamento, nenhuma tabela existente tocada,
nenhuma chamada à Lapak.

---

## 12. Próximos passos

**🔴 Alta**

- **Fechar o C4:** rodar o SQL de conferência e olhar o log da Function no
  Netlify (esperado: `account-delete: ok ref=27baa35f` e nada mais). São os
  dois itens que faltam para o merge.
- **As 4 policies `admin write *` → `is_admin()`** (§5). No repo do admin.
  É o item mais urgente da dívida #2 e o único que **não depende da dívida
  #1**.
- **`terms.html` continua esqueleto** e o checkbox de cadastro é
  obrigatório e aponta para lá. Bloqueador de lançamento, herdado da Fase 0.

**🟡 Média**

- **Converter `change-email` e `magic-link` para OTP** antes de expor
  qualquer um dos dois. Têm a mesma vulnerabilidade do §7.1 e só não doem
  porque estão dormentes.
- **Conferir o "Email OTP Expiration"** no painel. Os templates dizem
  "1 hora", que é o default.
- **`updateEmail()` existe no store e nenhuma tela o chama.** Ou ganha
  tela (com OTP), ou sai.
- **Criar um `404.html` na raiz** — pendência da Fase 0; a regra de
  `/docs/*` aponta para ele.

**🟢 Baixa**

- **Ativar `/mx/`:** descomentar os dois arquivos **e** acrescentar `/mx`
  ao `path` do `gate.ts`. As duas coisas, ou o México nasce sem senha.
- **Fase 1b (i18n)**: `market.js` já resolve locale e moeda; falta a copy.
- **Pedidos para o servidor (Fase 2)**: hoje são do navegador, não da
  conta. É a maior estranheza que sobrou — trocar de máquina esconde o
  histórico.
- **`formatMoney` muda de unidade na Fase 2** (decimal → centavos). A
  regra está em caixa alta no `market.js` porque não dá para detectar em
  runtime: `4990` é plausível nas duas.

---

## 13. Aprendizagens

- **Sondar o banco antes de escrever a migration.** A Tarefa 1 inteira
  estava construída sobre uma tabela que já existia e pertencia a outro
  sistema. Custou uma consulta de um minuto e evitou derrubar o painel.
- **Policy governa linha; GRANT governa coluna.** As duas coisas parecem a
  mesma até alguém escrever `user_type='admin'` na própria linha. Foi essa
  lacuna que criou o §5, e foi ela que a revisão do §4 fechou aqui.
- **O erro invisível é o caro.** A chave legada (§6) teria passado por
  todos os checkpoints. Um erro que quebra é barato; um que funciona é o
  que custa seis meses depois.
- **Link de uso único em e-mail é um padrão quebrado**, não um detalhe de
  implementação. Todo provedor corporativo pré-varre. Código de 6 dígitos
  não é "alternativa"; para confirmação e reset, é o desenho correto.
- **Um fix testado só no caminho do mock não é um fix.** O HANDOVER do
  fornecedor declarava corrigido um bug que quebrava em 100% dos logins
  reais.
- **`async` não é detalhe de assinatura.** O HANDOVER sugeria manter as
  funções síncronas "para as páginas não mudarem". Não é possível
  atravessando a rede — foram 40 call sites em 7 páginas, e o header
  mentindo em 15 outras porque ninguém tinha pensado em quem lê sessão.
- **Testar o rollback muda o rollback.** Pela segunda sessão seguida: na
  Fase 0 o comando óbvio conflitava, aqui ele depende da estratégia de
  merge — e o revert não devolve as contas dos usuários.

---

## Referência

| Item | Valor |
|---|---|
| Repo · Branch · PR | `admin-pv/recargagames-frontend` · `feat/customer-auth` · #3 |
| Commits | 12 (`3683bf5` → `88feb6c`) |
| Deploy Preview | `deploy-preview-3--gleeful-entremet-47b89b.netlify.app` |
| Migration | `0002_customer_profiles.sql` — aplicada 11/09 |
| Tabela nova | `public.customer_profiles` (16 colunas) |
| Tabela NÃO tocada | `public.profiles` — identidade do admin |
| `is_admin()` lê de | `admin_users` (confirmado no pré-voo) |
| Function | `netlify/functions/account-delete.mjs` |
| Env da Function | `SUPABASE_URL`, `STOREFRONT_SECRET_KEY` — **nunca** `SUPABASE_SECRET_KEY`, que é do gate |
| Chave no browser | publishable `storefront_v1`, só em `supabase-client.js` |
| supabase-js | `2.116.0`, versão exata + SRI |
| storageKey | `rg-storefront-auth` (separado do admin, mesmo domínio) |
| Gate | intocado nas duas fases |

**Secrets:** nenhum neste log. A publishable key é pública por desenho e
não está reproduzida; a secret vive só no env do Netlify; os JWTs de teste
foram destruídos. O `remote_addr` do §7.1 é de infraestrutura do Google,
não de pessoa.
