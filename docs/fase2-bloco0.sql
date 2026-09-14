-- =====================================================================
-- Fase 2 — BLOCO 0 (pré-voo) da migration 0003_storefront_orders.sql
-- Data: 2026-09-13 · Instância: ashmirzgyuhspymldpfv
--
-- SÓ LEITURA. Nenhuma query aqui altera nada.
--
-- COMO RODAR: o SQL Editor mostra só o resultado da ÚLTIMA instrução
-- executada. Rode UMA query por vez (selecione o bloco e clique em Run)
-- e guarde cada saída com o rótulo (0a, 0b, ...).
--
-- Nenhuma query devolve PII: 0e agrega por categoria; 0l lê só
-- configuração de meios de pagamento.
--
-- >>> REGRAS DE PARADA. Se qualquer uma bater, NÃO aplique a 0003. <<<
--   P1. 0c ou 0d mostram INSERT, UPDATE, DELETE, TRUNCATE ou REFERENCES
--       para anon ou authenticated                     → Dívida #2 chegando em orders
--   P2. 0b mostra policy com qual = 'true' ou with_check = 'true'
--                                                     → Dívida #2 chegando em orders
--   P3. 0j devolve alguma linha                       → colisão de nome
--   P4. 0k mostra user_id que NÃO é uuid, ou FK para outra tabela que
--       não auth.users                                → a policy
--       user_id = auth.uid() compararia coisas diferentes
--   P5. 0i mostra uma coluna que a 0003 cria (lista abaixo) já existente
--       com tipo diferente
--
-- Colunas que a 0003 cria, para conferir no 0i:
--   channel text, customer_profile_id uuid, game_slug text,
--   package_label text, face_value numeric, redemption_fields jsonb,
--   delivery_email text, payment_method text, payment_status text,
--   amount_cents integer, fee_cents integer, payment_ref text,
--   id_validation text, paid_at timestamptz, completed_at timestamptz,
--   code_visible_until timestamptz, expires_at timestamptz,
--   updated_at timestamptz
-- =====================================================================


-- 0a) RLS ligada em orders?
SELECT relrowsecurity AS rls_on, relforcerowsecurity AS rls_forced
  FROM pg_class
 WHERE oid = 'public.orders'::regclass;


-- 0b) Policies existentes em orders (P2)
SELECT policyname, cmd, roles, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'orders';


-- 0c) Privilégio de TABELA para os papéis do browser (P1)
SELECT grantee, privilege_type
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'orders'
   AND grantee IN ('anon', 'authenticated')
 ORDER BY grantee, privilege_type;


-- 0d) Privilégio de COLUNA para os papéis do browser (P1)
SELECT grantee, privilege_type, count(*) AS colunas
  FROM information_schema.column_privileges
 WHERE table_schema = 'public' AND table_name = 'orders'
   AND grantee IN ('anon', 'authenticated')
 GROUP BY grantee, privilege_type
 ORDER BY 1, 2;


-- 0e) Quem escreveu as linhas de hoje. Guia o backfill de `channel`.
--     Só categorias e contagens, sem PII.
SELECT user_type,
       (lapak_tid IS NOT NULL)        AS tem_lapak_tid,
       (bonus_voucher_id IS NOT NULL) AS tem_voucher,
       (user_id IS NOT NULL)          AS tem_user_id,
       status,
       lapak_status,
       country,
       currency_code,
       count(*)                       AS linhas,
       min(created_at)                AS primeira,
       max(created_at)                AS ultima
  FROM public.orders
 GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
 ORDER BY linhas DESC;


-- 0f) Status em uso. Guia o CHECK de status.
SELECT status, count(*) AS linhas
  FROM public.orders
 GROUP BY 1
 ORDER BY 2 DESC;


-- 0g) Constraints existentes em orders
SELECT conname, contype, pg_get_constraintdef(oid) AS definicao
  FROM pg_constraint
 WHERE conrelid = 'public.orders'::regclass
 ORDER BY conname;


-- 0h-1) Índices existentes em orders
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'orders'
 ORDER BY indexname;


-- 0h-2) Triggers existentes em orders
SELECT tgname, pg_get_triggerdef(oid) AS definicao
  FROM pg_trigger
 WHERE tgrelid = 'public.orders'::regclass AND NOT tgisinternal
 ORDER BY tgname;


-- 0i) Colunas atuais de orders, com tipo (P5).
--     O admin faz select de `payment_method` em orders: se ela já existir,
--     conferir o tipo.
SELECT column_name, data_type, udt_name, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'orders'
 ORDER BY ordinal_position;


-- 0j) Nomes que a 0003 cria estão livres? Esperado: ZERO linhas (P3)
SELECT 'function' AS tipo, p.proname AS nome
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'touch_orders_updated_at_storefront'
UNION ALL
SELECT 'trigger', tgname
  FROM pg_trigger
 WHERE tgname = 'orders_touch_updated_at'
UNION ALL
SELECT 'policy', policyname
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'orders' AND policyname = 'orders_select_own'
UNION ALL
SELECT 'index', indexname
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname IN ('orders_user_created_idx', 'orders_status_expires_idx')
UNION ALL
SELECT 'constraint', conname
  FROM pg_constraint
 WHERE conrelid = 'public.orders'::regclass
   AND conname IN ('orders_amount_cents_nonneg', 'orders_fee_cents_nonneg',
                   'orders_channel_check', 'orders_status_check',
                   'orders_id_validation_check');


-- 0k) Tipo e FK de orders.user_id (P4)
SELECT a.attname                               AS coluna,
       format_type(a.atttypid, a.atttypmod)    AS tipo,
       c.conname                               AS fk,
       pg_get_constraintdef(c.oid)             AS definicao
  FROM pg_attribute a
  LEFT JOIN pg_constraint c
         ON c.conrelid = a.attrelid
        AND a.attnum = ANY (c.conkey)
        AND c.contype = 'f'
 WHERE a.attrelid = 'public.orders'::regclass
   AND a.attname = 'user_id';


-- 0l-1) payment_methods: nomes reais das colunas de taxa.
--       A Function lê percentual e custo fixo daqui; o brief os chama de
--       `pct` e `fixed_cost_cents`, confirmar.
SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'payment_methods'
 ORDER BY ordinal_position;


-- 0l-2) payment_methods do Brasil (configuração, sem PII)
SELECT *
  FROM public.payment_methods
 WHERE country_code = 'br';
