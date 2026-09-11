-- =====================================================================
-- Migration: customer_profiles (Fase 1) — perfil do CLIENTE da loja
-- Data: 2026-09-11
-- Objetivo: dar ao storefront uma identidade própria, com RLS restritiva
--           desde a primeira linha, sem encostar na auth do admin.
--
-- Como rodar: colar este arquivo inteiro no Supabase SQL Editor
--             (instância ashmirzgyuhspymldpfv) e executar.
--             Idempotente — pode ser re-executado sem erro.
--
-- ADITIVA. Cria uma tabela, duas funções e dois triggers, todos com nomes
-- que não existem hoje. NÃO altera nenhuma tabela, policy ou função
-- existente.
--
-- >>> LEIA ISTO ANTES DE RODAR <<<
--
-- O brief da Fase 1 mandava criar `public.profiles`. ESSA TABELA JÁ
-- EXISTE e é de outro dono: tem `user_type`, que é a coluna que as
-- policies do admin checam, e `is_admin()` está viva no banco. Criar,
-- dropar ou mexer na RLS dela arrisca derrubar o login do admin e, por
-- tabela, `bonus_vouchers` e todas as `pv_*` do reload.
--
-- Por isso a tabela aqui se chama `customer_profiles`. Separação de
-- identidade: `profiles` é quem opera a loja, `customer_profiles` é quem
-- compra nela. Decisão do Vinicius em 11/09.
--
-- NOMES ESCOLHIDOS PARA NÃO COLIDIR. O trigger padrão da documentação do
-- Supabase se chama `on_auth_user_created` e a função `handle_new_user()`.
-- É provável que já existam neste banco (criando a linha de `profiles`).
-- Um CREATE OR REPLACE neles substituiria o comportamento do admin em
-- silêncio. Tudo aqui leva sufixo `_customer_profile`.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0) PRÉ-VOO — OBRIGATÓRIO. Read-only, não muda nada.
--
--    Rode ESTE BLOCO SOZINHO antes do resto e leia a saída. Ele existe
--    para responder três perguntas que a publishable key não consegue
--    responder de fora do banco.
--
--    PERGUNTA 1 — "um cliente da loja vira admin sem querer?"
--
--    Se já houver um trigger em auth.users que insere em public.profiles
--    a cada usuário novo, então TODO cadastro do storefront também cria
--    uma linha em profiles. Isso por si só é inofensivo. O que NÃO é
--    inofensivo é essa linha nascer com user_type = 'admin'.
--
--    >>> SE A QUERY 1c DEVOLVER 'admin' NO DEFAULT, OU SE O CORPO DA
--        FUNÇÃO NA 1b ESCREVER user_type COM VALOR FIXO 'admin',
--        PARE E ME MOSTRE A SAÍDA ANTES DE RODAR O RESTO. <<<
--
--    Nesse cenário, cadastrar-se na loja seria escalação de privilégio, e
--    a correção é no trigger existente (repo do admin), não aqui.
-- ---------------------------------------------------------------------

-- 1a) Quais triggers existem em auth.users hoje
-- SELECT t.tgname            AS trigger_name,
--        p.proname           AS funcao,
--        n.nspname           AS schema_da_funcao,
--        p.prosecdef         AS security_definer
--   FROM pg_trigger t
--   JOIN pg_proc      p ON p.oid = t.tgfoid
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE t.tgrelid = 'auth.users'::regclass
--    AND NOT t.tgisinternal
--  ORDER BY t.tgname;

-- 1b) O corpo de cada uma dessas funções — é aqui que se vê se ela
--     escreve user_type, e com que valor.
-- SELECT p.proname, pg_get_functiondef(p.oid) AS fonte
--   FROM pg_trigger t
--   JOIN pg_proc      p ON p.oid = t.tgfoid
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE t.tgrelid = 'auth.users'::regclass
--    AND NOT t.tgisinternal;

-- 1c) O default da coluna user_type. Se for 'admin', qualquer linha
--     criada sem informar a coluna nasce admin.
-- SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'profiles'
--  ORDER BY ordinal_position;

-- 1d) Como is_admin() decide. Confirma de qual tabela/coluna ela lê e se
--     é SECURITY DEFINER.
-- SELECT p.proname, p.prosecdef AS security_definer, pg_get_functiondef(p.oid)
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE p.proname = 'is_admin';

--    PERGUNTA 2 — "os nomes que esta migration cria estão livres?"
--    Qualquer linha que a 2a devolva é colisão: PARE e me avise.
-- 2a)
-- SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND p.proname IN ('handle_new_customer_profile',
--                      'touch_customer_profiles_updated_at')
-- UNION ALL
-- SELECT tgname FROM pg_trigger
--  WHERE tgname IN ('on_auth_user_created_customer_profile',
--                   'customer_profiles_touch_updated_at')
-- UNION ALL
-- SELECT tablename FROM pg_tables
--  WHERE schemaname = 'public' AND tablename = 'customer_profiles';

