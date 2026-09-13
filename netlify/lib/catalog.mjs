/* ──────────────────────────────────────────────────────────────────────────
   catalog.mjs — núcleo do catálogo do storefront (Fase 2)

   Usado por netlify/functions/catalog.mjs (GET /api/catalog) e, na
   sequência, por orders-create.mjs, que revalida o pedido contra o MESMO
   catálogo e a MESMA cache. Mora fora de netlify/functions/ para não
   virar Function própria; o bundler do Netlify inclui o import relativo.

   A regra de negócio está em docs/modelo-catalogo-e-fulfillment.md.
   Resumo do que este arquivo implementa:

   ELEGIBILIDADE (D1, só estas duas condições):
     (a) price_benchmarks.published = true, auto_paused <> true, no
         country_code do mercado — o admin é a única fonte de "pode vender";
     (b) Lapak: status = "available".
   Nada de país da Lapak, sufixo -br ou nome de categoria para excluir.

   ÚNICA EXCLUSÃO FORA DE (a)+(b), de segurança: categoria cujo `forms`
   pede `orderdetail` (login e senha do jogo) fica fora do catálogo B2C.

   LIGAÇÃO PRODUTO → JOGO: pelo `category_code` que a própria Lapak devolve
   em /all-products. Fallback, só se o campo vier vazio: a categoria cujo
   código é o prefixo mais longo do `group_product_code`. Liga, nunca exclui.

   CAMPOS DA LAPAK QUE ESTE ARQUIVO LÊ (docs/vendor/lapak-reseller-api.pdf,
   v1.6, e respostas reais conferidas em 13/09):
     GET /all-products?country_code=  → data.products[]:
         code, category_code, group_product_code, name, status
         `status` = disponibilidade: "available" | "empty" (doc, seção
         Product Callback: "data.status  Availability status of the
         product. available or empty").
         `country_code` NÃO é lido: repete o país da consulta e não
         descreve onde o produto funciona (FFLATAM "exclude Brazil" volta
         como "br").
     GET /category?country_code=      → data.categories[]:
         code, name, variant ("DIGITAL" | "VOUCHER"), forms[] { name,
         type ("tel" | "number" | "text" | "textarea" | "option"),
         options[] { value, name } }

   DINHEIRO: rrp_final (numeric em reais) vira centavos inteiros aqui, por
   aritmética de string, e nenhum float sai deste módulo.
   ────────────────────────────────────────────────────────────────────────── */

/* Mercados que o catálogo atende. Espelha app/shared/js/market.js (a
   chave é o path: /br/ → 'br'). `excludeWords` só alimenta o AVISO ao
   operador, nunca uma exclusão. */
export const MARKETS = {
  br: { currency: 'BRL', excludeWords: ['brazil', 'brasil'] },
  mx: { currency: 'MXN', excludeWords: ['mexico', 'méxico'] },
  ph: { currency: 'PHP', excludeWords: ['philippines', 'philipines'] },
  ng: { currency: 'NGN', excludeWords: ['nigeria'] }
};

/* Marca do storefront. Multi-marca (Topup.games etc.) é decisão em
   aberto; quando vier, isto sai do path/domínio como o mercado. */
export const BRAND = 'rg';

const CACHE_TTL_MS = 5 * 60 * 1000;
const SUPABASE_TIMEOUT_MS = 8000;
const PROXY_TIMEOUT_MS = 20000;   // /all-products BR: ~1,3 MB, ~5 s em 13/09

/* Campo de resgate que é credencial de login. Ver o modelo, seção 3. */
const LOGIN_CREDENTIAL_FIELD = 'orderdetail';

export class CatalogUnavailable extends Error {
  constructor(reason) {
    super('catalog_unavailable');
    this.code = 'catalog_unavailable';
    this.reason = reason;
  }
}

export class MisconfiguredError extends Error {
  constructor(missing) {
    super('misconfigured');
    this.code = 'misconfigured';
    this.missing = missing;
  }
}

