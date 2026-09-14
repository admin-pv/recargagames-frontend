# Playvision — Log de Sessão 13–14/09/2026 (Frontend / Fase 2)

**Foco:** trocar o catálogo hardcoded (`products.js`) pelo catálogo que o
admin publica, e os pedidos em `localStorage` por pedidos reais em
`public.orders`, criados no servidor como "aguardando pagamento".
**Modo:** cuidado — toca dinheiro, `orders` e RLS. Nenhum pagamento, nenhum
pedido criado na Lapak.
**Repo:** `admin-pv/recargagames-frontend` · **Branch:** `feat/catalog-orders`
· **PR:** #4, mergeado com merge commit `6c343a6` em 14/09 11:54 UTC ·
22 commits, 35 arquivos, +3648 −801.
**Motivador:** a Fase 1 deu identidade real ao cliente; faltava ele poder
comprar algo que existe, pelo preço que o admin definiu, com o pedido
guardado na conta e não no navegador.

> **Estrutura:** §1 é o que mudou. §2 o modelo de catálogo, que foi
> redefinido no meio da fase. §3 a migration e os dois achados de banco.
> §4 as Functions. §5 o dado que precisou ser corrigido por SQL. §6 os
> erros desta sessão. §7 a validação. §8 o rollback. §9–§12 fecham.

---

## Resumo executivo

- **Entregue, testado e em produção atrás do gate.** A loja lê o catálogo
  publicado no admin (4 jogos, 17 pacotes), o cliente logado cria pedido
  gravado em `orders` como `awaiting_payment` com valor calculado no
  servidor, e "Meus pedidos" lê do Supabase pela RLS. `products.js` e
  `orders.js` saíram de runtime.
- **O modelo de catálogo mudou no meio da fase** (§2). O país que a Lapak
  marca no produto não diz onde ele funciona. A única fonte de "pode vender
  no país X" passou a ser `price_benchmarks.published` do admin.
- 🔴 **`orders` tinha todos os privilégios para `anon` e `authenticated`**,
  contidos só pela RLS. A migration 0003 foi a remediação (§3.1).
- 🔴 **`orders.user_id` apontava para `profiles` (a identidade do admin)
  com `ON DELETE CASCADE`.** Todo pedido da loja violaria a FK, e excluir
  uma conta apagaria o histórico fiscal. Corrigido na 0003 (§3.2).
- 🔴 **O admin não publica nada desde julho.** A tela de Catálogo escreve
  com a chave anon, sem sessão, e as policies negam. As 52 linhas
  publicadas eram de abril. Registrado na dívida #2 (§5).
- **O primeiro Deploy Preview devolveu catálogo vazio**, por dado errado no
  banco, não por código: `games.category_code` vazio ou diferente, e nenhum
  Free Fire publicado. Três jogos e um SKU foram corrigidos por SQL (§5).
- **Cinco checkpoints passados** (§7), com 17 checagens de segurança ao vivo.
- **Gasto: zero.** Nenhum pagamento, nenhuma chamada de criação de pedido à
  Lapak. Seis pedidos de teste de R$ 6,25 criados e expirados.

---

## 1. O que mudou

