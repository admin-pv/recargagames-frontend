/* ──────────────────────────────────────────────────────────────────────────
   store.js v2 — camada de dados do storefront

   FASE 0: tudo era localStorage, tudo síncrono, e o "login" não checava
           senha nenhuma.
   FASE 1: SESSÃO e PERFIL passam a ser Supabase Auth + a tabela
           public.customer_profiles. PEDIDOS continuam em localStorage.
   FASE 2: CATÁLOGO vem de /api/catalog e é ASSÍNCRONO; dinheiro em
           CENTAVOS inteiros. PEDIDOS (C3) vêm de public.orders pela RLS e
           são criados só pela Function orders-create.

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
     `formatBRL` sumiu de propósito: o nome afirmava um mercado.

     FASE 2: `formatMoney` recebe CENTAVOS INTEIROS (4990 → R$ 49,90).
     Ver o comentário em caixa alta no market.js. */
  function formatMoney(cents) { return market().formatMoney(cents); }
  function formatDate(iso) { return market().formatDate(iso, { separator: " às " }); }

  /* ================================================================
     CATÁLOGO — FASE 2: /api/catalog, ASSÍNCRONO

     >>> QUEBRA CHAMADOR: getProducts(), getProductById() e
         relatedProducts() devolvem Promise. <<<

     Fonte: netlify/functions/catalog.mjs, que cruza o que o admin
     publicou (price_benchmarks) com a disponibilidade na Lapak. Preço em
     `priceCents`, inteiro.

     Falha (503, rede, JSON inesperado) REJEITA a Promise com
     `err.code === 'catalog_unavailable'`. A página mostra "catálogo
     indisponível, tente de novo". Não há fallback para products.js, e não
     pode haver: seria vender com preço velho.

     Cache: uma Promise por carregamento de página. Uma falha limpa a
     cache, para a próxima chamada tentar de novo.
     ================================================================ */

  var catalogPromise = null;

  function catalogError(detail) {
    var e = new Error("catalog_unavailable");
    e.code = "catalog_unavailable";
    e.detail = detail;
    return e;
  }

  /* O catálogo não tem cor de marca nem sigla curta; as páginas do
     fornecedor usam as duas para o "logo" de texto. Defaults aqui, num
     lugar só, em vez de `|| '#F5700A'` espalhado. */
  function normalizeProduct(p) {
    return Object.assign({ color: null }, p, {
      short: p.short || String(p.name || "?").slice(0, 3).toUpperCase()
    });
  }

  function loadCatalog() {
    if (catalogPromise) return catalogPromise;
    var url = "/api/catalog?country=" + encodeURIComponent(market().key);
    catalogPromise = fetch(url, { headers: { Accept: "application/json" } })
      .then(function (res) {
        if (!res.ok) throw catalogError("http_" + res.status);
        return res.json();
      })
      .then(function (body) {
        if (!body || !Array.isArray(body.products)) throw catalogError("shape");
        return body.products.map(normalizeProduct);
      })
      .catch(function (e) {
        catalogPromise = null;
        throw e && e.code === "catalog_unavailable" ? e : catalogError("network");
      });
    return catalogPromise;
  }

  function getProducts() {
    return loadCatalog();
  }

  async function getProductById(id) {
    var list = await loadCatalog();
    return list.find(function (p) { return p.id === id; }) || null;
  }

  /* Sem `related` no catálogo: destaque e popular primeiro, depois a
     ordem do admin (display_order, que a Function já respeita). */
  async function relatedProducts(product, max) {
    if (!product) return [];
    var list = await loadCatalog();
    var limit = max || 5;
    return list
      .filter(function (p) { return p.id !== product.id; })
      .map(function (p, i) { return { p: p, i: i, w: (p.featured ? 2 : 0) + (p.popular ? 1 : 0) }; })
      .sort(function (a, b) { return b.w - a.w || a.i - b.i; })
      .slice(0, limit)
      .map(function (x) { return x.p; });
  }

  /* ================================================================
     PEDIDOS — FASE 2 (C3): public.orders

     LEITURA: sb.from('orders') com a sessão do cliente. A policy
     orders_select_own devolve só os pedidos DELE e só os da loja
     (channel = 'storefront'). O GRANT é POR COLUNA (migration 0003), então
     select('*') falha com 42501: as colunas vão pelo nome, e
     ORDER_COLUMNS TEM que espelhar o GRANT SELECT da 0003, coluna por
     coluna. Coluna que entrar aqui e não lá vira 42501 na tela.

     ESCRITA: nunca por aqui. O browser não tem GRANT nem policy de escrita
     em orders. createOrder() e retryOrder() chamam POST /api/orders
     (netlify/functions/orders-create.mjs), que recalcula o valor do
     catálogo no servidor. Preço não sai deste arquivo.

     DATAS: created_at é `timestamp` SEM fuso, gravado em UTC. Ver dbTime().
     DINHEIRO: `amount` do objeto de pedido é amount_cents, em CENTAVOS.

     Erros de leitura REJEITAM com err.code: 'not_authenticated' ou
     'orders_unavailable'. Criação devolve { ok:false, code, status }.
     ================================================================ */

  var ORDER_COLUMNS = [
    "id", "user_id", "channel", "status", "payment_status", "country",
    "currency_code", "game_slug", "product_code", "package_label",
    "face_value", "amount_cents", "redemption_fields", "delivery_email",
    "payment_method", "created_at", "updated_at", "paid_at",
    "completed_at", "code_visible_until", "expires_at"
  ].join(",");

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /* created_at é `timestamp` sem fuso, e o now() do servidor grava em UTC.
     O PostgREST devolve "2026-09-13T20:20:18.348" sem sufixo, que o
     browser leria como hora LOCAL: 3h de diferença no Brasil. As colunas
     timestamptz já chegam com offset e passam como estão. */
  function dbTime(ts) {
    if (!ts) return null;
    var s = String(ts).replace(" ", "T");
    return /(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : s + "Z";
  }

  function toOrder(r) {
    return {
      id: r.id,
      status: r.status,
      paymentStatus: r.payment_status,
      country: r.country,
      currency: r.currency_code,
      productId: r.game_slug,
      productCode: r.product_code,
      packageLabel: r.package_label,
      faceValue: r.face_value,
      amount: r.amount_cents,                 // CENTAVOS
      redemptionFields: r.redemption_fields || {},
      email: r.delivery_email,
      paymentMethod: r.payment_method,
      createdAt: dbTime(r.created_at),
      updatedAt: dbTime(r.updated_at),
      paidAt: dbTime(r.paid_at),
      completedAt: dbTime(r.completed_at),
      codeVisibleUntil: dbTime(r.code_visible_until),
      expiresAt: dbTime(r.expires_at)
    };
  }

  function ordersError(code) {
    var e = new Error(code);
    e.code = code;
    return e;
  }

  async function getOrders() {
    if (!(await getAuthUser())) throw ordersError("not_authenticated");
    var res = await sb()
      .from("orders")
      .select(ORDER_COLUMNS)
      .eq("channel", "storefront")
      .order("created_at", { ascending: false });
    if (res.error) throw ordersError("orders_unavailable");
    return (res.data || []).map(toOrder);
  }

  /* Id que não é uuid nem vai ao banco: o PostgREST responderia 400
     (22P02) e a página mostraria "indisponível" em vez de "não
     encontrado". Pedido de outra pessoa volta null pela RLS, igual a um
     inexistente — a página não distingue, e não deve. */
  async function getOrderById(id) {
    if (!UUID_RE.test(String(id || ""))) return null;
    if (!(await getAuthUser())) throw ordersError("not_authenticated");
    var res = await sb()
      .from("orders")
      .select(ORDER_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (res.error) throw ordersError("orders_unavailable");
    return res.data ? toOrder(res.data) : null;
  }

  async function postOrder(payload) {
    var session = await getSession();
    if (!session) return { ok: false, code: "not_authenticated", status: 401 };
    try {
      var res = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + session.access_token,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(Object.assign({ country: market().key }, payload))
      });
      var body = null;
      try { body = await res.json(); } catch (e) { /* corpo vazio */ }
      if (!res.ok) {
        return { ok: false, status: res.status, code: (body && body.error) || "order_failed", field: body && body.field };
      }
      return { ok: true, order: body };
    } catch (e) {
      return { ok: false, status: 0, code: "network" };
    }
  }

  /* Whitelist do que vai no corpo. Preço, taxa, status e validade NUNCA:
     se uma página passar `amount` aqui por engano, ele morre nesta função
     e não chega nem a ser ignorado pelo servidor. */
  function createOrder(input) {
    input = input || {};
    return postOrder({
      gameSlug: input.gameSlug,
      productCode: input.productCode,
      redemptionFields: input.redemptionFields,
      deliveryEmail: input.deliveryEmail,
      paymentMethod: input.paymentMethod
    });
  }

  /* checkout.html: o servidor decide se reabre o mesmo pedido (ainda
     aguardando) ou cria um novo com os dados do vencido. Nunca duplica. */
  function retryOrder(orderId) {
    return postOrder({ retryOf: orderId });
  }

  /* Vencido para a TELA: status 'expired', ou 'awaiting_payment' com o
     prazo já passado e o orders-expire ainda não rodou (roda a cada 10 min). */
  function isOrderExpired(order, now) {
    if (!order) return false;
    if (order.status === "expired") return true;
    return order.status === "awaiting_payment" && !!order.expiresAt &&
      new Date(order.expiresAt).getTime() <= (now || Date.now());
  }

  /* D4: código visível só com pedido concluído e dentro de
     code_visible_until. Fora disso, a página diz que foi para o e-mail. */
  function isCodeVisible(order, now) {
    return !!order && order.status === "completed" && !!order.codeVisibleUntil &&
      (now || Date.now()) < new Date(order.codeVisibleUntil).getTime();
  }

  /* ================================================================
     SESSÃO E PERFIL — Supabase Auth + public.customer_profiles
     ================================================================ */

  /* Colunas que a página pode escrever. Whitelist e não blacklist: uma
     coluna nova nasce fechada, e um `updateUser({user_id: outro})` vindo
     de um bug de página nunca chega ao banco.

     ESTA LISTA ESPELHA O `GRANT UPDATE (...)` DA MIGRATION 0002, coluna
     por coluna, e as duas TÊM que andar juntas: uma coluna que entre aqui
     e não no GRANT vira 42501 (permission denied for column) em produção;
     uma que entre no GRANT e não aqui é escrita que o banco aceita e este
     código descarta em silêncio.

     São três tranças sobre a mesma coisa, de propósito — a policy diz
     QUAIS LINHAS, o GRANT diz QUAIS COLUNAS, e esta lista faz o bug morrer
     aqui, com nome, em vez de virar um 403 obscuro na tela.

     `country_code` saiu na revisão de 11/09: o mercado vem do PATH da
     requisição (market.js), não de uma escolha do usuário.
     `email` nunca esteve: a troca é do GoTrue, com confirmação por link. */
  var WRITABLE = [
    "full_name", "phone", "locale", "nickname", "favorite_games",
    "marketing_opt_in", "onboarding_done", "linked_accounts", "notifications"
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
    /* 42501 = permission denied for column. Na prática só aparece se a
       WRITABLE acima e o GRANT UPDATE da migration saírem de sincronia.
       Tem código próprio para ser diagnosticável em vez de virar
       "unknown" — o sintoma seria "salvar não salva, e ninguém sabe por
       quê". */
    if (code === "42501" || msg.indexOf("permission denied for column") > -1) return "permission_denied";
    /* OTP: token errado, já usado ou fora da validade. O GoTrue não
       distingue os três, e é melhor assim — dizer "código já usado"
       confirmaria que o e-mail existe. */
    if (code.indexOf("otp_expired") > -1) return "otp_invalid";
    if (msg.indexOf("token has expired or is invalid") > -1) return "otp_invalid";
    if (msg.indexOf("invalid otp") > -1 || msg.indexOf("token not found") > -1) return "otp_invalid";
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

  /* ── Código de 6 dígitos (OTP) ────────────────────────────────────────

     POR QUE OTP E NÃO LINK. Em 12/09 o primeiro cadastro real deu 504 na
     confirmação. O scanner de links do Gmail abriu o /verify antes do
     usuário, gastou o token de uso único, e o clique de verdade falhou —
     a conta ficou confirmada no banco e a tela deu erro. Todo provedor
     corporativo pré-varre links; o mesmo valia para o reset de senha.

     Com código, um scanner que abre o e-mail não consome nada: o token só
     é gasto quando alguém digita os dígitos aqui.

     Os templates de "Confirm signup" e "Reset password" tiveram o
     {{ .ConfirmationURL }} REMOVIDO. Se ele voltar, o Supabase volta a
     gerar link, o scanner volta a visitá-lo, e este código passa a falhar
     como "inválido". Ver docs/email-templates/README.md.

     Sucesso nos dois casos cria sessão: 'signup' loga a pessoa; 'recovery'
     abre a janela em que ela pode trocar a senha. */
  async function verifyOtp(opts) {
    opts = opts || {};
    try {
      var res = await sb().auth.verifyOtp({
        email: String(opts.email || "").trim(),
        token: String(opts.token || "").replace(/\D/g, ""),
        type: opts.type   // 'signup' | 'recovery'
      });
      if (res.error) return fail(res.error);
      invalidateProfileCache();
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }

  function verifySignupCode(email, token) {
    return verifyOtp({ email: email, token: token, type: "signup" });
  }

  function verifyRecoveryCode(email, token) {
    return verifyOtp({ email: email, token: token, type: "recovery" });
  }

  /* Reenvio.

     ATENÇÃO A UMA ASSIMETRIA DO SUPABASE: auth.resend() aceita 'signup',
     'email_change', 'sms' e 'phone_change' — mas NÃO 'recovery'. Para
     reenviar um código de redefinição, o caminho é chamar
     resetPasswordForEmail() de novo. Por isso resendCode() encaminha em
     vez de ter uma implementação só.

     Resposta neutra, mesma regra do resetPassword: sempre ok:true fora de
     rate limit. Um reenvio que falha só para e-mail inexistente seria um
     verificador de cadastro com outro nome. */
  async function resendCode(type, email) {
    if (type === "recovery") return resetPassword(email);
    try {
      var res = await sb().auth.resend({
        type: type,
        email: String(email || "").trim(),
        options: { emailRedirectTo: market().pagePath("account-login.html") }
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

      /* NÃO sincronizamos o espelho `email` daqui. Desde a revisão de
         11/09 o browser não tem privilégio de UPDATE nessa coluna (GRANT
         por coluna na migration 0002), e é o desenho certo: a troca de
         e-mail pertence ao GoTrue, com confirmação por link.

         Consequência a saber: `customer_profiles.email` é um RETRATO DO
         CADASTRO, gravado uma vez pelo trigger. Depois de uma troca de
         e-mail confirmada, ele fica defasado. Isso não afeta nada hoje —
         `email` acima já vem de auth.users, que é a fonte da verdade, e a
         Function de exclusão sobrescreve a coluna com a secret key. Se um
         dia a coluna precisar ser confiável (relatório, busca por e-mail),
         a saída é um trigger em auth.users AFTER UPDATE OF email, não
         devolver a escrita ao browser. */

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
     Ver netlify/functions/account-delete.mjs. */
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

  /* Pacote de dados do titular (LGPD, "baixar meus dados"). Perfil e
     pedidos vêm do servidor. Se os pedidos falharem, `orders` sai null e
     `notes.orders` diz por quê: uma lista vazia seria lida como "não há
     pedidos", que é outra afirmação. */
  async function exportUserData() {
    var profile = await getUser({ fresh: true });
    var orders = null;
    var ordersNote = "Pedidos da loja (public.orders), valores em centavos.";
    try {
      orders = await getOrders();
    } catch (e) {
      ordersNote = "Não foi possível carregar os pedidos agora (" + (e && e.code) + "). Exporte de novo para incluí-los.";
    }
    return {
      exportedAt: new Date().toISOString(),
      market: market().key,
      profile: profile,
      orders: orders,
      notes: {
        orders: ordersNote,
        profile: "Perfil vem de public.customer_profiles. O e-mail é o de auth.users."
      }
    };
  }

  /* Rótulo e tom (classe CSS status-pill: completed | processing | failed)
     por status de orders. Status que não está no mapa recebe rótulo
     neutro, nunca o valor cru da coluna. */
  var STATUS_LABELS = {
    awaiting_payment: "Aguardando pagamento",
    paid: "Pagamento confirmado",
    fulfilling: "Em processamento",
    completed: "Concluído",
    failed: "Falhou",
    refunded: "Reembolsado",
    expired: "Expirado",
    cancelled: "Cancelado"
  };

  function statusLabel(status) {
    return STATUS_LABELS[status] || "Em análise";
  }

  function statusTone(status) {
    if (status === "completed") return "completed";
    if (["failed", "expired", "cancelled", "refunded"].indexOf(status) > -1) return "failed";
    return "processing";
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
    formatMoney: formatMoney,      // CENTAVOS
    formatDate: formatDate,
    statusLabel: statusLabel,
    statusTone: statusTone,
    isOrderExpired: isOrderExpired,
    isCodeVisible: isCodeVisible,

    /* catálogo — /api/catalog, ASSÍNCRONOS (Fase 2) */
    getProducts: getProducts,
    getProductById: getProductById,
    relatedProducts: relatedProducts,

    /* pedidos — public.orders (leitura RLS) e POST /api/orders, ASSÍNCRONOS */
    getOrders: getOrders,
    getOrderById: getOrderById,
    createOrder: createOrder,
    retryOrder: retryOrder,

    /* sessão e perfil — ASSÍNCRONOS */
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    resetPassword: resetPassword,
    updatePassword: updatePassword,
    verifySignupCode: verifySignupCode,
    verifyRecoveryCode: verifyRecoveryCode,
    resendCode: resendCode,
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
