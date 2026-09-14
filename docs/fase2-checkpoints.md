# Fase 2 — checkpoints e como provar cada um

Modo cuidado: nada é mergeado antes dos cinco passarem no Deploy Preview.
Merge com `--no-ff`, como na Fase 1. Regras do catálogo e do fulfillment:
`docs/modelo-catalogo-e-fulfillment.md`.

## Estado

| | Estado | Quando |
|---|---|---|
| **C1** migration 0003 | ✅ passado | 13/09: bloco 0 lido, P1 e P4 tratados, aplicada, conferência C-1..C-9 ok |
| **C2** catálogo | ✅ passado | 13/09: 4 jogos / 17 pacotes no preview 4, cents conferidos no SQL, páginas pelo Chrome |
| **C3** pedido | ✅ passado (1 item em aberto: "Meus pedidos") | 14/09: pedido `a9b58143…` pela +5678, conferido no SQL |
| **C4** segurança por curl | ⏳ aguardando tokens | |
| **C5** expiração | ⏳ código no preview | |

**Convenção:** `$SITE` = URL do Deploy Preview. `$URL` e `$PUB` como na
Fase 1. `$JWT_A` = token de `vinicius.esteves+5678@gmail.com`. Nenhum
desses valores entra neste repo.

---

## C1 — migration 0003 ✅ (13/09)

Bloco 0 (`docs/fase2-bloco0.sql`), rodado pelo Claude web:

- **P1 disparou:** `anon` e `authenticated` tinham todos os privilégios de
  tabela em `orders`, contidos só pela RLS. Decisão: seguir, porque a 0003
  é a remediação. Registrado na dívida #2.
- **P4 disparou:** `orders.user_id` → `profiles(id) ON DELETE CASCADE`.
  Decisão: corrigir na 0003 para `auth.users(id) ON DELETE SET NULL`.
- As 7 linhas existentes eram settlement do proxy: `channel = 'proxy'`.
- `status` em uso: só `pending` (default que o proxy usa), que entrou no CHECK.
- Taxa: `payment_methods.transaction_cost_percent` e `fixed_cost` (em reais).

Aplicada do `BEGIN` ao `COMMIT` sem nenhuma asserção disparar. Conferência:

| | Esperado | Obtido |
|---|---|---|
| C-1 | 18 colunas novas, 37 no total; `channel` NOT NULL default `'proxy'`; `updated_at` default `now()` | ✅ |
| C-2 | `proxy` = 7, nenhum NULL | ✅ |
| C-3 | RLS on | ✅ |
| C-4 | só `orders_admin_read_all`, `orders_admin_write`, `orders_select_own`; `orders_read_own` ausente | ✅ |
| C-5 | nenhum privilégio de tabela para anon/authenticated | ✅ |
| C-6 | 21 colunas com SELECT, só `authenticated`, lista positiva exata | ✅ |
| C-7 | anon zero | ✅ |
| C-8 | 5 CHECKs + `orders_user_id_fkey` → `auth.users` SET NULL + `customer_profile_id_fkey` | ✅ |
| C-9 | 2 índices + trigger | ✅ |

---

## C2 — catálogo

### Pré-requisitos no Netlify (Deploy Previews e Branch deploys)

`SUPABASE_URL`, `STOREFRONT_SECRET_KEY`, `PROXY_URL`, `LAPAK_ENV=prod`.
Sem `LAPAK_ENV`, a Function responde **500 `misconfigured`**, e isso é
intencional: o proxy cairia em `dev` sem avisar ninguém.

### Pré-requisitos de dado (13/09)

