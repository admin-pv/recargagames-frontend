/* ──────────────────────────────────────────────────────────────────────────
   store.js v2 — camada de dados do storefront

   FASE 0: tudo era localStorage, tudo síncrono, e o "login" não checava
           senha nenhuma.
   FASE 1: SESSÃO e PERFIL passam a ser Supabase Auth + a tabela
           public.customer_profiles. PEDIDOS continuam em localStorage.

   >>> A MUDANÇA QUE QUEBRA CHAMADOR: as funções de sessão e perfil agora
       são ASSÍNCRONAS. getUser(), isLoggedIn(), updateUser() e as de
       linked accounts devolvem Promise. Toda chamada nas páginas precisa
       de await. O HANDOVER do fornecedor sugeria "manter as mesmas
       assinaturas para as páginas não mudarem" — isso não é possível
       atravessando a rede, e é aqui que esse pressuposto se paga. <<<

   Erros de mutação voltam como { ok:false, code:'...' }, com `code`
   legível por máquina e NUNCA texto para o usuário. A copy fica na página.
   Colocar português aqui seria hardcodar pt-BR numa camada compartilhada,
   que é exatamente o que a restrição do workstream proíbe (i18n é Fase 1b).

   Dependências, nesta ordem: market.js → supabase-client.js → este arquivo.
   ────────────────────────────────────────────────────────────────────────── */