--    PERGUNTA 3 — "como profiles está trancada hoje?"
--    Só para registro no log da sessão. Não muda nada aqui.
-- 3a)
-- SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies WHERE schemaname='public' AND tablename='profiles';


-- ---------------------------------------------------------------------
-- 1) A tabela.
--
--    POR QUE A PK NÃO É O id DO auth.users (o brief pedia isso):
--
--    O brief manda, no mesmo fôlego, (a) `id uuid PK REFERENCES
--    auth.users ON DELETE CASCADE` e (b) uma exclusão de conta que
--    marca `deleted_at`, anonimiza a linha E chama
--    `auth.admin.deleteUser()`. As duas coisas não coexistem: com
--    CASCADE, apagar o usuário do `auth.users` apaga a linha anonimizada
--    junto — e o critério C4 ("linha anonimizada" + "auth.users sem o
--    usuário") vira impossível de verificar.
--
--    Com PK própria e `user_id ... ON DELETE SET NULL`, a linha
--    SOBREVIVE à exclusão, órfã e anonimizada:
--      - o C4 passa a ser verificável exatamente como está escrito;
--      - a linha fica invisível para todo mundo (a policy exige
--        `user_id = auth.uid()`, e `auth.uid()` nunca é NULL para um
--        usuário logado). Só a Netlify Function, com a secret key, a
--        enxerga;
--      - na FASE 2, quando os pedidos saírem do localStorage e virarem
--        tabela, eles vão apontar para `customer_profiles.id`. Com
--        CASCADE, excluir uma conta levaria o histórico fiscal junto —
--        exatamente o que a retenção não permite. Esta escolha é o que
--        deixa a Fase 2 possível sem uma migration corretiva.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_profiles (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- A ponte para o Supabase Auth. UNIQUE: um perfil por usuário.
  -- SET NULL (e não CASCADE) — ver o bloco acima.
  user_id          uuid        UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Espelho de auth.users.email, para não precisar de join em toda
  -- leitura. A FONTE DA VERDADE é auth.users.email: o usuário consegue
  -- editar esta coluna (a policy de UPDATE não a protege), então nunca
  -- autentique nem envie e-mail com base nela.
  email            text,
  full_name        text,
  phone            text,

  -- Mercado. Default 'br' porque é o único no ar, mas a coluna existe
  -- desde já para MX/PH/NG não exigirem migration.
  country_code     text        NOT NULL DEFAULT 'br',
  locale           text        NOT NULL DEFAULT 'pt-BR',

  -- Onboarding de 3 passos do account-login.html
  nickname         text,
  favorite_games   text[]      NOT NULL DEFAULT '{}',
  marketing_opt_in boolean     NOT NULL DEFAULT false,
  onboarding_done  boolean     NOT NULL DEFAULT false,

  -- IDs de jogo salvos, para o pré-preenchimento do product.html.
  -- jsonb e não tabela filha: a forma é [{id, productId, label, fields{}}],
  -- sempre lida e escrita inteira, nunca consultada por dentro. Vira
  -- tabela no dia em que alguém precisar de "quantos jogadores salvaram
  -- ID de Free Fire" — hoje ninguém precisa.
  linked_accounts  jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- Sem orderWhatsapp: não há canal de WhatsApp (escondido na Fase 0).
  notifications    jsonb       NOT NULL DEFAULT '{"orderEmail":true,"promo":false}'::jsonb,

  -- Exclusão LGPD é soft + anonimização, feita pela Netlify Function
  -- account-delete. Nunca escrita pelo cliente (a policy de UPDATE tem
  -- WITH CHECK exigindo deleted_at IS NULL, então marcar a si mesmo
  -- como excluído é rejeitado).
  deleted_at       timestamptz,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.customer_profiles IS
  'Perfil do cliente do storefront (Fase 1). Não confundir com public.profiles, que é a identidade do painel admin.';


-- ---------------------------------------------------------------------
-- 2) RLS.
--
--    A tabela nasce trancada. O default do Postgres com RLS ligada e
--    nenhuma policy é NEGAR TUDO; cada policy abaixo abre exatamente um
--    caso.
-- ---------------------------------------------------------------------
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;

-- Blindagem extra: sem GRANT, a RLS nem chega a ser consultada — o
-- Postgres nega antes, e o PostgREST devolve 401 em vez de lista vazia.
-- O Supabase concede privilégios amplos por default a anon/authenticated
-- em tabelas novas de `public`; estas duas linhas desfazem isso e
-- reconstroem só o necessário.
REVOKE ALL ON public.customer_profiles FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.customer_profiles TO authenticated;
-- anon: nada. Nem SELECT. Deslogado não tem perfil para ver.


-- SELECT — o usuário lê a própria linha, e só enquanto ela estiver viva.
--
-- `deleted_at IS NULL` no USING é o que faz a conta excluída sumir de
-- verdade: mesmo que o JWT ainda esteja no localStorage do browser e
-- válido por mais alguns minutos, a linha já não retorna.
DROP POLICY IF EXISTS customer_profiles_select_own ON public.customer_profiles;
CREATE POLICY customer_profiles_select_own
  ON public.customer_profiles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND deleted_at IS NULL);


