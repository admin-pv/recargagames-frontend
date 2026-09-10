// Shared prototype logic for Recarga Games (both branding versions).
// No backend exists — this simulates account/session and order state with
// localStorage so the flows (checkout -> Order Details -> My Orders -> Profile)
// stay connected across page loads. Requires shared/data/products.js and
// shared/data/orders.js to be loaded first.
(function (global) {
  "use strict";

  var LS_ORDERS = "recarga_orders_v1";
  var LS_USER = "recarga_user_v1";

  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function formatBRL(value) {
    var n = typeof value === "number" ? value : parseFloat(value || 0);
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function formatDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) +
      " às " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

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

  /* ---------------- Orders ---------------- */

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
      // 'code'/'giftcard' products deliver a redeem code by e-mail — no real
      // fulfillment backend exists yet, so generate a demo-looking one here
      // (same spot a real code-issuing call would go) if one isn't set already.
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

  /* ---------------- User / session ---------------- */

  function getUser() {
    try {
      var raw = localStorage.getItem(LS_USER);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function isLoggedIn() { return !!getUser(); }

  /* NOT REAL AUTH. This never receives, checks, or stores a password — it
     just writes {name, email, ...} to localStorage. account-login.html's
     login/signup forms validate a password client-side but never pass it
     in here. A real backend needs to own credential verification entirely;
     this function (and the localStorage session it fakes) should be
     replaced by a real session token from a real /login or /signup call. */
  function login(user) {
    var full = Object.assign({
      name: "Jogador",
      email: "jogador@email.com",
      memberSince: new Date().toISOString()
    }, user);
    try { localStorage.setItem(LS_USER, JSON.stringify(full)); } catch (e) { /* ignore */ }
    return full;
  }

  function logout() {
    try { localStorage.removeItem(LS_USER); } catch (e) { /* ignore */ }
  }

  function updateUser(patch) {
    var current = getUser() || {};
    var merged = Object.assign({}, current, patch || {});
    try { localStorage.setItem(LS_USER, JSON.stringify(merged)); } catch (e) { /* ignore */ }
    return merged;
  }

  /* ---------------- Linked game accounts ----------------
     Lets a buyer save a game's player ID (and zone/Riot ID, whatever that
     product needs) on their profile so product.html can offer it back as a
     pre-fill instead of asking them to retype it every purchase. Stored on
     the user object itself, same localStorage-only caveat as the rest of
     this file. Supports more than one saved account per game (e.g. two
     Free Fire IDs), distinguished by an optional nickname. */

  function getLinkedAccounts() {
    var u = getUser();
    return (u && u.linkedAccounts) || [];
  }

  function getLinkedAccountsForProduct(productId) {
    return getLinkedAccounts().filter(function (a) { return a.productId === productId; });
  }

  function addLinkedAccount(entry) {
    var list = getLinkedAccounts().slice();
    var full = Object.assign({
      id: "acc-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      createdAt: new Date().toISOString()
    }, entry);
    list.push(full);
    return updateUser({ linkedAccounts: list });
  }

  function removeLinkedAccount(id) {
    var list = getLinkedAccounts().filter(function (a) { return a.id !== id; });
    return updateUser({ linkedAccounts: list });
  }

  function statusLabel(status) {
    return { completed: "Concluído", processing: "Processando", failed: "Falhou" }[status] || status;
  }

  /* ---------------- Offerwall (rewarded offers / "página de campanha") ----------------
     Prototype only — there's no real TyrAds (or other rewarded-traffic partner)
     integration yet. Offers come from shared/data/offers.js
     (window.RECARGA_SEED_OFFERS), same seed pattern as orders. Completed offer
     IDs are stored on the user object (same spot linkedAccounts lives) so they
     survive across pages. completeOffer() does NOT verify anything with a real
     partner — that's the seam for the TyrAds postback/callback once that
     integration exists (see campaign.html and
     claude/campaign-offerwall-context.md in the project for background). */

  function getOffers() {
    return global.RECARGA_SEED_OFFERS || [];
  }

  function getOfferById(id) {
    return getOffers().find(function (o) { return o.id === id; });
  }

  function getCompletedOfferIds() {
    var u = getUser();
    return (u && u.completedOfferIds) || [];
  }

  function completeOffer(id) {
    // TODO: this should only run after a real verification step (TyrAds
    // postback/callback confirming the offer was actually completed) —
    // today it just marks it done locally so the page has something to show.
    var ids = getCompletedOfferIds().slice();
    if (ids.indexOf(id) === -1) {
      ids.push(id);
      updateUser({ completedOfferIds: ids });
    }
    return ids;
  }

  /* ---------------- Coupons (demo only — see shared/data/coupons.js) ---------------- */

  function getCoupons() {
    return global.RECARGA_SEED_COUPONS || [];
  }

  function getCouponByCode(code) {
    if (!code) return null;
    var norm = String(code).trim().toUpperCase();
    if (!norm) return null;
    return getCoupons().find(function (c) { return c.code.toUpperCase() === norm; }) || null;
  }

  global.RecargaStore = {
    getParam: getParam,
    formatBRL: formatBRL,
    formatDate: formatDate,
    getProducts: getProducts,
    getProductById: getProductById,
    relatedProducts: relatedProducts,
    getOrders: getOrders,
    getOrderById: getOrderById,
    createOrder: createOrder,
    completeOrder: completeOrder,
    generateOrderId: generateOrderId,
    generateRedeemCode: generateRedeemCode,
    getUser: getUser,
    isLoggedIn: isLoggedIn,
    login: login,
    logout: logout,
    updateUser: updateUser,
    getLinkedAccounts: getLinkedAccounts,
    getLinkedAccountsForProduct: getLinkedAccountsForProduct,
    addLinkedAccount: addLinkedAccount,
    removeLinkedAccount: removeLinkedAccount,
    statusLabel: statusLabel,
    getOffers: getOffers,
    getOfferById: getOfferById,
    getCompletedOfferIds: getCompletedOfferIds,
    completeOffer: completeOffer,
    getCoupons: getCoupons,
    getCouponByCode: getCouponByCode
  };
})(window);