```
supabase/migrations/0003_storefront_orders.sql   NOVO — aplicada 13/09 (bloco 0 antes)
docs/fase2-bloco0.sql                            NOVO — pré-voo de orders, 0a–0l
netlify/lib/catalog.mjs                          NOVO — núcleo do catálogo (puro + rede + cache)
netlify/functions/catalog.mjs                    NOVO — GET /api/catalog
netlify/functions/orders-create.mjs              NOVO — POST /api/orders
netlify/functions/orders-expire.mjs              NOVO — Scheduled, a cada 10 min
netlify/edge-functions/gate.ts                   GATED_API_PATHS: /api/* atrás do gate
app/shared/js/store.js                           catálogo e pedidos assíncronos, centavos
app/shared/js/market.js                          formatMoney recebe centavos
app/shared/js/redemption-fields.js               NOVO — rótulo e validação dos forms da Lapak
app/index.html · product.html                    catálogo real; checkout cria pedido
app/order-details · my-orders · checkout.html    pedidos pela RLS; retry sem duplicar
app/account-profile.html                         resumo e "baixar meus dados" do servidor
app/*.html                                       products.js/orders.js fora; só Pix nos selos
netlify.toml · _redirects                        rotas /api/catalog e /api/orders; schedule
docs/modelo-catalogo-e-fulfillment.md            NOVO — modelo das Fases 2 e 3
docs/fase2-checkpoints.md                        NOVO — roteiro + resultados C1–C5
docs/divida-tecnica-2-rls.md                     achados de orders e do admin
.gitignore                                       docs/vendor/ (doc de parceiro fora do git)
```

---

## 2. O modelo de catálogo, redefinido no meio da fase

Registrado inteiro em `docs/modelo-catalogo-e-fulfillment.md`. O essencial:

### 2.1 O país da Lapak não é regra

