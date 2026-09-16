-- =====================================================================
-- Migration: motor comercial Modelo 2 — pricing de oportunidades B2B
-- Data: 2026-09-16
-- Objetivo: automatizar o pricing que hoje é feito à mão na planilha v5
--           (Plusmo). Custo do dia vem da Lapak por snapshot; benchmark
--           oficial e elegibilidade por mercado ficam em banco; um
--           gerador local produz a planilha interna e o Annex A.
--
-- Como rodar: SQL Editor da instância ashmirzgyuhspymldpfv, do BEGIN ao
--   COMMIT de uma vez. As asserções do fim do bloco 3 desfazem tudo se
--   sobrar qualquer privilégio de browser nas tabelas novas.
--
-- ADITIVA E ISOLADA. Não referencia, não altera e não lê nenhuma tabela
-- existente (orders, games, price_benchmarks, customer_profiles). Loja,
-- admin e proxy não dependem de nada aqui. Rollback: DROP TABLE das
-- com_*, nesta ordem inversa, sem efeito colateral.
--
-- ── O QUE FOI CONFERIDO AO VIVO NA API, EM 16/09 ────────────────────────
-- (via POST /gateway do proxy; motiva metade das decisões abaixo)
--
--   A) /all-products JÁ DEVOLVE group_product_code E provider_code como
--      campos próprios. A regex `-S\d+` do brief seria errada: 20 dos 71
--      providers do BR não casam com ela (S110AB2C, S11AUTO, S50A, S98M,
--      S121M…). O snapshot grava os campos da API; regex só como último
--      recurso para código órfão.
--
--   B) Contagem por país (total / available):
--        br 5042/965   ar 1537/261   mx 1477/224   pe 1537/261
--        co 1537/261   us 6546/1008  ph 13056/3431 sg 9744/2205
--        in   81/0
--      Nenhum país foi recusado. `in` responde SUCCESS com 81 produtos e
--      ZERO available — está na lista, mas hoje não contribui custo.
--      Total: ~40,5k linhas/dia se gravar tudo, ~8,6k só o available.
--
--   C) `price` vem inteiro, em IDR (rúpia indonésia). Daí price_idr bigint.
--
--   D) /fx-rate.php EXIGE x-proxy-key e o par é USD→IDR, não IDR→USD:
--        IDR→USD  → 404 NOT_FOUND
--        USD→IDR  → buy_rate = sell_rate = 17663 (16/09 00:00:07)
--      Custo USD = price_idr / rate. Ver a convenção do bloco 2.
--      Outros pares que a Lapak tem: USD→ARS, USD→PEN, USD→COP, USD→PHP.
--      NÃO tem: USD→BRL, USD→MXN, USD→SGD, USD→INR — por isso o mercado
--      MX da Plusmo continua dependendo de com_opportunities.fx_overrides.
--
-- ── DADO SENSÍVEL ───────────────────────────────────────────────────────
-- Custo de fornecedor e margem estão nestas tabelas. NENHUMA delas tem
-- policy ou GRANT para anon/authenticated: acesso só com a secret key
-- (Scheduled Function e script local). O default do Supabase dá privilégio
-- total ao browser em tabela nova — foi o achado P1 da 0003 — então cada
-- CREATE TABLE aqui é seguido de REVOKE, e o bloco 3 confere.
-- =====================================================================


BEGIN;

