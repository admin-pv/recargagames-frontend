/* ──────────────────────────────────────────────────────────────────────────
   catalog — GET /api/catalog?country=br

   Catálogo publicado do mercado, montado em tempo real (D3): games +
   price_benchmarks do Supabase, cruzados com /category e /all-products da
   Lapak via proxy. A regra inteira está em netlify/lib/catalog.mjs e em
   docs/modelo-catalogo-e-fulfillment.md.

   Rota: /api/catalog é rewrite para /.netlify/functions/catalog
   (netlify.toml e _redirects). Fica FORA do gate de propósito: é o mesmo
   dado que a vitrine mostra, sem nada de cliente.

   Respostas:
     200  { country, currency, generatedAt, products: [...] }
          ?diag=1 acrescenta `report` (códigos de produto descartados e o
          motivo). Só catálogo, nenhum dado de pessoa.
     400  { error: 'invalid_country' }
     405  { error: 'method_not_allowed' }
     500  { error: 'misconfigured' }   env faltando (nomes vão para o log)
     503  { error: 'catalog_unavailable' }
          Supabase ou proxy fora. A página mostra "catálogo indisponível";
          NUNCA cai no products.js (seria vender preço velho).

   Cache: 5 min em memória na Function (lib) + Cache-Control max-age=60
   no browser/CDN. Erro nunca é cacheado.

   ── ENV ──
   SUPABASE_URL, STOREFRONT_SECRET_KEY, PROXY_URL, LAPAK_ENV (prod|dev,
   sem default). PROXY_ADMIN_KEY NÃO: leitura de catálogo no /gateway é
   pública e essa chave cria pedido na Lapak.
   ────────────────────────────────────────────────────────────────────────── */

import { MARKETS, loadCatalog, CatalogUnavailable, MisconfiguredError } from '../lib/catalog.mjs';

function json(statusCode, body, cacheControl) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl || 'no-store'
    },
    body: JSON.stringify(body)
  };
}

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'method_not_allowed' });

  const params = event.queryStringParameters || {};
  const country = String(params.country || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(MARKETS, country)) {
    return json(400, { error: 'invalid_country' });
  }

  try {
    const catalog = await loadCatalog(country);
    const body = {
      country,
      currency: MARKETS[country].currency,
      generatedAt: catalog.generatedAt,
      products: catalog.products
    };
    if (params.diag === '1') body.report = catalog.report;
    return json(200, body, params.diag === '1' ? 'no-store' : 'public, max-age=60');
  } catch (e) {
    if (e instanceof MisconfiguredError) {
      console.error('catalog: missing env vars: %s', e.missing.join(', '));
      return json(500, { error: 'misconfigured' });
    }
    if (e instanceof CatalogUnavailable) {
      console.error('catalog: unavailable market=%s reason=%s', country, e.reason);
    } else {
      console.error('catalog: unexpected market=%s err=%s', country, e && e.name);
    }
    return json(503, { error: 'catalog_unavailable' });
  }
};