O brief pedia descartar produto "fora da região do mercado", pelo campo de
região da Lapak. **Esse campo não existe.** `country_code` em `/category` e
`/all-products` só repete o país da consulta: a categoria `FFLATAM` ("Free
Fire - Latam (exclude Brazil)") volta como `br`, e os produtos dela com
sufixo `-br`.

Decisão do Vinicius: quem decide o que vale por mercado é o operador do
admin, e isso já existe em `price_benchmarks.published` por `country_code`.
Um pacote entra no catálogo se e somente se **(a)** está publicado e não
pausado no mercado e **(b)** a Lapak o dá como `available`. O nome
"exclude <país>" gera aviso no log para o operador, nunca exclusão.

### 2.2 Ligação produto → jogo pelo campo da Lapak

A primeira versão ligava pelo prefixo mais longo do código. Ao ler
`/all-products` apareceu `category_code`, e ele discorda do prefixo: a Lapak
põe `FFLATAM110-S98-br` na categoria `FF`. O campo da Lapak virou regra; o
prefixo, fallback. Aprovado.

### 2.3 Campos de resgate sem texto

`forms` da Lapak traz só `name` e `type`, sem rótulo nem regex. A validação
é derivada do type (`tel`/`number`: 4–20 dígitos; `text`: 1–64; `option`:
valor da lista), igual no browser e no servidor; o rótulo é copy e fica na
página. Categorias que pedem `orderdetail` (login e senha do jogo) ficam
**fora do catálogo B2C** até haver consentimento explícito e armazenamento
transitório cifrado.

### 2.4 O que ficou para a Fase 3

- **Check de ID antes da cobrança:** a doc Lapak v1.6 não tem endpoint;
  `check_id` está `inactive` em 261 de 264 categorias BR. O gancho grava
  `id_validation = 'unsupported'`. Pedir ativação para FF, PUBG e MLBB é
  pré-requisito **comercial**.
- **`face_value` é pré-requisito do "um pacote por variante":** as 52
  linhas antigas estão com NULL. Opção A: o admin passa a gravar ao
  publicar.

---

## 3. A migration 0003 e os dois achados de banco

Bloco 0 escrito em `docs/fase2-bloco0.sql`, rodado pelo Claude web antes de
aplicar. Duas regras de parada dispararam.

### 3.1 🔴 P1 — privilégio total em `orders`

`anon` e `authenticated` tinham `SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
REFERENCES, TRIGGER` na tabela. O que impedia um visitante com a
publishable key de escrever pedido era **só a RLS**. Não houve exposição,
mas era uma tranca só.

Decisão: seguir, com a própria 0003 como remediação:

- `REVOKE ALL` de `anon` e `authenticated`;
- `SELECT` **por coluna, em lista positiva** (21 colunas). Coluna nova nasce
  fechada; `lapak_*`, `fee_cents`, `user_type`, `payment_ref` e
  `id_validation` ficam fora;
- `orders_read_own` (`auth.uid() = user_id`) trocada por `orders_select_own`,
  que acrescenta `channel = 'storefront'`. Policies permissivas somam com
  OR; manter a antiga tornaria o filtro de canal enfeite;
- nenhuma policy e nenhum GRANT de escrita para cliente.

### 3.2 🔴 P4 — FK de `user_id` para a tabela errada

`orders.user_id` → `profiles(id) ON DELETE CASCADE`. `profiles` é a
identidade do admin; cliente não tem linha lá. Todo `orders-create` falharia
com 23503, e a exclusão LGPD de uma conta levaria o histórico fiscal.
Trocada para `auth.users(id) ON DELETE SET NULL`, com asserção de que
nenhuma linha tinha `user_id` preenchido.

### 3.3 `channel` com default `proxy`, não `storefront`

As 7 linhas existentes eram settlement do proxy (Fase 0 Lapak). O proxy
insere sem mandar `channel`; com default `storefront`, toda linha nova dele
nasceria rotulada como pedido da loja. Default `proxy`, e as Functions da
loja gravam `storefront` explicitamente. Backfill com asserção da
assinatura do proxy.

### 3.4 O que a 0003 custou fora deste repo

A aba **Pedidos do admin** passou de lista vazia para **401**: ela lê
`orders` com a chave anon. Nenhum dado perdido. Aceito; conserto no repo do
admin, junto da dívida #1.

---

## 4. As Functions

### 4.1 `catalog` — GET /api/catalog

`games` + `price_benchmarks` do Supabase cruzados com `/category` e
`/all-products` da Lapak via proxy: **2 chamadas à Lapak** para o catálogo
inteiro (~5 s na fria), cache de 5 min por mercado. Erro do proxy ou do
Supabase → `503 catalog_unavailable`, e a página diz "catálogo
indisponível"; nunca volta ao `products.js`. `?diag=1` devolve cada
`product_code` descartado e o motivo.

Não recebe `PROXY_ADMIN_KEY`: leitura de catálogo no `/gateway` é pública e
essa chave cria pedido na Lapak. `LAPAK_ENV` é obrigatória e sem default,
porque o proxy cai em `dev` quando o header `x-env` falta.

### 4.2 `orders-create` — POST /api/orders

JWT validado no GoTrue; mercado, pacote canônico, campos, e-mail e meio de
pagamento validados contra o **mesmo catálogo e a mesma cache**; perfil
vivo; no máximo 5 pedidos abertos. Grava `amount_cents` do catálogo,
`fee_cents` de `payment_methods` (D2: taxa absorvida, gravada como custo),
`expires_at` = +30 min. O corpo não carrega preço, e o `store.js` nem aceita
o campo.

`retryOf` reabre o mesmo pedido se ainda está aberto e cria um novo **com
os dados gravados no original** se venceu. Nunca duplica.

### 4.3 `orders-expire` — Scheduled, `*/10 * * * *`

Um UPDATE condicional: `storefront` + `awaiting_payment` + `expires_at` no
passado → `expired`. Idempotente, não toca `payment_status` nem outros
canais.

**Painel do Netlify (14/09, logo após o merge):** Functions → "4 functions
actively running in production": `account-delete`, `catalog`,
`orders-create` e `orders-expire` com o selo **Scheduled** e "Next
execution today at 9:00 AM". O painel mostra o fuso do navegador (a Function
aparece criada às 8:54, e o merge foi às 11:54 UTC), então a primeira
execução agendada é **09:00 BRT = 12:00 UTC de 14/09**. O disparador
temporário do C5 não aparece.

### 4.4 Gate

`/api/catalog` e `/api/orders` ficam atrás do gate até a Fase 4, cada uma
junto do caminho cru da Function (`/.netlify/functions/...`), que o
contornaria. Lista única em `GATED_API_PATHS`, espelhada no `config.path`.

