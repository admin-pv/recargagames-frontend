-- =====================================================================
-- Migration: orders do storefront (Fase 2) — pedido "aguardando pagamento"
-- Data: 2026-09-13 (reescrita com a saída do bloco 0)
-- Objetivo: a loja passa a gravar pedidos em public.orders (tabela que JÁ
--           existe e é escrita pelo proxy Hetzner), com valor calculado
--           no servidor e leitura pelo dono via RLS.
--
-- Como rodar: SQL Editor da instância ashmirzgyuhspymldpfv.
--   1. Bloco 0 (docs/fase2-bloco0.sql) — JÁ RODADO em 13/09, saída
--      resumida logo abaixo.
--   2. Rode do BEGIN ao COMMIT de uma vez. Tudo ou nada: qualquer
--      RAISE EXCEPTION das asserções desfaz a migration inteira.
--   3. Rode a CONFERÊNCIA do fim.
--
-- Não é mais só aditiva: troca a FK de user_id, remove a policy
-- orders_read_own e reescreve os GRANTs de anon/authenticated. Cada
-- mudança tem o porquê no próprio bloco.
--
-- ── O QUE O BLOCO 0 ENCONTROU (13/09) ───────────────────────────────────
--   0a  RLS on (não forced)
--   0b  3 policies, todas {authenticated}, nenhuma 'true':
--         orders_admin_read_all  SELECT  is_admin()
--         orders_admin_write     ALL     is_admin() / is_admin()
--         orders_read_own        SELECT  auth.uid() = user_id
--   0c  anon e authenticated com TODOS os privilégios de tabela   ← P1
--   0d  anon e authenticated com INSERT/SELECT/UPDATE/REFERENCES por coluna
--       → P1 disparou. Decisão do Vinicius: seguir, esta migration É a
--         remediação. Até ela, só a RLS continha anon/authenticated.
--   0e  7 linhas, 1 grupo: user_type=guest, com lapak_tid, sem voucher,
--       sem user_id, status=pending, lapak_status=SUCCESS, country NULL,
--       currency IDR, de 17/07 a 19/08. São as linhas de settlement do
--       proxy (Fase 0).
--   0f  status: pending (7)
--   0g  orders_pkey, orders_bonus_voucher_id_fkey → bonus_vouchers,
--       orders_user_id_fkey → profiles(id) ON DELETE CASCADE,
--       orders_user_type_check IN (guest, regular, premium)
--   0h  índices: pkey, orders_lapak_reference_id_idx, orders_lapak_tid_uidx
--       (UNIQUE parcial); nenhum trigger
--   0i  19 colunas, nenhuma colisão com as novas. ATENÇÃO:
--         created_at é timestamp SEM time zone
--         status default 'pending', currency_code default 'IDR',
--         user_type default 'guest'
--   0j  zero colisões de nome
--   0k  user_id uuid, FK → profiles(id) ON DELETE CASCADE          ← P4
--       → P4 disparou. Decisão: corrigir aqui (bloco 2).
--   0l  payment_methods: transaction_cost_percent numeric, fixed_cost
--       numeric EM REAIS. br: pix 0.99, cc 2.99, debit 1.99, nupay 1.49.
--
-- ── QUEM MAIS ESCREVE EM orders ─────────────────────────────────────────
--   - proxy (settlement F0, server.js applySettlement): service_role.
--     INSERT com só lapak_* (sem status, sem channel, sem user_id) e
--     PATCH só de lapak_*. Ignora RLS e GRANT. Depende dos defaults.
--   - reload: NÃO escreve em orders (conferido no código em 13/09).
--   - admin (aba Pedidos): lê com a chave ANON. Hoje já volta vazio (anon
--     não tem policy); depois do REVOKE, 401. Aceito, ver dívida #2.
--
-- ── NOTAS PARA AS FUNCTIONS (não são mudança de schema) ─────────────────
--   - created_at é timestamp sem tz, gravado em UTC pelo now() do
--     servidor. O browser tem que tratar como UTC (acrescentar 'Z') antes
--     de formatar, senão mostra 3h de diferença em BR.
--   - Defaults herdados do proxy NÃO servem para a loja: orders-create
--     grava status, currency_code, country e channel explicitamente.
--   - fee_cents = round(amount_cents * transaction_cost_percent / 100)
--               + round(fixed_cost * 100)      -- fixed_cost vem em reais
-- =====================================================================