/* ── Env ──────────────────────────────────────────────────────────────────
   PROXY_ADMIN_KEY NÃO é lida aqui, de propósito: leitura de catálogo no
   /gateway é pública, e essa chave cria pedido na Lapak. Quem precisa
   dela (orders-create, para o check de ID) lê por conta própria.

   LAPAK_ENV é obrigatória e sem default. O proxy cai em `dev` quando o
   header x-env falta, e catálogo de dev em produção mostraria estoque de
   outro ambiente sem erro nenhum. */
export function catalogEnv() {
  const required = ['SUPABASE_URL', 'STOREFRONT_SECRET_KEY', 'PROXY_URL', 'LAPAK_ENV'];
  const missing = required.filter((k) => !String(process.env[k] || '').trim());
  if (missing.length) throw new MisconfiguredError(missing);

  const lapakEnv = process.env.LAPAK_ENV.trim().toLowerCase();
  if (lapakEnv !== 'prod' && lapakEnv !== 'dev') throw new MisconfiguredError(['LAPAK_ENV(prod|dev)']);

  return {
    supabaseUrl: process.env.SUPABASE_URL.trim().replace(/\/+$/, ''),
    secret: process.env.STOREFRONT_SECRET_KEY.trim(),
    proxyUrl: process.env.PROXY_URL.trim().replace(/\/+$/, ''),
    lapakEnv
  };
}

/* ── Dinheiro ─────────────────────────────────────────────────────────────
   "29.26" → 2926. Arredonda meio centavo para cima (29.255 → 2926), que é
   o round(rrp_final * 100) do brief sem passar por float: 29.26 * 100 em
   ponto flutuante dá 2925.9999999999995. Devolve null para o que não é
   um decimal não negativo. */
export function toCents(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [intPart, fracPart = ''] = s.split('.');
  const frac = (fracPart + '000').slice(0, 3);
  let cents = Number(intPart) * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1;
  return Number.isSafeInteger(cents) ? cents : null;
}

/* face_value como chave de agrupamento: "100", "100.0" e 100 são o mesmo
   pacote. Devolve string, nunca float. */
function faceValueKey(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  const frac = f.replace(/0+$/, '');
  return String(Number(i)) + (frac ? '.' + frac : '');
}

/* ── Campos de resgate ────────────────────────────────────────────────────
   A Lapak descreve cada campo só com `name` e `type`. A regra de validação
   é derivada do type (decisão de 13/09) e vai pronta no JSON: o browser
   usa para feedback, o orders-create reaplica ESTA MESMA função e decide.
   Rótulo não sai daqui — é copy, fica na página. */
export function fieldRule(form) {
  const name = String((form && form.name) || '').trim();
  const type = String((form && form.type) || '').trim().toLowerCase();
  if (!name) return null;

  if (type === 'tel' || type === 'number') {
    return { name, type, inputMode: 'numeric', pattern: '^\\d{4,20}$', minLength: 4, maxLength: 20 };
  }
  if (type === 'text' || type === 'textarea') {
    return { name, type, inputMode: 'text', pattern: null, minLength: 1, maxLength: 64 };
  }
  if (type === 'option') {
    const options = (Array.isArray(form.options) ? form.options : [])
      .filter((o) => o && o.value !== undefined && o.value !== null && String(o.value) !== '')
      .map((o) => ({ value: String(o.value), label: String(o.name ?? o.value) }));
    if (!options.length) return null;
    return { name, type, inputMode: null, pattern: null, minLength: null, maxLength: null, options };
  }
  return null;   // type desconhecido: quem chama descarta o jogo e loga
}

export function isFieldValueValid(rule, raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (rule.type === 'option') return rule.options.some((o) => o.value === value);
  if (rule.minLength !== null && value.length < rule.minLength) return false;
  if (rule.maxLength !== null && value.length > rule.maxLength) return false;
  if (rule.pattern && !new RegExp(rule.pattern).test(value)) return false;
  return true;
}

/* ── Montagem (pura, sem rede — é o que o teste local exercita) ─────────── */

function upper(s) { return String(s || '').trim().toUpperCase(); }

function longestPrefixCategory(groupCode, categoryCodesByLengthDesc) {
  const g = upper(groupCode);
  if (!g) return null;
  return categoryCodesByLengthDesc.find((c) => g.startsWith(c)) || null;
}