---

## 5. O dado que precisou ser corrigido por SQL

O primeiro `diag=1` no preview devolveu **0 jogos e 0 pacotes**. Das 52
linhas publicadas, 36 estavam `empty` na Lapak e 16 disponíveis não achavam
jogo. E o relatório escondia 21 dos 23 jogos: jogo cuja categoria não
existia na Lapak era pulado sem registro (corrigido).

Atalhos de operador por SQL, feitos pelo Claude web com OK do Vinicius:

| O quê | Valor |
|---|---|
| `games.category_code` | `arena-breakout = AB`, `arena-of-valor = AOV`, `pubg-mobile = UCPUBGMGLOBAL` |
| `price_benchmarks` | `FF100_10-S136-br`, `face_value` 110, 14700 IDR, `rrp_final` 6,25, publicado, com `notes` explicando |

**Por que precisou:** o admin **não consegue publicar desde julho**
(diagnóstico do Claude web). `price_benchmarks` tem a policy correta com
`is_admin()`, o usuário está em `admin_users`, mas a tela de Catálogo
escreve com `fetch` cru, chave anon e sem sessão. Toda publicação dá 42501.

Sobram 17 jogos com `category_code` NULL e `bigo-live` com `BL` (código
inexistente na Lapak BR). Todos fora da loja até o admin ganhar o campo
"categoria Lapak" como dropdown.

---

## 6. Erros desta sessão

Registrados porque cada um é uma armadilha que volta.

| Erro | Como apareceu | Lição |
|---|---|---|
| Colunas de `payment_methods` inventadas | C3 falhou com `invalid_payment_method`: usei `method_code`/`method_name`, lidos no *fallback de exibição* do admin. As colunas são `code` e `name` | Nome de coluna se confere no banco, não no código que o exibe |
| Checkpoint registrado sem rodar | Marquei o C2.3 (`?country=xx` → 400) como passado sem ter executado. Corrigido no doc antes de o Vinicius rodar | "Passou" só depois do resultado na tela |
| Relatório que escondia a causa | O `diag` omitia jogo com categoria inexistente; 21 de 23 sumiam da conta | Diagnóstico precisa listar o que *não* entrou, não só o que entrou |
| Contagem de colunas | A conferência da 0003 dizia 19 colunas novas; eram 18 | Conta de cabeça em SQL de produção se refaz |
| Diagnóstico de rede aceito sem conferir | O relato do C3 dizia "não fez o POST"; a mensagem da tela só existe como resposta do servidor | Sintoma e evidência podem discordar; vale dizer |

E dois que **não eram defeito**, mas custaram uma rodada:

- **`JWT_A` com sessão encerrada:** o PostgREST aceitou o token (confere só
  assinatura) e o `orders-create` recusou (o GoTrue exige sessão viva). É o
  comportamento certo: logout bloqueia criação de pedido na hora.
- **Netlify recusa Scheduled Function por URL** (403). O C5 usou um
  disparador temporário atrás do gate, chamando a mesma `expireOrders()`,
  removido antes do merge.

---

## 7. Validação

| | Estado | O que provou |
|---|---|---|
| **C1** | ✅ 13/09 | 0003 aplicada sem asserção disparar; 18 colunas novas; RLS on; 3 policies; tabela sem privilégio para browser; 21 colunas com SELECT; anon zero; FK para `auth.users` SET NULL |
| **C2** | ✅ 13/09 | 4 jogos / 17 pacotes; 53 publicadas = 17 elegíveis + 36 `empty`; os 17 `priceCents` batem com `round(rrp_final*100)` no SQL; páginas conferidas no Chrome sem erro e sem `products.js` |
| **C3** | ✅ 14/09 | Pedido `a9b58143…` pela +5678: `storefront`, `awaiting_payment`, 625 / 6 centavos, `unsupported`, `guest`, +30 min; horário de Brasília; Meus pedidos listou |
| **C4** | ✅ 14/09 | 17 checagens ao vivo (abaixo); 4.3 coberto só pelo teste local, por decisão |
| **C5** | ✅ 14/09 | 4 execuções: 1 → 0 → 5 → 0; SQL às 11:48: os 6 pedidos `expired`, 7 `proxy` intocadas |