BEGIN;

-- ---------------------------------------------------------------------
-- 1) Colunas novas.
--
--    Todas anuláveis ou com default: o INSERT do proxy, que não conhece
--    nenhuma delas, continua válido.
-- ---------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS channel             text,
  -- Pedido aponta para o PERFIL, além do auth.users: a conta pode ser
  -- excluída (LGPD), o perfil anonimizado sobrevive (0002, ON DELETE SET
  -- NULL em customer_profiles.user_id), e o histórico fiscal continua
  -- referenciável. Sem ON DELETE: perfil não é apagado, só anonimizado.
  ADD COLUMN IF NOT EXISTS customer_profile_id uuid REFERENCES public.customer_profiles(id),
  ADD COLUMN IF NOT EXISTS game_slug           text,
  ADD COLUMN IF NOT EXISTS package_label       text,
  ADD COLUMN IF NOT EXISTS face_value          numeric,
  ADD COLUMN IF NOT EXISTS redemption_fields   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS delivery_email      text,
  ADD COLUMN IF NOT EXISTS payment_method      text,
  ADD COLUMN IF NOT EXISTS payment_status      text        DEFAULT 'awaiting',
  -- Dinheiro em CENTAVOS, inteiro. `price integer` e `final_price_local
  -- numeric` já existem e são legado sem unidade documentada; não
  -- reaproveitados.
  ADD COLUMN IF NOT EXISTS amount_cents        integer,
  -- D2: taxa do meio de pagamento ABSORVIDA. Gravada como custo, não
  -- somada ao amount_cents.
  ADD COLUMN IF NOT EXISTS fee_cents           integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_ref         text,
  -- Validação prévia do ID do jogador contra o SKU, antes da cobrança.
  -- Ver docs/modelo-catalogo-e-fulfillment.md, seção 4. Na Fase 2 a
  -- Function grava sempre 'unsupported'. NULL = outro canal ou anterior.
  ADD COLUMN IF NOT EXISTS id_validation       text,
  ADD COLUMN IF NOT EXISTS paid_at             timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at        timestamptz,
  -- D4: PIN visível em order-details até completed_at + 24h. Fase 2 só
  -- cria a coluna; quem escreve é o fulfillment da Fase 3.
  ADD COLUMN IF NOT EXISTS code_visible_until  timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at          timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at          timestamptz DEFAULT now();


-- ---------------------------------------------------------------------
-- 1b) Backfill de channel — as linhas de hoje são do proxy.
--
--    Decisão do Vinicius (13/09): 'proxy', espelho do settlement F0.
--
--    A asserção existe porque entre o bloco 0 e esta execução o proxy
--    pode ter inserido linha nova, e porque um dia pode existir linha
--    sem channel que NÃO é do proxy. Só marcamos 'proxy' o que tem a
--    assinatura do proxy (lapak_tid preenchido, sem user_id). Qualquer
--    outra coisa aborta a migration inteira para alguém olhar.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  estranhas integer;
BEGIN
  SELECT count(*) INTO estranhas
    FROM public.orders
   WHERE channel IS NULL
     AND (lapak_tid IS NULL OR user_id IS NOT NULL);
  IF estranhas > 0 THEN
    RAISE EXCEPTION '0003: % linha(s) sem channel que não têm a assinatura do proxy (lapak_tid + user_id NULL). Abortado.', estranhas;
  END IF;
END $$;

UPDATE public.orders SET channel = 'proxy' WHERE channel IS NULL;