-- ---------------------------------------------------------------------
-- 1) Supply — a fotografia diária do custo Lapak.
--
--    Uma linha por (dia, país consultado, código de produto). O mesmo
--    produto aparece em vários países com preço diferente, e a regra de
--    custo varre todos os países do snapshot: por isso query_country
--    está na PK, e não é a mesma coisa que "onde pode vender" (lição da
--    Fase 2 — o país da Lapak não define elegibilidade).
--
--    IMUTÁVEL POR DIA: o upsert do dia sobrescreve a própria linha; dia
--    anterior nunca é reescrito. É o que faz o DELTA ser confiável.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.com_supply_snapshots (
  snapshot_date  date   NOT NULL,
  query_country  text   NOT NULL,
  product_code   text   NOT NULL,   -- ex: FFLATAM100-S116, BST1000-S1-ph
  group_code     text   NOT NULL,   -- group_product_code da Lapak
  provider_code  text   NOT NULL,   -- provider_code da Lapak (NÃO da regex)
  price_idr      bigint NOT NULL,
  status         text   NOT NULL,   -- "available" | "empty" (só o que a Lapak manda)
  category_code  text,
  CONSTRAINT com_supply_snapshots_pkey PRIMARY KEY (snapshot_date, query_country, product_code),
  CONSTRAINT com_supply_price_nonneg   CHECK (price_idr >= 0),
  -- País em minúscula, como a Lapak usa. Sem lista fixa: a lista de países
  -- varridos é env (SNAPSHOT_COUNTRIES), e acrescentar país não pode exigir
  -- migration.
  CONSTRAINT com_supply_country_lower  CHECK (query_country = lower(query_country))
  -- `status` de propósito SEM check: um valor novo da Lapak derrubaria a
  -- rotina diária inteira em vez de só aparecer no relatório.
);

-- Caminho quente do gerador: "para esta data, o menor available de cada
-- grupo". A PK não serve (começa por data mas depois é país/código).
CREATE INDEX IF NOT EXISTS com_supply_date_group_idx
  ON public.com_supply_snapshots (snapshot_date, group_code, status);

COMMENT ON TABLE public.com_supply_snapshots IS
  'Custo Lapak por dia/país/SKU (IDR). DADO SENSÍVEL: custo de atacado. Só service role. Escrito pela Scheduled Function supply-snapshot.';


-- ---------------------------------------------------------------------
-- 2) Câmbio do dia.
--
--    CONVENÇÃO, uma só em todo o motor: `pair` é 'BASE_QUOTE' e `rate` é
--    quantas unidades de QUOTE valem 1 unidade de BASE. 'USD_IDR' = 17663
--    significa 17663 IDR por 1 USD, então custo_usd = price_idr / rate.
--    É a mesma convenção do fx_overrides da oportunidade ("unidades locais
--    por 1 USD"), de propósito: um único sentido de divisão no código.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.com_fx_rates (
  rate_date date    NOT NULL,
  pair      text    NOT NULL,       -- 'USD_IDR', 'USD_ARS', 'USD_PEN', …
  rate      numeric NOT NULL,
  source    text    NOT NULL,       -- 'lapak' | 'manual'
  CONSTRAINT com_fx_rates_pkey    PRIMARY KEY (rate_date, pair),
  CONSTRAINT com_fx_rate_positive CHECK (rate > 0),
  CONSTRAINT com_fx_pair_format   CHECK (pair ~ '^[A-Z]{3}_[A-Z]{3}$')
);

COMMENT ON TABLE public.com_fx_rates IS
  'Câmbio do dia. pair = BASE_QUOTE, rate = unidades de QUOTE por 1 BASE (USD_IDR 17663 = 17663 IDR por USD).';