O primeiro `diag=1` no preview 4 voltou **0 jogos / 0 pacotes**: das 52
linhas publicadas, 36 `empty` na Lapak e 16 disponíveis sem jogo. Causa:
`games.category_code` vazio ou diferente do código da Lapak, e nenhuma
linha de Free Fire em `price_benchmarks`. O admin não consegue publicar
desde julho (dívida #2). Correções por SQL, feitas pelo Claude web com OK
do Vinicius:

- `games.category_code`: `arena-breakout = AB`, `arena-of-valor = AOV`,
  `pubg-mobile = UCPUBGMGLOBAL`. Dos outros 20, 17 seguem NULL, `bigo-live`
  tem `BL` (inexistente na Lapak BR) e `roblox` tem `ROB`, válido
  (tarefa do admin).
- `price_benchmarks`: `FF100_10-S136-br` ("100 + 10 Bonus Diamonds"),
  `face_value 110`, `last_price_idr 14700`, `rrp_auto = rrp_final = 6.25`
  (14700 × 0.00034 × 1.25), `published = true`. É o SKU do C3.

**Esperado depois disso:** 4 jogos (`arena-breakout`, `arena-of-valor`,
`pubg-mobile`, `free-fire`) e 17 pacotes (1 AB + 9 PUBG + 6 AOV + 1 FF),
salvo mudança de estoque na Lapak.

### 2.0 Atrás do gate

`$GATE` = valor do cookie `rg_gate` (DevTools → Application → Cookies,
depois de passar pela senha). Não entra no repo.

```bash
# sem cookie → 401 {"error":"gate_required"}, nos dois caminhos
curl -s -o /dev/null -w '%{http_code}\n' "$SITE/api/catalog?country=br"
curl -s -o /dev/null -w '%{http_code}\n' "$SITE/.netlify/functions/catalog?country=br"
```

### 2.1 A Function responde

```bash
curl -s -H "Cookie: rg_gate=$GATE" "$SITE/api/catalog?country=br&diag=1" | python3 -c '
import json,sys; j=json.load(sys.stdin); r=j["report"]
print("games", len(j["products"]), "packages", sum(len(p["packages"]) for p in j["products"]))
for k in ["publishedRows","eligibleRows","notInLapak","unavailable","withoutGame","orderdetailSkipped","incompatibleWarnings","nonCanonical","gamesWithoutPackages","categoryMissing","unknownFormType","invalidPrice"]:
    print(k, r[k])'
```

Esperado: N jogos e M pacotes, com `M` = número de pares (jogo,
`face_value`) com ao menos uma variante publicada, não pausada e
`available`. Os `product_code` descartados aparecem por motivo em `report`.

### 2.2 Conferência no SQL (Claude web)

Com a lista `unavailable` + `notInLapak` do 2.1 em mãos:

```sql
SELECT count(*) FROM price_benchmarks
 WHERE country_code = 'br' AND published = true AND auto_paused IS NOT TRUE;
-- = report.eligibleRows + len(notInLapak) + len(unavailable) + len(invalidPrice)
--   + len(withoutGame)
```

E, para cada pacote do JSON, `priceCents = round(rrp_final * 100)` do
`product_code` canônico:

```sql
SELECT product_code, rrp_final, round(rrp_final * 100)::int AS cents
  FROM price_benchmarks
 WHERE country_code = 'br' AND product_code IN (<ids dos pacotes>);
```

### 2.3 Erro vira 503, nunca products.js

- `?country=xx` → **400 `invalid_country`** (caso controlado).
- O 503 não dá para provocar sem derrubar o proxy. Fica provado por
  leitura: todo erro de Supabase, proxy ou formato da Lapak vira
  `CatalogUnavailable` → 503, e env faltando é **500 `misconfigured`**,
  outro código de propósito.
- No browser: DevTools → Network → bloquear `/api/catalog` e recarregar.
  `index.html` mostra "Catálogo indisponível no momento" e
  `product.html` mostra "Catálogo indisponível". Nenhuma das duas mostra
  produto.

### 2.4 Páginas

- [x] `index.html` renderiza os jogos do catálogo; badges Destaque/Popular
      de `is_featured`/`is_popular`; preço "A partir de" = menor pacote
- [x] `product.html?id=free-fire` renderiza pacotes, preço em R$ correto
      (centavos ÷ 100), campo "ID do jogador" validando 4–20 dígitos
- [x] `product.html?id=<slug sem pacote>` → "Produto não encontrado"
- [x] Console sem erro nas duas páginas
- [x] **Network: `products.js` não é requisitado** em nenhuma página

---

### Resultado C2 ✅ (13/09)

**2.0 gate.** Sem cookie, `/api/catalog` e `/.netlify/functions/catalog`
devolvem `401 {"error":"gate_required"}`; `/br/` devolve 401 com a página
do gate.

**2.1 Function** (preview 4, commit `32f92e7`): **4 jogos, 17 pacotes.**
`publishedRows` 53 = `eligibleRows` 17 + `unavailable` 36. `notInLapak`,
`withoutGame`, `invalidPrice`, `incompatibleWarnings`, `nonCanonical`,
`orderdetailSkipped` e `unknownFormType` vazios.

| Jogo | Pacotes | Menor |
|---|---|---|
| `arena-breakout` (AB) | 1 | R$ 5,95 |
| `arena-of-valor` (AOV) | 6 | R$ 2,07 |
| `free-fire` (FF) | 1 (`FF100_10-S136-br`) | R$ 6,25 |
| `pubg-mobile` (UCPUBGMGLOBAL) | 9 (variante S113) | R$ 6,53 |

Os 36 indisponíveis: 4 de Arena Breakout, 23 de PUBG (UC S50/S7 e VC
S35/S19), 3 de Google Play (`VGPBRL`) e 6 de LM (`S79`), todos
`status: empty` na Lapak. `categoryMissing`: 17 jogos com
`category_code` NULL, mais `bigo-live` com `BL`, que não existe na Lapak BR.
`roblox` (`ROB`) está em `gamesWithoutPackages`.

**2.2 SQL** (Claude web): `COUNT` = 53, e os 17 `round(rrp_final*100)`
batem exatamente com os `priceCents` do JSON.

**2.3 ✅** `$SITE/api/catalog?country=xx` no browser, com a sessão do
gate, devolveu `{"error":"invalid_country"}` (conferido pelo Vinicius em
13/09). Uma primeira versão deste registro o tinha dado como feito antes
de ser rodado; ficou corrigido. O 503 fica provado por leitura (ver acima).

**2.4 páginas** (Chrome, sessão do gate):

- `index.html`: 4 cards com os preços do catálogo; badge Destaque em AOV,
  Popular em FF e PUBG; trilho "Códigos digitais" oculto (nenhum produto
  tipo código); filtros de plataforma fora; único recurso de dado
  requisitado é `/api/catalog?country=br`; console sem erro. Imagens do
  Cloudinary com o transform `c_fill,w_240,h_240,q_auto,f_auto` (200).
- `product.html?id=free-fire`: 1 pacote `FF100_10-S136-br` a R$ 6,25 no
  card, no Pix e no total; "ID do jogador" com `inputmode=numeric` e
  `maxlength=20`. `123` e `12ab5678` inválidos, `123456789` válido;
  "Somente resgatável em: Brasil" vindo do Intl; relacionados com preço do
  catálogo; recursos sem `products.js`; console sem erro.
- `product.html?id=roblox`: "Produto não encontrado", 0 pacotes, console
  sem erro.

**Decisões tomadas durante o C2:** ligação produto → jogo pelo
`category_code` da Lapak, com prefixo só como fallback; `/api/catalog`
atrás do gate até a Fase 4; `face_value` gravado pelo admin (opção A); a
seção **Ofertas** da home fica oculta (conteúdo do protótipo sem
backend), junto com o slide do hero que apontava para ela.


---

## C3 — pedido "aguardando pagamento"

### O que mudou

- `POST /api/orders` → `netlify/functions/orders-create.mjs`, **atrás do
  gate** (rota e caminho cru da Function em `GATED_API_PATHS`).
- `product.html`: "Criar pedido" chama a Function; sucesso leva a
  `order-details.html?id=<uuid>&new=1`. O mock do protótipo saiu
  (`completeOrder`, `generateRedeemCode`, o `setTimeout` de sucesso fake).
  Deslogado vai para o login e volta ao produto.
- `order-details.html`, `my-orders.html`, `account-profile.html` (resumo e
  "Baixar meus dados") leem `public.orders` pela RLS.
- `checkout.html?retry=<id>`: pedido aberto volta ao mesmo; vencido cria um
  novo com os dados gravados no original.
- `orders.js` (seed do protótipo) fora de runtime.

Teste local da Function com `fetch` simulado e o catálogo real da Lapak
(13/09): preço do corpo ignorado, não canônico → 400, não publicado → 400,
campo fora da regra → 400, e-mail/método inválidos → 400, 5 abertos → 429,
retry aberto reaproveita sem gravar, retry vencido usa os dados do
original, status final → 409, `fee_cents` = 6 para R$ 6,25 no Pix (0,99%),
`expires_at` = +30 min, log sem e-mail e sem ID de jogo.

### Pré-requisitos

- Deploy Preview do PR #4 no commit do C3.
- Env do C2 (`SUPABASE_URL`, `STOREFRONT_SECRET_KEY`, `PROXY_URL`,
  `LAPAK_ENV=prod`). `PROXY_ADMIN_KEY` ainda não é lida: o check de ID grava
  `unsupported` sem chamar a Lapak.
- `FF100_10-S136-br` publicado e `available` (o C2 confirmou).
- `payment_methods` do `br` com `code = 'pix'` e `active = true`. Colunas
  reais (SQL, 13/09): `code` é a chave (`pix`, `cc`, `debit`, `nupay`) e
  `name` é o rótulo.

> **1ª tentativa do C3 (13/09): falhou com 400 `invalid_payment_method`.**
> A Function procurava `method_code`/`method_name`, nomes tirados do
> fallback de exibição do admin, que não existem em `payment_methods`, e
> todo pedido era recusado antes de gravar. Corrigido para `code`. Nenhum
> pedido `storefront` chegou a ser criado (conferido no SQL).

### Roteiro (Vinicius, conta +5678, no preview, atrás do gate)

1. Entrar com `vinicius.esteves+5678@gmail.com`.
2. Abrir `$SITE/br/product.html?id=free-fire`.
3. Escolher o pacote **100 + 10 Bonus Diamonds (R$ 6,25)**.
4. Preencher o **ID do jogador** (4 a 20 dígitos). O e-mail vem
   pré-preenchido com o da conta.
5. Pix selecionado → **Criar pedido**.
6. Esperado: vai para `order-details.html?id=<uuid>&new=1` com
   - faixa "Pedido criado";
   - status **Aguardando pagamento** e contagem regressiva a partir de ~30:00;
   - botão desabilitado **"Pagamento Pix disponível em breve"**;
   - pacote, ID do jogador mascarado (`•••••` + 4 últimos), e-mail, Pix,
     data do pedido **no horário de Brasília** (created_at é UTC no banco),
     total R$ 6,25.
7. Abrir **Meus pedidos**: o pedido aparece em "Todos" e em "Em aberto", com
   "Ver pagamento".
8. Abrir **Minha conta**: o pedido aparece no resumo.
9. Anotar o `<uuid>` da URL e mandar para o Claude web.

### Conferência no SQL (Claude web)

```sql
SELECT id, channel, status, payment_status, user_id, customer_profile_id,
       country, currency_code, game_slug, product_code, package_label,
       face_value, amount_cents, fee_cents, id_validation, payment_method,
       redemption_fields, delivery_email, user_type,
       created_at, expires_at, expires_at - created_at AS validade
  FROM public.orders
 WHERE id = '<uuid>';
```

Esperado:

| Coluna | Valor |
|---|---|
| `channel` | `storefront` |
| `status` / `payment_status` | `awaiting_payment` / `awaiting` |
| `user_id` | id da +5678 em `auth.users` |
| `customer_profile_id` | `id` da linha da +5678 em `customer_profiles` |
| `country` / `currency_code` | `br` / `BRL` |
| `game_slug` / `product_code` | `free-fire` / `FF100_10-S136-br` |
| `face_value` | `110` |
| `amount_cents` | **625** (= `round(rrp_final*100)` do catálogo) |
| `fee_cents` | **6** (625 × 0,99% do Pix, arredondado; `fixed_cost` 0) |
| `id_validation` | `unsupported` |
| `redemption_fields` | `{"user_id": "<o ID digitado>"}` |
| `user_type` | `guest` (default da tabela) |
| `validade` | `00:30:00` (±1 s). `created_at` sem fuso e `expires_at` com fuso: a subtração só dá 30 min se `created_at` estiver em UTC |

E o log da Function (Netlify → Functions → `orders-create`):
`orders-create: ok id=<uuid> code=FF100_10-S136-br` e nada com e-mail ou ID
de jogo.


### Resultado C3 ✅ (14/09)

Pedido `a9b58143-d681-411a-9157-6fcbdf45db05`, criado pelo Chrome com a
conta +5678 no preview 4. Conferido pelo Claude web no SQL:

| Coluna | Obtido |
|---|---|
| `channel` / `status` / `payment_status` | `storefront` / `awaiting_payment` / `awaiting` ✅ |
| `amount_cents` / `fee_cents` | 625 / 6 ✅ |
| `id_validation` / `user_type` | `unsupported` / `guest` ✅ |
| `product_code` / `game_slug` / `face_value` | `FF100_10-S136-br` / `free-fire` / 110 ✅ |
| `payment_method` / moeda / país | `pix` / `BRL` / `br` ✅ |
| `user_id` / `customer_profile_id` | preenchidos ✅ |
| `redemption_fields` | `{"user_id":"123456789"}` ✅ |
| `expires_at - created_at` | 30 min ✅ |

Tela de detalhe correta, em horário de Brasília.

- [ ] **Em aberto:** "Meus pedidos" listou o pedido? O registro recebido
      veio sem a resposta preenchida.

---

## C4 — segurança por curl

Precisa de três valores, passados por chat e usados só em variável de
ambiente (nada no repo):

- `$JWT_A`: access token da `vinicius.esteves+5678@gmail.com`
- `$JWT_B`: access token de outra conta de cliente
- `$GATE`: cookie `rg_gate` (a rota `/api/orders` fica atrás do gate)

`$PUB` = publishable key (`app/shared/js/supabase-client.js`), `$URL` = URL
do Supabase, `$SITE` = preview 4. `$ORDER_A` = `a9b58143-d681-411a-9157-6fcbdf45db05`.

```bash
BODY='{"country":"br","gameSlug":"free-fire","productCode":"FF100_10-S136-br","redemptionFields":{"user_id":"123456789"},"deliveryEmail":"vinicius.esteves+5678@gmail.com","paymentMethod":"pix"}'
post() { curl -s -w ' %{http_code}\n' -X POST "$SITE/api/orders" -H "Cookie: rg_gate=$GATE" -H 'Content-Type: application/json' "$@"; }
```

| # | Teste | Comando | Esperado |
|---|---|---|---|
| 4.1 | preço do corpo ignorado | `post -H "Authorization: Bearer $JWT_A" -d "${BODY%?},\"priceCents\":1,\"amountCents\":1}"` | 201, `amountCents` 625; no SQL, `amount_cents` 625 |
| 4.2 | `product_code` não publicado | `BODY` com `FF520_52-S136-br` | 400 `product_not_available` |
| 4.3 | variante não canônica | `BODY` com uma variante não canônica | 400 `package_not_canonical` (ver nota) |
| 4.4 | campo fora da regra | `redemptionFields {"user_id":"12ab"}` | 400 `invalid_redemption_fields` |
| 4.5 | B não lê pedido de A | `curl "$URL/rest/v1/orders?select=id&id=eq.$ORDER_A" -H "apikey: $PUB" -H "Authorization: Bearer $JWT_B"` | `[]` |
| 4.5b | A lê o próprio | mesmo com `$JWT_A` | 1 linha |
| 4.6 | PATCH com JWT | `curl -X PATCH "$URL/rest/v1/orders?id=eq.$ORDER_A" -H "apikey: $PUB" -H "Authorization: Bearer $JWT_A" -H 'Content-Type: application/json' -d '{"amount_cents":1}'` | 401/403 `42501` |
| 4.6b | DELETE com JWT | idem com `-X DELETE` | 401/403 `42501` |
| 4.6c | INSERT com JWT | `POST $URL/rest/v1/orders` com `$JWT_A` | 401/403 `42501` |
| 4.7 | anon na tabela | `curl "$URL/rest/v1/orders?select=id" -H "apikey: $PUB" -H "Authorization: Bearer $PUB"` | 401 `42501` |
| 4.7b | anon na Function | `post -d "$BODY"` sem `Authorization` | 401 `missing_token` |
| 4.8 | sexto pedido aberto | `post` com `$JWT_A` até 5 abertos, depois mais um | 429 `too_many_open_orders` |

**Nota 4.3:** o C2 mostrou `nonCanonical: []`, porque hoje não há duas
variantes `available` do mesmo jogo e `face_value`. Sem isso não existe
código "não canônico" para mandar. O caminho está coberto no teste local
(`package_not_canonical`); ao vivo, só com dado preparado por SQL.

---

## C5 — expiração

`netlify/functions/orders-expire.mjs`, agendada a cada 10 min em
`netlify.toml`. `awaiting_payment` + `channel = storefront` + `expires_at`
no passado → `expired`. Idempotente.

**Limite do Netlify:** Scheduled Function só roda sozinha no deploy de
produção. No preview é preciso chamá-la à mão (ver resultado abaixo).

1. Garantir um pedido vencido: o `a9b58143…` expirou 30 min depois de
   criado, mas continua `awaiting_payment` no banco até a Function rodar.
   ```sql
   SELECT id, status, expires_at < now() AS vencido
     FROM orders WHERE channel = 'storefront' ORDER BY created_at;
   ```
2. Rodar a Function uma vez. Esperado: `{"expired": N}` com N ≥ 1, e no SQL
   o pedido vira `expired`.
3. Rodar de novo. Esperado: `{"expired": 0}`, nada muda no SQL.
4. Controle: linhas `channel = 'proxy'` continuam `pending`.