function suggestsExclusion(categoryName, excludeWords) {
  const m = /exclu\w*\s*([^)\]]*)/i.exec(String(categoryName || ''));
  if (!m) return false;
  const tail = m[1].toLowerCase();
  return excludeWords.some((w) => tail.includes(w));
}

function initialsOf(name) {
  return String(name || '')
    .split(/\s+/).filter(Boolean)
    .map((w) => w[0]).join('').slice(0, 3).toUpperCase();
}

/**
 * @returns {{ products: object[], alternatives: Map<string,string[]>, report: object }}
 *   products      — o JSON público, no shape que as páginas consomem
 *   alternatives  — product_code canônico → variantes elegíveis do mesmo
 *                   jogo + face_value, mais baratas primeiro (fallback das
 *                   seções 4 e 5 do modelo; nunca sai no JSON)
 *   report        — o que ficou de fora e por quê (log e ?diag=1)
 */
export function buildCatalog({ market, games, benchmarks, categories, lapakProducts }) {
  const cfg = MARKETS[market];
  const report = {
    market,
    // Todo jogo ativo lido do banco, com a categoria que ele declara. Sem
    // isto, jogo cuja categoria não existe na Lapak sumia do relatório.
    games: games.map((g) => ({ slug: g.slug, category: g.category_code || null })),
    publishedRows: 0,
    eligibleRows: 0,
    notInLapak: [],
    unavailable: [],
    invalidPrice: [],
    withoutGame: [],
    orderdetailSkipped: [],
    categoryMissing: [],
    unknownFormType: [],
    duplicateCategory: [],
    incompatibleWarnings: [],
    nonCanonical: [],
    gamesWithoutPackages: []
  };

  const catByCode = new Map();
  for (const c of categories) if (c && c.code) catByCode.set(upper(c.code), c);
  const catCodesByLength = [...catByCode.keys()].sort((a, b) => b.length - a.length);

  const lapakByCode = new Map();
  for (const p of lapakProducts) if (p && p.code) lapakByCode.set(String(p.code), p);

  const gameByCategory = new Map();
  for (const g of games) {
    const key = upper(g.category_code);
    if (!key) continue;
    if (gameByCategory.has(key)) { report.duplicateCategory.push({ category: key, slug: g.slug }); continue; }
    gameByCategory.set(key, g);
  }

  // (a) publicado, não pausado, do mercado
  const published = benchmarks.filter((b) => b && b.published === true && String(b.country_code || '').toLowerCase() === market);
  report.publishedRows = published.length;
  const eligibleBench = published.filter((b) => b.auto_paused !== true);

  // candidatos por jogo
  const bySlug = new Map();
  for (const b of eligibleBench) {
    const code = String(b.product_code || '');
    const lp = lapakByCode.get(code);
    if (!lp) { report.notInLapak.push(code); continue; }
    if (lp.status !== 'available') { report.unavailable.push(code); continue; }   // (b)

    const priceCents = toCents(b.rrp_final);
    if (!priceCents || priceCents <= 0) { report.invalidPrice.push(code); continue; }

    const linkedCategory = upper(lp.category_code) || longestPrefixCategory(lp.group_product_code, catCodesByLength);
    const game = linkedCategory ? gameByCategory.get(linkedCategory) : null;
    if (!game) { report.withoutGame.push({ code, category: linkedCategory }); continue; }

    // Aviso ao operador, nunca exclusão: a categoria ligada ou a sugerida
    // pelo prefixo diz "exclude <país do mercado>".
    const prefixCategory = longestPrefixCategory(lp.group_product_code, catCodesByLength);
    const namesToCheck = [catByCode.get(linkedCategory), prefixCategory && catByCode.get(prefixCategory)]
      .filter(Boolean).map((c) => c.name);
    if (namesToCheck.some((n) => suggestsExclusion(n, cfg.excludeWords))) {
      report.incompatibleWarnings.push({ code, category: prefixCategory || linkedCategory });
    }

    report.eligibleRows += 1;
    if (!bySlug.has(game.slug)) bySlug.set(game.slug, { game, candidates: [] });
    bySlug.get(game.slug).candidates.push({
      code,
      priceCents,
      faceKey: faceValueKey(b.face_value),
      faceValue: b.face_value === null || b.face_value === undefined ? null : String(b.face_value),
      label: String(lp.name || code)
    });
  }

  const products = [];
  const alternatives = new Map();

  for (const g of games) {
    const entry = bySlug.get(g.slug);
    const category = catByCode.get(upper(g.category_code));

    if (!category) {
      // Sempre reportado: é o sintoma de games.category_code diferente do
      // código da Lapak, e nesse caso nenhum produto consegue se ligar a ele.
      report.categoryMissing.push({ slug: g.slug, category: g.category_code || null, published: entry ? entry.candidates.length : 0 });
      continue;
    }
    const forms = Array.isArray(category.forms) ? category.forms : [];
    if (forms.some((f) => f && f.name === LOGIN_CREDENTIAL_FIELD)) {
      report.orderdetailSkipped.push({ category: category.code, slug: g.slug, published: entry ? entry.candidates.length : 0 });
      continue;
    }
    if (!entry) { report.gamesWithoutPackages.push(g.slug); continue; }

    const fields = forms.map(fieldRule);
    if (fields.some((f) => f === null)) {
      report.unknownFormType.push({ slug: g.slug, category: category.code, forms: forms.map((f) => f && f.type) });
      continue;
    }

    // D1 canônico: mesmo jogo + face_value → menor preço; empate, menor código
    const groups = new Map();
    for (const c of entry.candidates) {
      const key = c.faceKey === null ? 'code:' + c.code : c.faceKey;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }

    const packages = [];
    for (const list of groups.values()) {
      list.sort((a, b) => a.priceCents - b.priceCents || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
      const [canonical, ...rest] = list;
      alternatives.set(canonical.code, rest.map((r) => r.code));
      for (const r of rest) report.nonCanonical.push({ code: r.code, canonical: canonical.code });
      packages.push({
        id: canonical.code,
        label: canonical.label,
        faceValue: canonical.faceValue,
        priceCents: canonical.priceCents,
        currency: cfg.currency
      });
    }
    packages.sort((a, b) => a.priceCents - b.priceCents || (a.id < b.id ? -1 : 1));

    products.push({
      id: g.slug,
      name: g.name,
      short: initialsOf(g.name),
      category: category.code,
      type: String(category.variant).toUpperCase() === 'VOUCHER' ? 'code' : 'direct',
      image: g.thumbnail_url || null,
      banner: g.banner_url || null,
      description: g.description || null,
      howToTopup: g.how_to_topup || null,
      currencyLabel: g.currency_label || null,
      featured: g.is_featured === true,
      popular: g.is_popular === true,
      fields,
      packages,
      minPriceCents: packages[0].priceCents,
      currency: cfg.currency
    });
  }

  return { products, alternatives, report };
}

/* ── Rede ─────────────────────────────────────────────────────────────── */

async function supabaseGet(cfg, path) {
  let res;
  try {
    res = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
      headers: { apikey: cfg.secret, Authorization: `Bearer ${cfg.secret}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS)
    });
  } catch (e) {
    throw new CatalogUnavailable(`supabase_${e.name}`);
  }
  if (!res.ok) throw new CatalogUnavailable(`supabase_http_${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new CatalogUnavailable('supabase_shape');
  return body;
}

/* O proxy embrulha a resposta da Lapak: { status, ok, data: { code, data } }. */
async function gatewayGet(cfg, endpoint, payload) {
  let res;
  try {
    res = await fetch(`${cfg.proxyUrl}/gateway`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-env': cfg.lapakEnv },
      body: JSON.stringify({ endpoint, method: 'GET', payload }),
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS)
    });
  } catch (e) {
    throw new CatalogUnavailable(`proxy_${endpoint}_${e.name}`);
  }
  if (!res.ok) throw new CatalogUnavailable(`proxy_${endpoint}_http_${res.status}`);
  const body = await res.json().catch(() => null);
  if (!body || body.ok !== true || !body.data || body.data.code !== 'SUCCESS' || !body.data.data) {
    throw new CatalogUnavailable(`lapak_${endpoint}_${body && body.data ? body.data.code : 'shape'}`);
  }
  return body.data.data;
}

async function fetchAndBuild(market) {
  const cfg = catalogEnv();
  const m = encodeURIComponent(market);

  const [games, benchmarks, categoryData, productData] = await Promise.all([
    supabaseGet(cfg,
      'games?select=slug,name,category_code,thumbnail_url,banner_url,description,how_to_topup,' +
      'is_featured,is_popular,display_order,currency_label' +
      `&country_code=eq.${m}&brand_code=eq.${BRAND}&active=eq.true&order=display_order.asc,name.asc`),
    supabaseGet(cfg,
      'price_benchmarks?select=product_code,country_code,face_value,rrp_final,published,auto_paused' +
      `&country_code=eq.${m}&published=eq.true`),
    gatewayGet(cfg, '/category', { country_code: market }),
    gatewayGet(cfg, '/all-products', { country_code: market })
  ]);

  const categories = Array.isArray(categoryData.categories) ? categoryData.categories : null;
  const lapakProducts = Array.isArray(productData.products) ? productData.products : null;
  if (!categories || !lapakProducts) throw new CatalogUnavailable('lapak_shape');

  const built = buildCatalog({ market, games, benchmarks, categories, lapakProducts });
  logReport(built);
  return { ...built, generatedAt: new Date().toISOString() };
}

/* Só códigos de catálogo, nenhum dado de pessoa. */
function logReport({ products, report: r }) {
  const packages = products.reduce((n, p) => n + p.packages.length, 0);
  console.log(
    'catalog: built market=%s games_active=%d games=%d packages=%d published=%d eligible=%d not_in_lapak=%d unavailable=%d without_game=%d non_canonical=%d',
    r.market, r.games.length, products.length, packages, r.publishedRows, r.eligibleRows,
    r.notInLapak.length, r.unavailable.length, r.withoutGame.length, r.nonCanonical.length
  );
  if (r.unavailable.length) console.log('catalog: unavailable market=%s codes=%s', r.market, r.unavailable.join(','));
  if (r.notInLapak.length) console.log('catalog: not_in_lapak market=%s codes=%s', r.market, r.notInLapak.join(','));
  if (r.invalidPrice.length) console.warn('catalog: invalid_price market=%s codes=%s', r.market, r.invalidPrice.join(','));
  for (const w of r.withoutGame) console.log('catalog: published_without_game market=%s code=%s category=%s', r.market, w.code, w.category);
  for (const s of r.orderdetailSkipped) console.log('catalog: skip orderdetail_required market=%s category=%s published=%d', r.market, s.category, s.published);
  for (const w of r.incompatibleWarnings) console.warn('catalog: warn published_but_category_suggests_incompatible market=%s code=%s category=%s', r.market, w.code, w.category);
  for (const c of r.categoryMissing) console.warn('catalog: category_missing_in_lapak market=%s slug=%s category=%s', r.market, c.slug, c.category);
  for (const u of r.unknownFormType) console.warn('catalog: unknown_form_type market=%s slug=%s category=%s', r.market, u.slug, u.category);
  for (const d of r.duplicateCategory) console.warn('catalog: duplicate_game_category market=%s category=%s slug=%s', r.market, d.category, d.slug);
  if (r.gamesWithoutPackages.length) console.log('catalog: games_without_packages market=%s slugs=%s', r.market, r.gamesWithoutPackages.join(','));
}

/* ── Cache em memória, por mercado, TTL 5 min ─────────────────────────────
   Vale por instância da Function (uma instância fria recomeça vazia). Erro
   não é cacheado: a próxima requisição tenta de novo. Requisições
   simultâneas com a cache vazia compartilham a mesma montagem. */
const cache = new Map();     // market → { at, value }
const inflight = new Map();  // market → Promise

export async function loadCatalog(market, { now = Date.now() } = {}) {
  if (!MARKETS[market]) throw new CatalogUnavailable('unknown_market');
  const hit = cache.get(market);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;
  if (inflight.has(market)) return inflight.get(market);

  const p = fetchAndBuild(market)
    .then((value) => { cache.set(market, { at: Date.now(), value }); return value; })
    .finally(() => inflight.delete(market));
  inflight.set(market, p);
  return p;
}