-- ---------------------------------------------------------------------
-- 3) Benchmark oficial — quanto o fabricante cobra no mercado.
--
--    É pesquisa manual com QA, mantida por CSV (scripts/benchmark-import.mjs).
--    `market` = 'GLOBAL' é o fallback quando não há benchmark do mercado.
--
--    qa_status governa o cálculo de headroom (regra da v5):
--      TRUSTED  conferido na fonte oficial          → calcula headroom
--      VERIFY   plausível, falta reconferir         → calcula headroom
--      COLLECT  ainda não pesquisado                → sem headroom (aparece em FLAGS)
--      SUSPECT  número duvidoso                     → NÃO calcula headroom
--      BLOCKED  não vende / sem referência no mercado → NÃO calcula headroom
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.com_benchmarks (
  group_code     text    NOT NULL,
  market         text    NOT NULL,  -- 'AR', 'MX', 'PE', … ou 'GLOBAL'
  official_price numeric,           -- NULL é legítimo em COLLECT/BLOCKED
  currency       text,
  qa_status      text    NOT NULL,
  note           text,
  collected_at   date,
  CONSTRAINT com_benchmarks_pkey      PRIMARY KEY (group_code, market),
  CONSTRAINT com_benchmarks_qa_check  CHECK (qa_status IN ('TRUSTED','VERIFY','SUSPECT','COLLECT','BLOCKED')),
  CONSTRAINT com_benchmarks_market_up CHECK (market = upper(market)),
  CONSTRAINT com_benchmarks_price_pos CHECK (official_price IS NULL OR official_price > 0),
  -- ISO 4217 em maiúscula. A lista de moedas aceitas vive no import (é
  -- extensível sem migration); aqui só o formato.
  CONSTRAINT com_benchmarks_ccy_fmt   CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  -- Preço sem moeda é número solto: ou vêm os dois, ou nenhum.
  CONSTRAINT com_benchmarks_price_ccy CHECK ((official_price IS NULL) = (currency IS NULL))
);

COMMENT ON TABLE public.com_benchmarks IS
  'Preço oficial de referência por grupo e mercado, com status de QA. market=GLOBAL é o fallback. Mantido por CSV (scripts/benchmark-import.mjs).';


-- ---------------------------------------------------------------------
-- 4) DE>PARA do operador — onde cada grupo PODE ser vendido.
--
--    Decisão humana, não dado da Lapak (Fase 2: o country_code do produto
--    não diz onde ele funciona). Sem linha enabled aqui, o grupo não é
--    cotado naquele mercado.
--
--    sku_override: quando o operador quer um SKU específico em vez do
--    "menor available do grupo" (provider que ele sabe que entrega, por
--    exemplo). Guarda o product_code inteiro, com sufixo de país se tiver.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.com_sku_markets (
  group_code   text    NOT NULL,
  market       text    NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,
  sku_override text,
  source       text,                -- de onde veio a decisão: 'v5', 'operador', …
  CONSTRAINT com_sku_markets_pkey      PRIMARY KEY (group_code, market),
  CONSTRAINT com_sku_markets_market_up CHECK (market = upper(market)),
  -- GLOBAL é conceito de benchmark, não de venda: não faz sentido aqui.
  CONSTRAINT com_sku_markets_not_global CHECK (market <> 'GLOBAL')
);

COMMENT ON TABLE public.com_sku_markets IS
  'DE>PARA do operador: grupo x mercado elegível, com SKU forçado opcional. Fonte de "pode vender" — nunca o country_code da Lapak.';


-- ---------------------------------------------------------------------
-- 5) Oportunidade — um parceiro B2B e as regras de pricing dele.
--
--    markup_pct e fee_fixed_usd são a margem. DADO SENSÍVEL: não saem no
--    Annex A. fx_overrides é jsonb {"MXN": 18.5} na convenção do bloco 2
--    (unidades locais por 1 USD) e vence o com_fx_rates do dia.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.com_opportunities (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text        NOT NULL UNIQUE,
  name          text        NOT NULL,
  markets       text[]      NOT NULL,
  markup_pct    numeric     NOT NULL,
  fee_fixed_usd numeric     NOT NULL DEFAULT 0,
  fx_overrides  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status        text        NOT NULL DEFAULT 'active',
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT com_opportunities_status_check CHECK (status IN ('active','archived')),
  -- markup é fração, não percentual: 0.02 = 2%. Teto de 1 (100%) para
  -- pegar na hora quem digitar 2 achando que são 2%.
  CONSTRAINT com_opportunities_markup_range CHECK (markup_pct >= 0 AND markup_pct <= 1),
  CONSTRAINT com_opportunities_fee_nonneg   CHECK (fee_fixed_usd >= 0),
  CONSTRAINT com_opportunities_markets_len  CHECK (array_length(markets, 1) >= 1),
  CONSTRAINT com_opportunities_slug_fmt     CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  CONSTRAINT com_opportunities_fx_obj       CHECK (jsonb_typeof(fx_overrides) = 'object')
);

