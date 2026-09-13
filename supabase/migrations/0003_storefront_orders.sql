-- =====================================================================
-- Migration: orders do storefront (Fase 2) — pedido "aguardando pagamento"
-- Data: 2026-09-13
-- Objetivo: a loja passa a gravar pedidos em public.orders (tabela que JÁ
--           existe e é usada pelo proxy Hetzner e pelo reload), com valor
--           calculado no servidor e leitura pelo dono via RLS.
--
-- Como rodar: SQL Editor da instância ashmirzgyuhspymldpfv.
--   1. Rode o BLOCO 0 (docs/fase2-bloco0.sql), uma query por vez, e leia a saída.
--   2. Preencha os dois pontos marcados >>> PREENCHER APÓS O BLOCO 0 <<<.
--   3. Rode do BEGIN ao COMMIT de uma vez. Tudo ou nada.
--   4. Rode a CONFERÊNCIA do fim.
--
-- ADITIVA. Só ADD COLUMN, ADD CONSTRAINT, CREATE INDEX, uma policy nova,
-- um trigger novo e a troca de GRANTs de anon/authenticated. Não remove
-- coluna, não muda tipo, não mexe em linha além do backfill de `channel`.
--
-- QUEM MAIS ESCREVE AQUI, e por que nada disto os quebra:
--   - proxy (playvision-proxy, Fase 0 settlement): service_role. Ignora
--     RLS e GRANT de anon/authenticated. As colunas novas são todas
--     anuláveis ou têm default, então o INSERT dele continua válido.
--   - reload: secret key, mesmo raciocínio.
--   - admin (aba Pedidos): lê orders com a chave ANON via fetch cru. A
--     migration 0001 do proxy já ligou RLS sem policy, então essa aba já
--     devolve lista vazia hoje. Depois do REVOKE abaixo ela passa a
--     devolver 401. Não perde dado nenhum (já não via nada), mas o erro
--     fica visível. Conserto é no repo do admin, junto da dívida #1.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0) PRÉ-VOO — OBRIGATÓRIO. Read-only.
--
--    As queries vivem num arquivo só, pronto para o SQL Editor:
--      docs/fase2-bloco0.sql   (0a a 0l, uma por vez)
--    Um lugar só, para as duas cópias não divergirem.
--
-- >>> REGRAS DE PARADA (repetidas lá). Se qualquer uma bater, NÃO rode o resto. <<<
--   P1. anon ou authenticated com privilégio de escrita em orders (0c/0d)
--   P2. policy com qual/with_check = 'true' (0b)
--   P3. colisão de nome (0j devolve linha)
--   P4. orders.user_id não é uuid ou não referencia auth.users (0k)
--   P5. coluna que esta migration cria já existe com outro tipo (0i)
-- ---------------------------------------------------------------------


