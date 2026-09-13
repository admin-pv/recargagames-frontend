# Fase 2 — checkpoints e como provar cada um

Modo cuidado: nada é mergeado antes dos cinco passarem no Deploy Preview.
Merge com `--no-ff`, como na Fase 1. Regras do catálogo e do fulfillment:
`docs/modelo-catalogo-e-fulfillment.md`.

## Estado

| | Estado | Quando |
|---|---|---|
| **C1** migration 0003 | ✅ passado | 13/09: bloco 0 lido, P1 e P4 tratados, aplicada, conferência C-1..C-9 ok |
| **C2** catálogo | ⏳ código pronto para o Deploy Preview | |
| **C3** pedido | ⬜ | |
| **C4** segurança por curl | ⬜ | |
| **C5** expiração | ⬜ | |

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

- [ ] `index.html` renderiza os jogos do catálogo; badges Destaque/Popular
      de `is_featured`/`is_popular`; preço "A partir de" = menor pacote
- [ ] `product.html?id=free-fire` renderiza pacotes, preço em R$ correto
      (centavos ÷ 100), campo "ID do jogador" validando 4–20 dígitos
- [ ] `product.html?id=<slug sem pacote>` → "Produto não encontrado"
- [ ] Console sem erro nas duas páginas
- [ ] **Network: `products.js` não é requisitado** em nenhuma página