COMMENT ON TABLE public.com_opportunities IS
  'Oportunidade comercial B2B (parceiro). DADO SENSÍVEL: markup_pct e fee_fixed_usd são a margem. markup_pct é fração (0.02 = 2%).';


-- ---------------------------------------------------------------------
-- 6) Itens da oportunidade — a lista de produtos cotados.
--
--    title/item_label/fulfillment são a COPY que vai pro parceiro (as
--    colunas do Annex A); group_code é a chave técnica que liga ao custo.
--    include=false guarda o item na lista sem cotar — a v5 mantém o
--    histórico do que já foi discutido.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.com_opportunity_items (
  opportunity_id     uuid    NOT NULL REFERENCES public.com_opportunities(id) ON DELETE CASCADE,
  group_code         text    NOT NULL,
  title              text    NOT NULL,   -- "Free Fire"
  item_label         text    NOT NULL,   -- "100 Diamonds"
  fulfillment        text    NOT NULL,   -- 'topup' | 'pin'
  include            boolean NOT NULL DEFAULT true,
  custom_markup_pct  numeric,            -- NULL = usa o markup da oportunidade
  CONSTRAINT com_opportunity_items_pkey         PRIMARY KEY (opportunity_id, group_code),
  CONSTRAINT com_opportunity_items_fulfil_check CHECK (fulfillment IN ('topup','pin')),
  CONSTRAINT com_opportunity_items_markup_range CHECK (custom_markup_pct IS NULL OR (custom_markup_pct >= 0 AND custom_markup_pct <= 1))
);

COMMENT ON TABLE public.com_opportunity_items IS
  'Itens cotados de uma oportunidade. title/item_label/fulfillment são a copy que vai pro parceiro; group_code liga ao custo do snapshot.';


-- ---------------------------------------------------------------------
-- 7) Segurança — nenhuma destas tabelas existe para o browser.
--
--    Lição da 0003 (achado P1): tabela nova no Supabase nasce com TODOS
--    os privilégios para anon e authenticated, e o que segura é só a RLS.
--    Aqui são as duas trancas: RLS ligada SEM NENHUMA POLICY (nega tudo,
--    inclusive leitura) e REVOKE ALL (nem o privilégio existe).
--
--    Quem escreve e lê: a Scheduled Function supply-snapshot e os scripts
--    locais, ambos com a secret key, que ignora RLS por ser service role.
--    Quando a tela de oportunidades entrar no admin (depois da dívida #1),
--    ela fala com uma Function, não com a tabela.
-- ---------------------------------------------------------------------
ALTER TABLE public.com_supply_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.com_fx_rates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.com_benchmarks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.com_sku_markets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.com_opportunities     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.com_opportunity_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.com_supply_snapshots  FROM anon, authenticated;
REVOKE ALL ON public.com_fx_rates          FROM anon, authenticated;
REVOKE ALL ON public.com_benchmarks        FROM anon, authenticated;
REVOKE ALL ON public.com_sku_markets       FROM anon, authenticated;
REVOKE ALL ON public.com_opportunities     FROM anon, authenticated;
REVOKE ALL ON public.com_opportunity_items FROM anon, authenticated;


-- ---------------------------------------------------------------------
-- 8) Asserções — a migration se recusa a existir mal fechada.
--
--    Mesma query de privilégios do bloco 0 da Fase 2, só que dentro da
--    transação: qualquer privilégio de tabela OU de coluna sobrando para
--    anon/authenticated, ou qualquer policy criada por engano, aborta e
--    desfaz tudo.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  tabelas   text[] := ARRAY['com_supply_snapshots','com_fx_rates','com_benchmarks',
                            'com_sku_markets','com_opportunities','com_opportunity_items'];
  sobrando  integer;
  sem_rls   text;
  policies  integer;
