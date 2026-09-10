/* ──────────────────────────────────────────────────────────────────────────
   market.js — resolução de mercado (país / locale / moeda)

   Um único conjunto de arquivos em /app/ serve N mercados. O que muda entre
   eles é o path pelo qual o usuário chegou (/br/, /mx/, /ph/, /ng/) e, mais
   pra frente, o domínio. Este arquivo existe para que essa resolução tenha
   um lugar só, antes de qualquer página precisar dela.

   FASE 0: nenhuma página consome window.RecargaMarket ainda. O catálogo, os
   preços e a copy continuam pt-BR/BRL fixos, vindos de shared/data/. Este
   arquivo é estrutura, não comportamento — trocar o valor resolvido aqui hoje
   não muda nada na tela. Quem for ligar i18n e catálogo por mercado (Fase 1)
   começa por aqui.

   Ordem de resolução (primeiro que casar vence):
     1. hostname  — mapa ainda vazio; entra quando houver domínio por mercado
                    (ex: recargagames.mx → mx)
     2. path      — primeiro segmento da URL: /br/... → br
     3. fallback  — br

   Carregado antes de store.js em todas as páginas.
   ────────────────────────────────────────────────────────────────────────── */
(function (window) {
  'use strict';

  /* Mercados suportados. Acrescentar um mercado é acrescentar uma entrada
     aqui + o rewrite correspondente em _redirects e netlify.toml. */
  var MARKETS = {
    br: { country: 'BR', locale: 'pt-BR', currency: 'BRL' },
    mx: { country: 'MX', locale: 'es-MX', currency: 'MXN' },
    ph: { country: 'PH', locale: 'en-PH', currency: 'PHP' },
    ng: { country: 'NG', locale: 'en-NG', currency: 'NGN' }
  };

  var DEFAULT_MARKET = 'br';

  /* Domínio → mercado. Vazio de propósito: hoje todos os mercados vivem em
     subpastas do mesmo domínio, então quem decide é o path. Quando existir
     domínio dedicado, mapear aqui (a chave é o hostname em minúsculas). */
  var HOSTNAME_MAP = {};

  function fromHostname(hostname) {
    return HOSTNAME_MAP[String(hostname || '').toLowerCase()] || null;
  }

  function fromPath(pathname) {
    /* Primeiro segmento do path. As páginas são servidas de /app/ mas o
       usuário chega por /br/... (rewrite do Netlify), então o pathname que o
       browser enxerga é o do mercado, não o do arquivo. */
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

  window.RecargaMarket = {
    key: current.key,
    country: current.country,
    locale: current.locale,
    currency: current.currency,

    /* Expostos para a Fase 1 não precisar reabrir este arquivo. */
    markets: MARKETS,
    resolve: resolve
  };
})(window);