-- >>> CONFIRMAR ANTES DE APLICAR (ponto A, ver relatório de 13/09) <<<
--
-- DEFAULT 'proxy', e não 'storefront' como no brief.
--
-- Por quê: o proxy insere linhas de settlement SEM informar channel
-- (server.js, applySettlement). Com default 'storefront', toda linha
-- nova do proxy nasceria rotulada como pedido da loja — o mesmo erro que
-- o backfill acima evita nas 7 de hoje, só que contínuo. As Functions
-- da loja gravam channel = 'storefront' explicitamente e não dependem do
-- default. O proxy é hoje o ÚNICO escritor que depende dele.
--
-- Quando o proxy passar a mandar channel (repo playvision-proxy), o
-- default pode sair e a coluna fica NOT NULL sem default.
ALTER TABLE public.orders ALTER COLUMN channel SET DEFAULT 'proxy';
ALTER TABLE public.orders ALTER COLUMN channel SET NOT NULL;


-- ---------------------------------------------------------------------
-- 2) FK de user_id: profiles(id) CASCADE → auth.users(id) SET NULL.
--
--    Achado P4 do bloco 0. Dois defeitos na FK atual, cada um bloqueante
--    sozinho:
--
--    a) APONTA PARA A TABELA ERRADA. public.profiles é a identidade do
--       ADMIN (ver 0002). Cliente da loja não tem linha lá — confirmado no
--       C3.5 da Fase 1: profiles com JWT de cliente devolve []. Todo
--       INSERT do orders-create com user_id do cliente falharia com
--       violação de FK (23503). E a policy `user_id = auth.uid()` compara
--       com o id do auth.users, que é outro espaço de ids.
--
--    b) ON DELETE CASCADE. Pedido tem retenção fiscal. Com CASCADE,
--       apagar a identidade apagaria o histórico junto. A exclusão de
--       conta (account-delete) apaga de auth.users; com SET NULL o pedido
--       sobrevive, anônimo, ainda ligado ao perfil anonimizado por
--       customer_profile_id. Mesmo padrão de customer_profiles.user_id.
--
--    Seguro hoje: as 7 linhas têm user_id NULL (0e). A asserção abaixo
--    garante que isso continua verdade no momento de aplicar — um
--    user_id que aponta para profiles.id quase certamente NÃO existe em
--    auth.users com o mesmo valor, e o ADD CONSTRAINT falharia de forma
--    menos clara.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  com_user integer;
BEGIN
  SELECT count(*) INTO com_user FROM public.orders WHERE user_id IS NOT NULL;
  IF com_user > 0 THEN
    RAISE EXCEPTION '0003: % linha(s) com user_id preenchido — trocar a FK de profiles para auth.users exige olhar uma a uma. Abortado.', com_user;
  END IF;
END $$;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_user_id_fkey;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