-- UPDATE — o usuário edita a própria linha.
--
-- O WITH CHECK repete a condição do USING de propósito, e é ele que
-- fecha dois furos:
--   1. trocar `user_id` para o de outra pessoa (sequestro de perfil);
--   2. escrever `deleted_at` em si mesmo, contornando a Function e
--      deixando a linha num estado que só a secret key desfaz.
-- Sem WITH CHECK, o USING só filtra a linha ANTES do UPDATE — o valor
-- depois ficaria livre.
DROP POLICY IF EXISTS customer_profiles_update_own ON public.customer_profiles;
CREATE POLICY customer_profiles_update_own
  ON public.customer_profiles
  FOR UPDATE
  TO authenticated
  USING      (user_id = auth.uid() AND deleted_at IS NULL)
  WITH CHECK (user_id = auth.uid() AND deleted_at IS NULL);


-- INSERT — NENHUMA POLICY, de propósito.
--
-- A linha nasce SÓ pelo trigger do item 3, que é SECURITY DEFINER e por
-- isso passa por cima da RLS. Efeito: não existe caminho pelo qual o
-- browser crie um perfil. Isso é o que impede alguém de, com a
-- publishable key na mão, encher a tabela de linhas soltas.
-- É também o que o checkpoint C3 verifica com curl.

-- DELETE — NENHUMA POLICY. Exclusão é soft, e só pela Function.

-- anon — NENHUMA POLICY, em nenhum comando.


-- ---------------------------------------------------------------------
-- 3) Trigger: criar o perfil quando o usuário nasce.
--
--    SECURITY DEFINER porque roda no INSERT em `auth.users`, onde o
--    papel corrente não tem (e não deve ter) permissão de escrita em
--    `public`.
--
--    `SET search_path` fixo: sem isso, um schema malicioso no search_path
--    do chamador poderia sequestrar a resolução dos nomes dentro de uma
--    função SECURITY DEFINER. É higiene obrigatória neste tipo de função.
--
--    DISPARA PARA TODO USUÁRIO NOVO, inclusive admin. Um admin criado
--    daqui pra frente também vai ganhar uma linha em customer_profiles.
--    É inerte — nada no painel lê esta tabela — e o custo de filtrar
--    (por `raw_user_meta_data->>'source'`) seria pior: um cadastro de
--    cliente que chegasse sem o metadado ficaria SEM perfil, e sem
--    policy de INSERT não haveria como criar depois pelo browser.
--    Robustez ganha de limpeza aqui.
--
--    ON CONFLICT DO NOTHING: se a linha já existir (re-execução, ou um
--    usuário recriado com o mesmo id), o cadastro não quebra.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_customer_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.customer_profiles (user_id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    -- O signUp do storefront manda { data: { full_name } }, que o
    -- Supabase grava em raw_user_meta_data. Ausente (ex: usuário criado
    -- pelo painel), fica NULL e o cliente preenche no onboarding.
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), '')
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_customer_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_customer_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_customer_profile();


-- ---------------------------------------------------------------------
-- 4) Trigger: updated_at.
--
--    No BEFORE, e sobrescrevendo o que vier do cliente — o valor é do
--    banco, não de quem mandou o UPDATE.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_customer_profiles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customer_profiles_touch_updated_at ON public.customer_profiles;
CREATE TRIGGER customer_profiles_touch_updated_at
  BEFORE UPDATE ON public.customer_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_customer_profiles_updated_at();


-- ---------------------------------------------------------------------
-- 5) Índice.
--
--    `user_id` já ganhou índice pelo UNIQUE. Este cobre a varredura que
--    a Function de exclusão faz e qualquer relatório futuro de contas
--    ativas; parcial porque linha excluída não é o caso que se consulta.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS customer_profiles_active_idx
  ON public.customer_profiles (created_at DESC)
  WHERE deleted_at IS NULL;


-- =====================================================================
-- CONFERÊNCIA PÓS-APLICAÇÃO (read-only)
--
-- Rode depois e confira:
--   - 16 colunas
--   - rowsecurity = true
--   - exatamente 2 policies, ambas só para {authenticated}
--   - 2 triggers, um em cada tabela
-- =====================================================================
-- SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='customer_profiles'
--  ORDER BY ordinal_position;
--
-- SELECT rowsecurity FROM pg_tables
--  WHERE schemaname='public' AND tablename='customer_profiles';
--
-- SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies
--  WHERE schemaname='public' AND tablename='customer_profiles';
--
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
--  WHERE table_schema='public' AND table_name='customer_profiles';
--
-- SELECT tgname FROM pg_trigger
--  WHERE tgrelid IN ('auth.users'::regclass, 'public.customer_profiles'::regclass)
--    AND NOT tgisinternal;
-- =====================================================================