(function (global) {
  "use strict";

  var LS_ORDERS = "recarga_orders_v1";

  /* O cliente Supabase vem de shared/js/supabase-client.js. Guardado numa
     função (e não numa const no topo) porque a ordem de <script> já
     quebrou uma vez neste repo: assim, um arquivo carregado fora de ordem
     falha com uma mensagem clara em vez de `undefined`. */
  function sb() {
    if (!global.sb) {
      throw new Error("store.js: window.sb ausente — carregue shared/js/supabase-client.js antes.");
    }
    return global.sb;
  }

  function market() {
    return global.RecargaMarket || { key: "br", country: "BR", locale: "pt-BR", currency: "BRL" };
  }

  /* ---------------- Utilitários ---------------- */

  function getParam(name) {
    return new URLSearchParams(global.location.search).get(name);
  }

  /* Delegam para market.js, que é quem conhece locale e moeda.
     `formatBRL` sumiu de propósito: o nome afirmava um mercado. */
  function formatMoney(value) { return market().formatMoney(value); }
  function formatDate(iso) { return market().formatDate(iso, { separator: " às " }); }

  /* ---------------- Catálogo (estático — vira backend na Fase 2) ---------------- */

  function getProducts() {
    return global.RECARGA_PRODUCTS || [];
  }

  function getProductById(id) {
    return getProducts().find(function (p) { return p.id === id; });
  }

  function relatedProducts(product, max) {
    if (!product) return [];
    var ids = product.related || [];
    var list = ids.map(getProductById).filter(Boolean);
    if (list.length < (max || 5)) {
      getProducts().forEach(function (p) {
        if (list.length >= (max || 5)) return;
        if (p.id !== product.id && ids.indexOf(p.id) === -1) list.push(p);
      });
    }
    return list.slice(0, max || 5);
  }

  /* ================================================================
     PEDIDOS — FASE 2.

     Continuam inteiros em localStorage, síncronos, exatamente como o
     fornecedor entregou. Não foram tocados nesta fase de propósito:
     misturar a troca de auth com a troca de pedidos dobraria a
     superfície de um checkpoint só.

     Consequências que valem saber enquanto isto for verdade:
       - os pedidos são do BROWSER, não da conta. Trocar de usuário na
         mesma máquina mostra os pedidos do anterior; logar noutra máquina
         não mostra nenhum;
       - createOrder/completeOrder não cobram nada e sempre "dão certo";
       - a exclusão de conta (Netlify Function account-delete) NÃO apaga
         pedidos — nem teria como, eles não estão no servidor. A retenção
         fiscal, que é o motivo de não apagar, só passa a valer de fato
         quando isto virar tabela.
     ================================================================ */

  function readOrdersRaw() {
    try {
      var raw = localStorage.getItem(LS_ORDERS);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore corrupt storage */ }
    var seed = (global.RECARGA_SEED_ORDERS || []).slice();
    writeOrdersRaw(seed);
    return seed;
  }

  function writeOrdersRaw(list) {
    try { localStorage.setItem(LS_ORDERS, JSON.stringify(list)); } catch (e) { /* storage unavailable */ }
  }

  function getOrders() {
    return readOrdersRaw().slice().sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  function getOrderById(id) {
    return readOrdersRaw().find(function (o) { return o.id === id; });
  }

  function generateOrderId() {
    return "RG-" + Math.floor(70000 + Math.random() * 29999);
  }

  function createOrder(order) {
    var list = readOrdersRaw();
    var full = Object.assign({
      id: generateOrderId(),
      status: "processing",
      createdAt: new Date().toISOString()
    }, order);
    list.unshift(full);
    writeOrdersRaw(list);
    return full;
  }

  function generateRedeemCode() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
    function block() {
      var s = "";
      for (var i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
      return s;
    }
    return [block(), block(), block(), block()].join("-");
  }

  function completeOrder(id) {
    var list = readOrdersRaw();
    var order = list.find(function (o) { return o.id === id; });
    if (order) {
      order.status = "completed";
      order.completedAt = new Date().toISOString();
      if (!order.code) {
        var product = getProductById(order.productId);
        if (product && (product.type === "code" || product.type === "giftcard")) {
          order.code = generateRedeemCode();
        }
      }
      writeOrdersRaw(list);
    }
    return order;
  }

  /* ================================================================
     SESSÃO E PERFIL — Supabase Auth + public.customer_profiles
     ================================================================ */

  /* Colunas que a página pode escrever. Whitelist e não blacklist: uma
     coluna nova nasce fechada, e um `updateUser({user_id: outro})` vindo
     de um bug de página nunca chega ao banco.

     A RLS já barraria (o WITH CHECK da policy exige user_id = auth.uid()
     e deleted_at IS NULL), mas defesa em profundidade: melhor o bug
     morrer aqui, com nome, do que virar um 403 obscuro. */
  var WRITABLE = [
    "full_name", "phone", "nickname", "favorite_games",
    "marketing_opt_in", "notifications", "onboarding_done",
    "locale", "country_code", "linked_accounts"
  ];

  /* Cache do perfil, por carregamento de página. O brief pede isso: sem
     ele, uma página que chama getUser() em cinco lugares faz cinco
     round-trips. Invalidado em toda mutação e em toda troca de sessão. */
  var profileCache = null;
  var profileCachePromise = null;

  function invalidateProfileCache() {
    profileCache = null;
    profileCachePromise = null;
  }

  /* Normaliza o erro do Supabase num código estável.

     Por que não repassar error.message: é texto em inglês, escrito pelo
     GoTrue, que muda entre versões. Página nenhuma deve fazer match em
     string para decidir o que mostrar. */
  function errCode(error) {
    if (!error) return null;
    var code = String(error.code || "").toLowerCase();
    var msg = String(error.message || "").toLowerCase();
    var status = error.status || 0;

    if (code) {
      if (code.indexOf("invalid_credentials") > -1) return "invalid_credentials";
      if (code.indexOf("email_not_confirmed") > -1) return "email_not_confirmed";
      if (code.indexOf("user_already_exists") > -1) return "email_taken";
      if (code.indexOf("weak_password") > -1) return "weak_password";
      if (code.indexOf("over_email_send_rate_limit") > -1 ||
          code.indexOf("over_request_rate_limit") > -1) return "rate_limited";
      if (code.indexOf("same_password") > -1) return "same_password";
    }
    if (msg.indexOf("invalid login credentials") > -1) return "invalid_credentials";
    if (msg.indexOf("email not confirmed") > -1) return "email_not_confirmed";
    if (msg.indexOf("already registered") > -1) return "email_taken";
    if (msg.indexOf("password should be") > -1 || msg.indexOf("weak") > -1) return "weak_password";
    if (status === 429) return "rate_limited";
    if (status === 0) return "network";
    return "unknown";
  }

  function fail(error) { return { ok: false, code: errCode(error) }; }

  /* ---- Cadastro ----

     `emailRedirectTo` explícito é OBRIGATÓRIO. O Site URL do projeto é
     https://recargagames.com, compartilhado com o login do admin; sem
     redirect, o link de confirmação cai na landing da raiz e o usuário
     nunca chega à loja. Ver docs/email-templates/README.md.

     NÃO revela se o e-mail já existe. Com "Confirm email" ligado, o
     Supabase devolve sucesso ofuscado para e-mail já cadastrado — e esta
     função preserva isso, devolvendo sempre a mesma forma. O custo é que
     quem já tem conta vê "confirme seu e-mail" e nenhum e-mail novo
     chega; o ganho é não ter um oráculo de "este e-mail é cliente". */
  async function signUp(opts) {
    opts = opts || {};
    try {
      var res = await sb().auth.signUp({
        email: String(opts.email || "").trim(),
        password: opts.password,
        options: {
          emailRedirectTo: market().pagePath("account-login.html"),
          /* Vira raw_user_meta_data em auth.users, de onde o trigger
             handle_new_customer_profile() lê o nome ao criar a linha. */
          data: { full_name: String(opts.name || "").trim() }
        }
      });
      if (res.error) return fail(res.error);

      /* session null = precisa confirmar o e-mail. É o caminho normal
         aqui, não um erro: o cadastro termina na caixa de entrada. */
      invalidateProfileCache();
      return { ok: true, needsConfirmation: !res.data.session };
    } catch (e) {
      return fail(e);
    }
  }

  async function signIn(opts) {
    opts = opts || {};
    try {
      var res = await sb().auth.signInWithPassword({
        email: String(opts.email || "").trim(),
        password: opts.password
      });
      if (res.error) return fail(res.error);
      invalidateProfileCache();
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }

  async function signOut() {
    try {
      await sb().auth.signOut();
    } catch (e) { /* sessão já morta serve igual */ }
    invalidateProfileCache();
    return { ok: true };
  }

  /* ---- Reset de senha ----

     SEMPRE devolve ok:true, inclusive quando o Supabase recusa. É
     deliberado: qualquer diferença observável entre "e-mail existe" e
     "não existe" — mensagem, status, ou tempo de resposta — transforma
     esta tela num verificador de cadastro. A página mostra o mesmo
     "verifique seu e-mail" nos dois casos.

     A única exceção é rate limit, que a página precisa distinguir para
     não pedir que a pessoa tente de novo em vão. Isso vaza que houve
     tentativas recentes, não que o e-mail existe. */
  async function resetPassword(email) {
    try {
      var res = await sb().auth.resetPasswordForEmail(String(email || "").trim(), {
        redirectTo: market().pagePath("account-login.html")
      });
      if (res.error && errCode(res.error) === "rate_limited") {
        return { ok: false, code: "rate_limited" };
      }
      return { ok: true };
    } catch (e) {
      if (errCode(e) === "network") return { ok: false, code: "network" };
      return { ok: true };
    }
  }

  /* Troca de senha do usuário JÁ logado (ou vindo do link de reset, que
     cria sessão ao carregar a página). O Supabase não pede a senha atual;
     quem garante é a sessão. A página ainda pede a atual por UX, mas
     isso não é uma verificação de segurança e não deve ser vendido como
     tal. */
  async function updatePassword(newPassword) {
    try {
      var res = await sb().auth.updateUser({ password: newPassword });
      if (res.error) return fail(res.error);
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }

  /* Troca de e-mail. O link de confirmação vai para o endereço NOVO, e a
     troca só vale depois do clique — até lá o antigo continua logando. */
  async function updateEmail(newEmail) {
    try {
      var res = await sb().auth.updateUser(
        { email: String(newEmail || "").trim() },
        { emailRedirectTo: market().pagePath("account-login.html") }
      );
      if (res.error) return fail(res.error);
      return { ok: true, needsConfirmation: true };
    } catch (e) {
      return fail(e);
    }
  }

  async function getSession() {
    try {
      var res = await sb().auth.getSession();
      return (res.data && res.data.session) || null;
    } catch (e) {
      return null;
    }
  }

  /* O usuário do auth — identidade. Distinto do perfil, que é dado de
     loja. `getUser()` (abaixo) junta os dois. */
  async function getAuthUser() {
    try {
      var res = await sb().auth.getUser();
      return (res.data && res.data.user) || null;
    } catch (e) {
      return null;
    }
  }

  async function isLoggedIn() {
    return !!(await getSession());
  }

  /* ---- O perfil ----

     Devolve null para deslogado, e também para logado-sem-linha (conta
     excluída: a policy de SELECT exige deleted_at IS NULL, então a linha
     some mesmo com JWT ainda válido no browser).

     `email` vem SEMPRE de auth.users, nunca da coluna espelho de
     customer_profiles: a coluna é editável pelo dono da linha e existe só
     para a Function de exclusão e relatórios. Autenticar ou mandar e-mail
     com base nela seria confiar num campo que o usuário escreve. */
  async function getUser(opts) {
    if ((opts && opts.fresh) === true) invalidateProfileCache();
    if (profileCache) return profileCache;
    if (profileCachePromise) return profileCachePromise;

    profileCachePromise = (async function () {
      var authUser = await getAuthUser();
      if (!authUser) return null;

      var res = await sb()
        .from("customer_profiles")
        .select("*")
        .eq("user_id", authUser.id)
        .maybeSingle();

      if (res.error || !res.data) return null;

      var profile = Object.assign({}, res.data, {
        email: authUser.email,
        authId: authUser.id,
        emailConfirmed: !!authUser.email_confirmed_at,
        memberSince: res.data.created_at
      });

      /* Sincroniza o espelho quando ele ficou para trás (troca de e-mail
         confirmada por link, que acontece fora desta aba). Só dispara na
         divergência, e o resultado não é aguardado: é higiene de dado,
         não algo de que a tela dependa. */
      if (res.data.email !== authUser.email) {
        sb().from("customer_profiles")
          .update({ email: authUser.email })
          .eq("user_id", authUser.id)
          .then(function () {}, function () {});
      }

      profileCache = profile;
      return profile;
    })();

    return profileCachePromise;
  }

  /* UPDATE no perfil. Só as colunas da whitelist atravessam. */
  async function updateUser(patch) {
    patch = patch || {};
    var clean = {};
    Object.keys(patch).forEach(function (k) {
      if (WRITABLE.indexOf(k) > -1) clean[k] = patch[k];
    });
    if (!Object.keys(clean).length) return { ok: true, ignored: Object.keys(patch) };

    try {
      var authUser = await getAuthUser();
      if (!authUser) return { ok: false, code: "not_authenticated" };

      var res = await sb()
        .from("customer_profiles")
        .update(clean)
        .eq("user_id", authUser.id)
        .select()
        .maybeSingle();

      if (res.error) return fail(res.error);
      invalidateProfileCache();
      return { ok: true, profile: res.data };
    } catch (e) {
      return fail(e);
    }
  }

  /* ---- IDs de jogo salvos (coluna linked_accounts, jsonb) ----

     Leitura-modificação-escrita do array inteiro. Duas abas editando ao
     mesmo tempo fazem a última ganhar; é aceitável para o volume disto
     (um usuário mexendo no próprio perfil) e o custo de resolver seria
     uma tabela filha, que a migration explica por que não existe. */

  async function getLinkedAccounts() {
    var u = await getUser();
    return (u && u.linked_accounts) || [];
  }

  async function getLinkedAccountsForProduct(productId) {
    var list = await getLinkedAccounts();
    return list.filter(function (a) { return a.productId === productId; });
  }

  async function addLinkedAccount(entry) {
    var list = (await getLinkedAccounts()).slice();
    list.push(Object.assign({
      id: "acc-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      createdAt: new Date().toISOString()
    }, entry));
    return updateUser({ linked_accounts: list });
  }

  async function removeLinkedAccount(id) {
    var list = (await getLinkedAccounts()).filter(function (a) { return a.id !== id; });
    return updateUser({ linked_accounts: list });
  }

  /* ---- Exclusão de conta (LGPD) ----

     O browser não consegue fazer isto sozinho: apagar de auth.users exige
     a secret key, que nunca pode chegar ao front. Vai para a Netlify
     Function, que valida o JWT e opera server-side.
     Ver netlify/functions/account-delete.js. */
  async function deleteAccount() {
    try {
      var session = await getSession();
      if (!session) return { ok: false, code: "not_authenticated" };

      var res = await fetch("/.netlify/functions/account-delete", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + session.access_token,
          "Content-Type": "application/json"
        }
      });

      if (!res.ok) {
        var body = null;
        try { body = await res.json(); } catch (e) { /* corpo vazio serve */ }
        return { ok: false, code: (body && body.code) || "delete_failed" };
      }

      await signOut();
      return { ok: true };
    } catch (e) {
      return { ok: false, code: "network" };
    }
  }

  /* Pacote de dados do titular (LGPD, "baixar meus dados"). Perfil vem do
     servidor; pedidos vêm do localStorage enquanto a Fase 2 não chega —
     e o JSON diz isso, para quem receber o arquivo não achar que o
     histórico é completo. */
  async function exportUserData() {
    var profile = await getUser({ fresh: true });
    return {
      exportedAt: new Date().toISOString(),
      market: market().key,
      profile: profile,
      orders: getOrders(),
      notes: {
        orders: "Pedidos ainda são locais a este navegador (Fase 2 os move para o servidor). Este arquivo reflete apenas este dispositivo.",
        profile: "Perfil vem de public.customer_profiles. O e-mail é o de auth.users."
      }
    };
  }

  function statusLabel(status) {
    return { completed: "Concluído", processing: "Processando", failed: "Falhou" }[status] || status;
  }

  /* ---------------- Offerwall e cupons ----------------
     Sem mudança. Ambos estão OCULTOS desde a Fase 0 (campaign.html virou
     redirect; o campo de cupom tem display:none e o desconto está
     neutralizado). Ficam aqui porque nada os chama — apagar seria mexer
     em código morto sem necessidade.

     completeOffer continua sem verificação nenhuma. Se um dia o offerwall
     voltar para dentro do site, ele precisa de postback server-side
     ANTES de creditar qualquer coisa. */

  function getOffers() { return global.RECARGA_SEED_OFFERS || []; }
  function getOfferById(id) { return getOffers().find(function (o) { return o.id === id; }); }
  function getCoupons() { return global.RECARGA_SEED_COUPONS || []; }

  function getCouponByCode(code) {
    if (!code) return null;
    var norm = String(code).trim().toUpperCase();
    if (!norm) return null;
    return getCoupons().find(function (c) { return c.code.toUpperCase() === norm; }) || null;
  }

  global.RecargaStore = {
    /* síncronos */
    getParam: getParam,
    formatMoney: formatMoney,
    formatDate: formatDate,
    getProducts: getProducts,
    getProductById: getProductById,
    relatedProducts: relatedProducts,
    statusLabel: statusLabel,

    /* pedidos — localStorage, síncronos, FASE 2 */
    getOrders: getOrders,
    getOrderById: getOrderById,
    createOrder: createOrder,
    completeOrder: completeOrder,
    generateOrderId: generateOrderId,
    generateRedeemCode: generateRedeemCode,

    /* sessão e perfil — ASSÍNCRONOS */
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    resetPassword: resetPassword,
    updatePassword: updatePassword,
    updateEmail: updateEmail,
    getSession: getSession,
    getAuthUser: getAuthUser,
    isLoggedIn: isLoggedIn,
    getUser: getUser,
    updateUser: updateUser,
    getLinkedAccounts: getLinkedAccounts,
    getLinkedAccountsForProduct: getLinkedAccountsForProduct,
    addLinkedAccount: addLinkedAccount,
    removeLinkedAccount: removeLinkedAccount,
    deleteAccount: deleteAccount,
    exportUserData: exportUserData,

    /* ocultos desde a Fase 0 */
    getOffers: getOffers,
    getOfferById: getOfferById,
    getCoupons: getCoupons,
    getCouponByCode: getCouponByCode
  };
})(window);
