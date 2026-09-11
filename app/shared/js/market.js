/* ──────────────────────────────────────────────────────────────────────────
   market.js — resolução de mercado (país / locale / moeda) + formatação

   Um único conjunto de arquivos em /app/ serve N mercados. O que muda entre
   eles é o path pelo qual o usuário chegou (/br/, /mx/, /ph/, /ng/) e, mais
   pra frente, o domínio.

   FASE 0: este arquivo existia e ninguém consumia.
   FASE 1: passa a ser consumido. Toda formatação de dinheiro e data do
           storefront sai daqui — nenhuma página chama toLocaleString com
           'pt-BR'/'BRL' escrito à mão.

   Ordem de resolução (primeiro que casar vence):
     1. hostname  — mapa ainda vazio; entra quando houver domínio por mercado
     2. path      — primeiro segmento da URL: /br/... → br
     3. fallback  — br

   Carregado antes de store.js em todas as páginas.
   ────────────────────────────────────────────────────────────────────────── */
(function (window) {
  'use strict';

  /* Mercados suportados. Acrescentar um mercado é acrescentar uma entrada
     aqui + o rewrite em _redirects e netlify.toml + o path no gate.ts + a
     Redirect URL no painel do Supabase. As quatro coisas, ou nenhuma. */
  var MARKETS = {
    br: { country: 'BR', locale: 'pt-BR', currency: 'BRL' },
    mx: { country: 'MX', locale: 'es-MX', currency: 'MXN' },
    ph: { country: 'PH', locale: 'en-PH', currency: 'PHP' },
    ng: { country: 'NG', locale: 'en-NG', currency: 'NGN' }
  };

  var DEFAULT_MARKET = 'br';

  /* Domínio → mercado. Vazio de propósito: hoje todos os mercados vivem em
     subpastas do mesmo domínio, então quem decide é o path. */
  var HOSTNAME_MAP = {};

  function fromHostname(hostname) {
    return HOSTNAME_MAP[String(hostname || '').toLowerCase()] || null;
  }

  function fromPath(pathname) {
    /* Primeiro segmento do path. As páginas são servidas de /app/ mas o
       usuário chega por /br/... (rewrite do Netlify), então o pathname que
       o browser enxerga é o do mercado, não o do arquivo. Abrir
       /app/index.html direto cai no fallback, que é o comportamento certo
       para um endereço que nem deveria ser alcançável (ver _redirects). */
    var segment = String(pathname || '').split('/')[1];
    return Object.prototype.hasOwnProperty.call(MARKETS, segment) ? segment : null;
  }

  function resolve(location) {
    var loc = location || window.location;
    var key = fromHostname(loc.hostname) || fromPath(loc.pathname) || DEFAULT_MARKET;
    var market = MARKETS[key];

    return {
      key: key,
      country: market.country,
      locale: market.locale,
      currency: market.currency
    };
  }

  var current = resolve();

  /* ── Formatação de dinheiro ───────────────────────────────────────────

     >>> A UNIDADE MUDA NA FASE 2. LEIA ANTES DE MEXER. <<<

     HOJE (Fase 1): `amount` é um DECIMAL na unidade maior — reais, não
     centavos. 49.9 → "R$ 49,90". É assim porque app/shared/data/products.js
     guarda `price` como float, herdado do protótipo do fornecedor.

     NA FASE 2: o catálogo vem do backend e o preço passa a ser INTEIRO em
     centavos (4990), que é a única forma de não acumular erro de ponto
     flutuante em soma de pedido. Quando isso acontecer, a mudança aqui é
     uma linha — dividir por 100 — e ela tem que ser feita NO MESMO COMMIT
     em que products.js muda de unidade.

     Não dá para detectar a unidade em runtime: 4990 é um preço plausível
     tanto em centavos quanto em reais. Por isso a regra é documental, e
     por isso ela está em caixa alta.

     O nome do parâmetro é `amount`, e não `cents` como no brief da Fase 1,
     justamente para não afirmar uma unidade que ainda não é verdade. */
  function formatMoney(amount, marketOverride) {
    var m = marketOverride || current;
    var n = typeof amount === 'number' ? amount : parseFloat(amount);
    if (!isFinite(n)) n = 0;

    try {
      return n.toLocaleString(m.locale, {
        style: 'currency',
        currency: m.currency
      });
    } catch (e) {
      /* Locale ou currency desconhecido por um browser antigo: melhor um
         número legível do que uma exceção que derruba a renderização. */
      return m.currency + ' ' + n.toFixed(2);
    }
  }

  /* ── Formatação de data ───────────────────────────────────────────────
     Mesma razão do formatMoney: `toLocaleDateString('pt-BR')` espalhado
     pelas páginas é um 'pt-BR' hardcoded, que a restrição permanente do
     workstream proíbe. A COPY das páginas continua em português — isso é
     i18n e é a Fase 1b. Aqui é só o formato. */
  function formatDate(iso, opts) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var o = opts || {};
    var date = d.toLocaleDateString(current.locale, {
      day: '2-digit', month: 'short', year: 'numeric'
    });
    if (o.withTime === false) return date;
    var time = d.toLocaleTimeString(current.locale, {
      hour: '2-digit', minute: '2-digit'
    });
    return date + (o.separator || ', ') + time;
  }

  /* ── Caminho de uma página DENTRO do mercado corrente ─────────────────

     Existe por um motivo específico: o Site URL do projeto Supabase é
     https://recargagames.com (compartilhado com o login do admin e por
     isso não alterado). Sem redirect explícito, o link de confirmação de
     e-mail cai na landing da raiz, não na loja.

     Então signUp, resetPasswordForEmail e updateUser({email}) passam
     sempre emailRedirectTo/redirectTo — e todos usam esta função, para o
     endereço ser montado num lugar só.

     Usa `key` ('br'), não `country` ('BR'): o path é minúsculo. Montar com
     country e esquecer o toLowerCase() dá /BR/account-login.html, que não
     casa com nenhuma Redirect URL cadastrada e falha com
     "redirect_to is not allowed". */
  function pagePath(page) {
    return window.location.origin + '/' + current.key + '/' + String(page || '').replace(/^\/+/, '');
  }

  window.RecargaMarket = {
    key: current.key,
    country: current.country,
    locale: current.locale,
    currency: current.currency,

    formatMoney: formatMoney,
    formatDate: formatDate,
    pagePath: pagePath,

    /* Expostos para quem precisar formatar em outro mercado que não o
       corrente (ex: um painel comparando preços) e para os testes. */
    markets: MARKETS,
    resolve: resolve
  };
})(window);