BEGIN
  -- PUBLIC entra na conta junto com anon/authenticated: privilégio dado a
  -- PUBLIC é herdado por todo mundo, inclusive pelo anon, e passaria
  -- despercebido numa checagem que só olha os dois nomes.
  SELECT count(*) INTO sobrando
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = ANY(tabelas)
     AND grantee IN ('anon','authenticated','PUBLIC');
  IF sobrando > 0 THEN
    RAISE EXCEPTION '0004: % privilégio(s) de TABELA sobrando para anon/authenticated/PUBLIC nas com_*. Abortado.', sobrando;
  END IF;

  SELECT count(*) INTO sobrando
    FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = ANY(tabelas)
     AND grantee IN ('anon','authenticated','PUBLIC');
  IF sobrando > 0 THEN
    RAISE EXCEPTION '0004: % privilégio(s) de COLUNA sobrando para anon/authenticated/PUBLIC nas com_*. Abortado.', sobrando;
  END IF;

  SELECT count(*) INTO policies
    FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY(tabelas);
  IF policies > 0 THEN
    RAISE EXCEPTION '0004: % policy(ies) nas com_* — estas tabelas não têm policy nenhuma. Abortado.', policies;
  END IF;

  SELECT string_agg(c.relname, ', ') INTO sem_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = ANY(tabelas) AND c.relrowsecurity = false;
  IF sem_rls IS NOT NULL THEN
    RAISE EXCEPTION '0004: RLS desligada em: %. Abortado.', sem_rls;
  END IF;
END $$;

COMMIT;


-- =====================================================================
-- CONFERÊNCIA PÓS-APLICAÇÃO (read-only, uma query por vez)
--
--   C-1  6 tabelas com_* criadas
--   C-2  RLS ligada nas 6, ZERO policies
--   C-3  privilégio de TABELA para anon/authenticated/PUBLIC: ZERO linhas
--   C-4  privilégio de COLUNA para anon/authenticated/PUBLIC: ZERO linhas
--        >>> qualquer linha em C-3 ou C-4 = custo de fornecedor exposto
--            ao browser. Parar e corrigir antes de seguir. <<<
--   C-5  índice com_supply_date_group_idx presente
-- =====================================================================

-- C-1
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema='public' AND table_name LIKE 'com\_%' ORDER BY 1;

-- C-2
-- SELECT c.relname, c.relrowsecurity,
--        (SELECT count(*) FROM pg_policies p
--          WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies
--   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--  WHERE n.nspname='public' AND c.relname LIKE 'com\_%' ORDER BY 1;

-- C-3
-- SELECT grantee, table_name, privilege_type
--   FROM information_schema.role_table_grants
--  WHERE table_schema='public' AND table_name LIKE 'com\_%'
--    AND grantee IN ('anon','authenticated','PUBLIC');

-- C-4
-- SELECT grantee, table_name, privilege_type, column_name
--   FROM information_schema.column_privileges
--  WHERE table_schema='public' AND table_name LIKE 'com\_%'
--    AND grantee IN ('anon','authenticated','PUBLIC');

-- C-5
-- SELECT indexname FROM pg_indexes
--  WHERE schemaname='public' AND tablename='com_supply_snapshots';
-- =====================================================================


-- =====================================================================
-- ROLLBACK (não faz parte da migration — copiar e colar se precisar)
--
--   DROP TABLE IF EXISTS public.com_opportunity_items;
--   DROP TABLE IF EXISTS public.com_opportunities;
--   DROP TABLE IF EXISTS public.com_sku_markets;
--   DROP TABLE IF EXISTS public.com_benchmarks;
--   DROP TABLE IF EXISTS public.com_fx_rates;
--   DROP TABLE IF EXISTS public.com_supply_snapshots;
--
-- Nenhuma outra tabela referencia estas: o DROP não cascateia para fora
-- do motor comercial.
-- =====================================================================
