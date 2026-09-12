/* ──────────────────────────────────────────────────────────────────────────
   supabase-client.js — o único lugar onde a chave publishable aparece

   Cria window.sb. Carregado DEPOIS do UMD do supabase-js (que define
   window.supabase) e ANTES de store.js.

   ── SOBRE A CHAVE ABAIXO ──

   É a chave PUBLISHABLE (`storefront_v1`). Ela é pública por natureza:
   vai no HTML, qualquer visitante a lê no DevTools, e isso é o desenho.
   Quem protege os dados é a RLS, não o segredo da chave — ver
   supabase/migrations/0002_customer_profiles.sql.

   O que NUNCA pode aparecer aqui, nem em nenhum arquivo de app/:
     - a secret `storefront_fn_v1` (vive só no env do Netlify, como
       STOREFRONT_SECRET_KEY, e só a Netlify Function a lê)
     - a `gate_v1` / SUPABASE_SECRET_KEY (é do gate, outro escopo)

   Por que `storefront_v1` e não a chave legada que já estava no repo: a
   legada é compartilhada com o gate e o offerwall. Se um dia ela precisar
   ser rotacionada por causa deles, o storefront cairia junto. Chave
   própria = revogação independente. (Em 11/09 a chave legada quase entrou
   aqui por engano; ficou registrado porque o erro teria sido invisível —
   tudo funcionaria igual.)

   ── POR QUE A VERSÃO É EXATA E TEM SRI ──

   `@2` pegaria qualquer minor/patch novo automaticamente. Este arquivo
   manipula sessão e senha: uma atualização silenciosa vinda de CDN é
   superfície de ataque, não conveniência. A versão é exata e o
   `integrity` faz o browser recusar o script se o byte mudar.

   Para atualizar: trocar a versão nas 7 páginas E recalcular o hash com
     curl -sfL <url> | openssl dgst -sha384 -binary | openssl base64 -A
   ────────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://ashmirzgyuhspymldpfv.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ndBCpAkOwqti0eOi0WDs0A_LdfKCEey';

  if (!global.supabase || typeof global.supabase.createClient !== 'function') {
    /* Falha alta e cedo. O modo silencioso seria pior: a página
       renderizaria deslogada e a pessoa acharia que perdeu a conta. */
    throw new Error(
      'supabase-client.js: supabase-js não carregou. Confira a tag <script> do CDN ' +
      '(bloqueio de rede, ou o integrity falhou) — ela tem que vir ANTES deste arquivo.'
    );
  }

  global.sb = global.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      /* O link de confirmação e o de reset voltam com a sessão no hash da
         URL. Com isto ligado o cliente consome o hash sozinho ao carregar
         — é o que faz account-login.html servir de página de callback sem
         precisar de rota própria. */
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,

      /* PKCE em vez do fluxo implícito: o token não trafega no fragmento
         da URL, então não vaza por histórico do browser nem por Referer. */
      flowType: 'pkce',

      /* Namespace próprio no localStorage. O painel admin usa Supabase
         Auth no MESMO domínio (recargagames.com); com a chave padrão, a
         sessão do cliente e a do admin brigariam pelo mesmo slot — logar
         na loja derrubaria o admin na aba ao lado, e vice-versa. */
      storageKey: 'rg-storefront-auth'
    },
    global: {
      headers: { 'x-client-info': 'recargagames-storefront' }
    }
  });
})(window);