### C4 — o que foi provado ao vivo

- preço, moeda e status no corpo **ignorados** (gravou 625, BRL, `awaiting_payment`);
- não publicado → `400 product_not_available`; campo fora da regra e campo
  extra `orderdetail` → `400 invalid_redemption_fields`;
- sexto pedido aberto → `429`;
- conta B não vê pedido de A, nem por id nem listando;
- `select=*` e coluna fora da lista → `403 42501`;
- PATCH, DELETE e INSERT com JWT → `403 42501`; anon → `401`;
- Function sem token → `401 missing_token`.

### Produção, depois do merge (14/09)

Em `recargagames.com` e `gleeful-entremet-47b89b.netlify.app`: `/br/` sem
cookie → 401 com a página do gate; `/api/catalog` e `/api/orders` sem cookie
→ `401 gate_required`; com cookie, loja abre e catálogo devolve 4 jogos /
17 pacotes (env das Functions presente em produção);
`/api/orders-expire-run` → 404.

### Testes locais

Sem framework de testes (decisão do projeto): scripts Node no scratchpad,
com `fetch` simulado e o catálogo **real** da Lapak. Cobriram catálogo
(canônico, pausado, `empty`, `orderdetail`, aviso que não exclui, centavos
sem float), `orders-create` (todas as recusas, retry, taxa, log sem PII) e
`orders-expire` (filtros, idempotência).

---

## 8. Rollback

```bash
git revert -m 1 6c343a6 && git push     # merge commit, então -m 1 tem alvo
```

Ou publicar o deploy anterior pela UI do Netlify, sem mexer no histórico.

### O que o revert NÃO desfaz

| | |
|---|---|
| **Migration 0003** | continua aplicada. O browser segue sem escrita em `orders`, e isso é o desejado. Corretiva é `0004_*.sql`, nunca editar a 0003 |
| **Aba Pedidos do admin** | continua em 401 |
| **Os 6 pedidos de teste** | continuam em `orders`, `expired` |
| **Os ajustes por SQL** | 3 `category_code` e o SKU de Free Fire ficam |
| **A +5678** | perde os pedidos da tela, porque o código antigo lê `localStorage` |

Enquanto só houver pedidos de teste, reverter é barato. Depois do primeiro
pedido real, corrigir para a frente.

---

## 9. Fechamento

**Pedidos de teste.** Seis, todos da `vinicius.esteves+5678@gmail.com`, R$
6,25, `FF100_10-S136-br`, todos `expired`: `a9b58143` (C3), `3228e22e`,
`60454230`, `d67e66fe`, `38549c14`, `9555e041` (C4). Nenhum pago, nenhum
enviado à Lapak.

**Tokens.** Dois `JWT_A`, um `JWT_B` e o cookie `rg_gate` foram passados por
chat e usados só em variável de ambiente de comando. Nenhum foi escrito em
arquivo; grep por JWT no repo volta limpo. Os JWTs expiram em 1 h. **O cookie
do gate vale 90 dias** (até 13/12/2026) e ficou no histórico do chat.

**Dado pessoal.** Só os aliases `+` do owner. Logs das Functions sem e-mail
e sem ID de jogo (conferido nos testes locais).

**Gasto: zero.** Nenhum serviço novo, nenhum pagamento, nenhuma order na Lapak.

---

## 10. Próximos passos

**🔴 Alta**