-- ---------------------------------------------------------------------
-- 3) Constraints. Em DO para serem re-executáveis (Postgres não tem
--    ADD CONSTRAINT IF NOT EXISTS).
--
--    status: 'pending' é o default herdado e o que o proxy usa (nunca
--    escreve status, depende do default). Os demais são os da loja.
--    Proxy PATCHa só lapak_*, então não há outro valor em trânsito.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.orders'::regclass AND conname='orders_amount_cents_nonneg') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_amount_cents_nonneg
      CHECK (amount_cents >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.orders'::regclass AND conname='orders_fee_cents_nonneg') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_fee_cents_nonneg
      CHECK (fee_cents >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.orders'::regclass AND conname='orders_channel_check') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_channel_check
      CHECK (channel IN ('storefront', 'reload', 'proxy', 'partner'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.orders'::regclass AND conname='orders_id_validation_check') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_id_validation_check
      CHECK (id_validation IS NULL OR id_validation IN ('valid', 'invalid', 'unsupported', 'error'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.orders'::regclass AND conname='orders_status_check') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
      CHECK (status IN (
        'pending',                                    -- proxy (default herdado)
        'awaiting_payment', 'paid', 'fulfilling',     -- loja
        'completed', 'failed', 'refunded', 'expired', 'cancelled'
      ));
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- 4) Índices.
--    (user_id, created_at desc) — "Meus pedidos" e o rate limit da Function.
--    (status, expires_at)       — a varredura de expiração a cada 10 min.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS orders_user_created_idx
  ON public.orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_expires_idx
  ON public.orders (status, expires_at);


-- ---------------------------------------------------------------------
-- 5) RLS e privilégios.
--
--    POR QUE O BROWSER NUNCA ESCREVE EM orders:
--    um pedido carrega o VALOR que vai ser cobrado. Se o browser pudesse
--    inserir ou atualizar a linha, o preço seria o que o cliente dissesse
--    — e o mesmo vale para status (marcar como pago) e product_code
--    (trocar o pacote depois de calculado o valor). Toda escrita passa
--    pelas Netlify Functions (orders-create, orders-expire), que
--    recalculam do catálogo e gravam com a secret key.
--
--    ACHADO P1 (bloco 0): até esta migration, anon e authenticated tinham
--    TODOS os privilégios de tabela em orders. O que impedia escrita era
--    só a RLS (nenhuma policy para anon; para authenticated, só as de
--    is_admin()). Uma policy permissiva criada por engano abriria a
--    tabela na hora. Daqui para frente são duas trancas: sem GRANT de
--    escrita E sem policy de escrita para cliente.
-- ---------------------------------------------------------------------
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.orders FROM anon, authenticated;

-- SELECT POR COLUNA, em LISTA POSITIVA.
--
-- Coluna nova nasce FECHADA (mesmo raciocínio da WRITABLE da 0002). Com
-- lista negativa, a próxima coluna interna que o proxy criar (custo
-- Lapak, margem, IP) ficaria legível pelo cliente sem ninguém decidir.
--
-- Fora da lista: lapak_* e settled_at (fornecedor), bonus_voucher_id,
-- user_type, payment_ref, price, final_price_local, discount_applied
-- (legado sem unidade), fee_cents (custo nosso), id_validation
-- (diagnóstico interno — a recusa chega ao cliente como 400 na criação).
--
-- CONSEQUÊNCIAS:
--   - `select=*` passa a dar 42501 para o browser. As páginas pedem as
--     colunas pelo nome (ORDER_COLUMNS em app/shared/js/store.js, que TEM
--     que espelhar esta lista).
--   - As policies orders_admin_* continuam existindo, mas um admin como
--     `authenticated` também só lê estas colunas e não escreve (sem
--     GRANT). Hoje nada muda: o admin fala como anon. Ver dívida #2.
GRANT SELECT (
  id,
  user_id,
  channel,
  status,
  payment_status,
  country,
  currency_code,
  game_slug,
  product_code,
  package_label,
  face_value,
  amount_cents,
  redemption_fields,
  delivery_email,
  payment_method,
  created_at,
  updated_at,
  paid_at,
  completed_at,
  code_visible_until,
  expires_at
) ON public.orders TO authenticated;

-- >>> CONFIRMAR ANTES DE APLICAR (ponto B, ver relatório de 13/09) <<<
--
-- DROP da policy existente orders_read_own.
--
-- Por quê: policies PERMISSIVAS se somam com OR. orders_read_own
-- (`auth.uid() = user_id`) continuaria liberando qualquer linha com o
-- user_id do cliente, de qualquer canal, e o `channel = 'storefront'` da
-- policy nova viraria enfeite. Ela é substituída por orders_select_own,
-- que é a mesma regra mais o filtro de canal.
--
-- Quem perde algo: ninguém hoje. Proxy e Functions usam secret key
-- (ignoram RLS); nenhuma linha atual tem user_id; o admin usa anon.
DROP POLICY IF EXISTS orders_read_own ON public.orders;

DROP POLICY IF EXISTS orders_select_own ON public.orders;
CREATE POLICY orders_select_own
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND channel = 'storefront');

-- INSERT / UPDATE / DELETE para cliente — NENHUMA POLICY, NENHUM GRANT.
-- anon — nenhum GRANT. orders_admin_read_all e orders_admin_write ficam
-- como estão (repo do admin, dívida #1/#2).

COMMENT ON TABLE public.orders IS
  'Pedidos de todos os canais (storefront, reload, proxy, partner). Browser só LÊ, só os próprios da loja, só colunas da lista positiva (0003). Escrita só server-side com secret key.';


-- ---------------------------------------------------------------------
-- 6) Trigger de updated_at.
--    Nome com sufixo _storefront (0j confirmou livre). Dispara também nos
--    PATCHes do proxy — só carimba updated_at, coluna que ele não lê.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_orders_updated_at_storefront()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_touch_updated_at ON public.orders;
CREATE TRIGGER orders_touch_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_orders_updated_at_storefront();

COMMIT;


-- =====================================================================
-- CONFERÊNCIA PÓS-APLICAÇÃO (read-only, uma query por vez)
--
--   C-1  18 colunas novas (tabela passa de 19 para 37); channel NOT NULL
--        default 'proxy';
--        updated_at default now()
--   C-2  channel: proxy = 7, nenhum NULL
--   C-3  rls_on = true
--   C-4  exatamente 3 policies: orders_admin_read_all, orders_admin_write,
--        orders_select_own. orders_read_own AUSENTE. Nenhuma 'true'.
--   C-5  privilégio de TABELA para anon/authenticated: ZERO linhas
--        >>> SELECT de tabela aqui = o GRANT por coluna não pegou. Parar. <<<
--   C-6  privilégio de COLUNA: exatamente 21 linhas, todas SELECT, todas
--        authenticated; nenhuma para lapak_*, bonus_voucher_id, user_type,
--        payment_ref, fee_cents, id_validation, price
--   C-7  anon: zero linhas em C-5 e C-6
--   C-8  constraints: orders_amount_cents_nonneg, orders_fee_cents_nonneg,
--        orders_channel_check, orders_id_validation_check,
--        orders_status_check, e orders_user_id_fkey → auth.users ON DELETE SET NULL
--   C-9  índices orders_user_created_idx, orders_status_expires_idx;
--        trigger orders_touch_updated_at
-- =====================================================================

-- C-1
-- SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='orders'
--    AND column_name IN ('channel','customer_profile_id','game_slug','package_label',
--      'face_value','redemption_fields','delivery_email','payment_method','payment_status',
--      'amount_cents','fee_cents','payment_ref','id_validation','paid_at','completed_at',
--      'code_visible_until','expires_at','updated_at')
--  ORDER BY column_name;
-- Esperado: 18 linhas. Total de colunas da tabela: 37.

-- C-2
-- SELECT channel, count(*) FROM public.orders GROUP BY 1;

-- C-3
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'public.orders'::regclass;

-- C-4
-- SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies WHERE schemaname='public' AND tablename='orders'
--  ORDER BY policyname;

-- C-5
-- SELECT grantee, privilege_type
--   FROM information_schema.role_table_grants
--  WHERE table_schema='public' AND table_name='orders'
--    AND grantee IN ('anon','authenticated');

-- C-6 / C-7
-- SELECT grantee, privilege_type, column_name
--   FROM information_schema.column_privileges
--  WHERE table_schema='public' AND table_name='orders'
--    AND grantee IN ('anon','authenticated')
--  ORDER BY grantee, privilege_type, column_name;

-- C-8
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid='public.orders'::regclass ORDER BY conname;

-- C-9
-- SELECT indexname FROM pg_indexes
--  WHERE schemaname='public' AND indexname IN ('orders_user_created_idx','orders_status_expires_idx');
-- SELECT tgname FROM pg_trigger WHERE tgname = 'orders_touch_updated_at';
-- =====================================================================