-- =====================================================================
-- APLICAÇÃO — só depois do bloco 0 lido e dos dois PREENCHER resolvidos.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 1) Colunas.
--
--    Todas anuláveis ou com default: um INSERT do proxy/reload que não
--    conhece estas colunas continua válido.
--
--    `channel` entra SEM default primeiro, é preenchida nas linhas de
--    hoje, e só então ganha default e NOT NULL. Com o default já no
--    ADD COLUMN, as 7 linhas existentes nasceriam 'storefront', que é
--    falso para todas elas.
-- ---------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS channel             text,
  -- Pedido aponta para o PERFIL, não para auth.users: a conta pode ser
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
  -- numeric` já existem e são do proxy/reload; não reaproveitados porque
  -- a unidade deles não é documentada e o reload os lê.
  ADD COLUMN IF NOT EXISTS amount_cents        integer,
  -- D2: taxa do meio de pagamento ABSORVIDA. Gravada como custo, não
  -- somada ao amount_cents.
  ADD COLUMN IF NOT EXISTS fee_cents           integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_ref         text,
  -- Resultado da validação prévia do ID do jogador contra o SKU, antes
  -- da cobrança. Ver docs/modelo-catalogo-e-fulfillment.md, seção 4.
  -- Em 13/09 nenhum SKU nosso tem check de ID na Lapak: a Function grava
  -- 'unsupported'. NULL = pedido de outro canal ou anterior à 0003.
  ADD COLUMN IF NOT EXISTS id_validation       text,
  ADD COLUMN IF NOT EXISTS paid_at             timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at        timestamptz,
  -- D4: PIN visível em order-details até completed_at + 24h. Fase 2 só
  -- cria a coluna; quem escreve é o fulfillment da Fase 3.
  ADD COLUMN IF NOT EXISTS code_visible_until  timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at          timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at          timestamptz;

-- >>> PREENCHER APÓS O BLOCO 0 (0e) — backfill de channel <<<
-- Proposta, a confirmar contra a saída de 0e: pedido com voucher de
-- bônus ou user_type de reload é 'reload'; o resto que o proxy criou é
-- 'partner'. Nenhuma linha de hoje é 'storefront' (a loja nunca gravou
-- em orders antes desta fase).
--
-- UPDATE public.orders SET channel = 'reload'
--  WHERE channel IS NULL AND (bonus_voucher_id IS NOT NULL OR user_type = '<?>');
-- UPDATE public.orders SET channel = 'partner'
--  WHERE channel IS NULL;

ALTER TABLE public.orders ALTER COLUMN channel SET DEFAULT 'storefront';
ALTER TABLE public.orders ALTER COLUMN channel SET NOT NULL;   -- falha se o backfill esqueceu alguma linha. É o ponto.

ALTER TABLE public.orders ALTER COLUMN updated_at SET DEFAULT now();


-- ---------------------------------------------------------------------
-- 2) Constraints. Em DO para serem re-executáveis (Postgres não tem
--    ADD CONSTRAINT IF NOT EXISTS).
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.orders'::regclass AND conname='orders_amount_cents_nonneg') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_amount_cents_nonneg CHECK (amount_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.orders'::regclass AND conname='orders_fee_cents_nonneg') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_fee_cents_nonneg CHECK (fee_cents >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.orders'::regclass AND conname='orders_channel_check') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_channel_check
      CHECK (channel IN ('storefront','reload','partner'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.orders'::regclass AND conname='orders_id_validation_check') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_id_validation_check
      CHECK (id_validation IS NULL OR id_validation IN ('valid','invalid','unsupported','error'));
  END IF;
END $$;

-- >>> PREENCHER APÓS O BLOCO 0 (0f) — CHECK de status <<<
-- Só entra se TODO status devolvido por 0f couber na lista. Acrescentar
-- à lista os que o proxy/reload já usam; se algum não fizer sentido
-- acrescentar, NÃO criar o CHECK e registrar no log da sessão.
--
-- DO $$
-- BEGIN
--   IF NOT EXISTS (SELECT 1 FROM pg_constraint
--                   WHERE conrelid='public.orders'::regclass AND conname='orders_status_check') THEN
--     ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (status IN (
--       'awaiting_payment','paid','fulfilling','completed','failed',
--       'refunded','expired','cancelled'
--       -- , '<status do proxy/reload vistos em 0f>'
--     ));
--   END IF;
-- END $$;


-- ---------------------------------------------------------------------
-- 3) Índices.
--    (user_id, created_at desc) — "Meus pedidos" e o rate limit da Function.
--    (status, expires_at)       — a varredura de expiração a cada 10 min.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS orders_user_created_idx
  ON public.orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_expires_idx
  ON public.orders (status, expires_at);


-- ---------------------------------------------------------------------
-- 4) RLS e privilégios.
--
--    POR QUE O BROWSER NUNCA ESCREVE EM orders:
--    um pedido carrega o VALOR que vai ser cobrado. Se o browser pudesse
--    inserir ou atualizar a linha, o preço seria o que o cliente dissesse
--    — e o mesmo vale para status (marcar como pago) e product_code
--    (trocar o pacote depois de calculado o valor). Toda escrita passa
--    pela Netlify Function orders-create / orders-expire, que recalcula
--    o preço do catálogo e grava com a secret key. Nenhuma policy de
--    INSERT, UPDATE ou DELETE existe para authenticated, e nenhum GRANT
--    de escrita também: duas trancas.
-- ---------------------------------------------------------------------
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.orders FROM anon, authenticated;

-- SELECT POR COLUNA, em WHITELIST.
--
-- O brief pedia blacklist (tudo menos lapak_settled_payload,
-- lapak_reference_id, bonus_voucher_id, user_type, payment_ref). Virou
-- whitelist pelo mesmo motivo da WRITABLE da 0002: coluna nova nasce
-- FECHADA. Com blacklist, a próxima coluna interna que o proxy criar
-- (custo Lapak, margem, IP) ficaria legível pelo cliente sem ninguém
-- decidir isso.
--
-- Fora da lista, além das cinco do brief: lapak_tid, lapak_status,
-- lapak_*_at, settled_at (fornecedor), price, final_price_local,
-- discount_applied (unidade legada do proxy/reload), fee_cents (custo
-- nosso, não do cliente), id_validation (diagnóstico interno: a recusa
-- chega ao cliente como 400 na criação, não como coluna).
--
-- CONSEQUÊNCIA PARA O CÓDIGO: `select=*` passa a dar 401/42501 para o
-- browser. As páginas pedem as colunas pelo nome — ver ORDER_COLUMNS em
-- app/shared/js/store.js, que TEM que espelhar esta lista.
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

-- O dono vê os próprios pedidos da LOJA.
--
-- `channel = 'storefront'` além do auth.uid(): se um dia um pedido do
-- reload ou de parceiro carregar o user_id de um cliente, ele não aparece
-- em "Meus pedidos" com campos que a loja não sabe exibir.
DROP POLICY IF EXISTS orders_select_own ON public.orders;
CREATE POLICY orders_select_own
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND channel = 'storefront');

-- INSERT / UPDATE / DELETE — NENHUMA POLICY. Ver o bloco acima.
-- anon — NENHUMA POLICY, nenhum GRANT.

COMMENT ON TABLE public.orders IS
  'Pedidos de todos os canais (storefront, reload, partner). Browser só LÊ, só os próprios, só colunas da whitelist (0003). Escrita só server-side com secret key.';


-- ---------------------------------------------------------------------
-- 5) Trigger de updated_at.
--    Sufixo _storefront na função porque o nome genérico
--    (touch_updated_at / set_updated_at) é o primeiro que outro repo
--    criaria. Dispara também nos UPDATEs do proxy e do reload — só
--    carimba updated_at, que é uma coluna nova que eles não leem.
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
-- CONFERÊNCIA PÓS-APLICAÇÃO (read-only)
--
--   C-1  as 19 colunas novas existem, com os tipos acima;
--        channel NOT NULL com default 'storefront'
--   C-2  nenhuma linha com channel NULL; distribuição bate com o backfill
--   C-3  rls_on = true
--   C-4  exatamente 1 policy nova (orders_select_own, SELECT, {authenticated});
--        nenhuma com qual/with_check = 'true'
--   C-5  privilégio de TABELA para anon/authenticated: ZERO linhas
--        >>> SELECT de tabela aqui = o GRANT por coluna não pegou. Parar. <<<
--   C-6  privilégio de COLUNA: exatamente 21 linhas, todas SELECT, todas
--        authenticated; nenhuma para lapak_*, bonus_voucher_id, user_type,
--        payment_ref, fee_cents, id_validation, price
--   C-7  anon: zero linhas em C-5 e C-6
--   C-8  constraints orders_amount_cents_nonneg, orders_fee_cents_nonneg,
--        orders_channel_check, orders_id_validation_check
--        (+ orders_status_check, se criado)
--   C-9  índices e trigger novos presentes
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

-- C-2
-- SELECT channel, count(*) FROM public.orders GROUP BY 1;

-- C-3
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'public.orders'::regclass;

-- C-4
-- SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies WHERE schemaname='public' AND tablename='orders';

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
--  WHERE conrelid='public.orders'::regclass AND conname LIKE 'orders_%';

-- C-9
-- SELECT indexname FROM pg_indexes
--  WHERE schemaname='public' AND indexname IN ('orders_user_created_idx','orders_status_expires_idx');
-- SELECT tgname FROM pg_trigger WHERE tgname = 'orders_touch_updated_at';
-- =====================================================================