- **Admin: publicar SKU volta a funcionar** — trocar o `fetch` anon da tela
  de Catálogo por `sb.from()` com sessão, e **gravar `face_value`** (dívida #2).
- **Admin: campo "categoria Lapak"** (dropdown do `/category`) na tela de
  jogo. 18 jogos estão fora da loja por isso.
- **Fase 3, comercial:** pedir à Lapak a ativação do `check_id` para FF,
  PUBG e MLBB e o contrato da checagem.
- **Conferir a primeira execução agendada do `orders-expire` em produção**
  no log da Function (esperado `orders-expire: ok expired=0`).

**🟡 Média**

- **Rotacionar o cookie do gate** (`JWT_SIGNING_SECRET`) se o histórico do
  chat não for considerado seguro. Derruba o acesso de todos; é decisão do owner.
- **Aba Pedidos do admin** lendo `orders` como `authenticated` com
  `is_admin()` (depende da dívida #1).
- **Revisar GRANT amplo nas outras tabelas de `public`**: se `orders` herdou
  o default do Supabase, as outras criadas fora das migrations também.
- **Resíduo do protótipo no `product.html`:** cards de Cartão/Boleto/
  Operadora ocultos só por CSS e FAQ falando de Boleto.
- **Offerwall/seção Ofertas** ocultos: voltam só com campanha vinda do admin.

**🟢 Baixa**

- `is_primary` no admin como alternativa ao canônico por menor preço.
- Materializar o catálogo no admin (`storefront_catalog`) se a cache de 5
  min ou a chamada fria de ~5 s virarem problema.
- `games.redemption_form` para rótulo e regex por jogo.

---

## 11. Aprendizagens

- **Premissa de fornecedor se lê na resposta real, não na doc.** "Campo de
  região", "regex por campo" e "check de ID" estavam no brief e nenhum
  existe na API. Três chamadas ao proxy antes de escrever código mudaram o
  modelo da fase.
- **O catálogo vazio era dado, não código.** Sem o `?diag=1` listando cada
  descarte e o motivo, o primeiro preview teria sido lido como bug da
  Function.
- **Pré-voo de banco paga de novo.** P1 e P4 teriam ido para produção:
  um como tranca única, o outro como FK que quebrava toda compra e apagava
  histórico.
- **Default de coluna é contrato com quem não manda a coluna.** O proxy
  insere sem `channel`; o default do brief teria rotulado errado cada
  settlement dali em diante.
- **PostgREST e GoTrue validam JWT de jeitos diferentes.** Assinatura válida
  não é sessão viva. Onde a escrita importa, validar no GoTrue.
- **Registrar "passou" sem ter rodado é o erro que mais custa confiança**,
  mesmo quando o resultado depois confirma.

---

## Referência

| Item | Valor |
|---|---|
| Repo · Branch · PR | `admin-pv/recargagames-frontend` · `feat/catalog-orders` · #4 |
| Merge | `6c343a6` (pais `1556bef` + `4bd70c5`), 14/09 11:54 UTC |
| Commits | 22 (`3d60218` → `4bd70c5`) |
| Deploy Preview | `deploy-preview-4--gleeful-entremet-47b89b.netlify.app` |
| Migration | `0003_storefront_orders.sql` — aplicada 13/09 |
| Rotas | `/api/catalog` (GET), `/api/orders` (POST), ambas atrás do gate |
| Scheduled | `orders-expire`, `*/10 * * * *` — selo Scheduled no painel; 1ª execução 14/09 12:00 UTC |
| Env das Functions | `SUPABASE_URL`, `STOREFRONT_SECRET_KEY`, `PROXY_URL`, `LAPAK_ENV=prod` |
| `PROXY_ADMIN_KEY` | ainda não lida (check de ID é `unsupported`) |
| Doc Lapak | `docs/vendor/lapak-reseller-api.pdf` v1.6, fora do git |
| Conta de fumaça | `vinicius.esteves+5678@gmail.com` |

**Secrets:** nenhum neste log. A publishable key não está reproduzida; a
secret vive só no env do Netlify; nenhum token de teste foi gravado em arquivo.
