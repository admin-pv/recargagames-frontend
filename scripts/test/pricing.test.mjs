import assert from 'node:assert/strict';
import { test } from './harness.mjs';
import { dec } from '../lib/decimal.mjs';
import { buildPricing, pickBestSku, partnerPrice, headroom, rateFor, fxAgeDays } from '../lib/pricing.mjs';
import { parseProduct, rowsFromProducts } from '../../netlify/lib/supply.mjs';

/* ── Base reutilizável: uma oportunidade de 3 mercados, markup 2% ─────── */
const OPP = {
  slug: 'teste', name: 'Teste', markets: ['AR', 'MX', 'PE'],
  markup_pct: '0.02', fee_fixed_usd: '0',
  fx_overrides: { USD_ARS: '1428.57', USD_MXN: '17.45', USD_PEN: '3.40' }
};
const FX = { USD_IDR: '17663', USD_ARS: '1428.57', USD_MXN: '17.45', USD_PEN: '3.40' };

function snap(group, code, price, { country = 'br', status = 'available', provider = 'S1' } = {}) {
  return { group_code: group, product_code: code, provider_code: provider, price_idr: price, query_country: country, status };
}
function sku(group, market, extra = {}) {
  return { group_code: group, market, enabled: true, sku_override: null, ...extra };
}
function bench(group, market, price, currency, qa = 'TRUSTED') {
  return { group_code: group, market, official_price: price, currency, qa_status: qa, note: null, collected_at: '2026-08-17' };
}
function build(over = {}) {
  return buildPricing({
    date: '2026-09-16', previousDate: null, opportunity: OPP,
    items: [], skuMarkets: [], snapshot: [], previousSnapshot: [], fxRates: FX, benchmarks: [],
    ...over
  });
}
const ITEM = { group_code: 'G1', title: 'Jogo', item_label: '100 Gems', fulfillment: 'topup', include: true, custom_markup_pct: null };

/* ── parse do product_code (netlify/lib/supply.mjs) ───────────────────── */

test('parseProduct usa os campos da API, não a regex', () => {
  const r = parseProduct({ code: 'FFLATAM100-S116', group_product_code: 'FFLATAM100', provider_code: 'S116', price: 12416, status: 'available' }, 'mx');
  assert.equal(r.group_code, 'FFLATAM100');
  assert.equal(r.provider_code, 'S116');
  assert.equal(r.price_idr, 12416);
});

test('parseProduct: fallback separa grupo, provider e sufixo de país', () => {
  const cases = [
    ['BST1000-S1-ph', 'BST1000', 'S1'],
    ['FFLATAM100-S116', 'FFLATAM100', 'S116'],
    ['MLGLO78_8-S11-br', 'MLGLO78_8', 'S11'],   // grupo com underscore
    ['ML40_4-S50A-sg', 'ML40_4', 'S50A'],        // provider com letra + país
    ['UCPUBGMGLOBAL60-S113-sa', 'UCPUBGMGLOBAL60', 'S113'],
    ['XBOXUSD50-S110AB2C', 'XBOXUSD50', 'S110AB2C']
  ];
  for (const [code, group, provider] of cases) {
    const r = parseProduct({ code, price: 1, status: 'available' }, 'xx');
    assert.ok(r, `${code} não parseou`);
    assert.equal(r.group_code, group, code);
    assert.equal(r.provider_code, provider, code);
  }
});

test('rowsFromProducts guarda só available e dedupe pelo menor preço', () => {
  const produtos = [
    { code: 'A-S1', group_product_code: 'A', provider_code: 'S1', price: 100, status: 'available' },
    { code: 'A-S1', group_product_code: 'A', provider_code: 'S1', price: 90, status: 'available' },  // PK repetida
    { code: 'A-S2', group_product_code: 'A', provider_code: 'S2', price: 50, status: 'empty' },
    { code: 'lixo', price: 10, status: 'available' }
  ];
  const { rows, duplicates, skipped } = rowsFromProducts(produtos, 'br');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price_idr, 90, 'empate de PK fica com o menor');
  assert.equal(duplicates, 1);
  assert.equal(skipped, 1, 'código sem campos e sem forma de regex é descartado');
});

/* ── menor preço por grupo: empate, empty, override ───────────────────── */

test('pickBestSku: menor preço entre providers e países', () => {
  const best = pickBestSku([
    snap('G1', 'G1-S1', 1000, { country: 'br' }),
    snap('G1', 'G1-S2', 800, { country: 'ar' }),
    snap('G1', 'G1-S3', 900, { country: 'mx' })
  ]);
  assert.equal(best.row.product_code, 'G1-S2');
});

test('pickBestSku: empate desempata pelo product_code, sempre igual', () => {
  const rows = [snap('G1', 'G1-S9', 500), snap('G1', 'G1-S2', 500), snap('G1', 'G1-S5', 500)];
  assert.equal(pickBestSku(rows).row.product_code, 'G1-S2');
  assert.equal(pickBestSku([...rows].reverse()).row.product_code, 'G1-S2', 'ordem de entrada não pode mudar o vencedor');
});

test('pickBestSku: só empty é sem_supply', () => {
  const best = pickBestSku([snap('G1', 'G1-S1', 100, { status: 'empty' })]);
  assert.equal(best.row, null);
  assert.equal(best.reason, 'sem_supply');
});

test('pickBestSku: lista vazia é sem_supply, não estoura', () => {
  assert.equal(pickBestSku(undefined).reason, 'sem_supply');
  assert.equal(pickBestSku([]).reason, 'sem_supply');
});

test('pickBestSku: override vence o mais barato', () => {
  const rows = [snap('G1', 'G1-S1', 100), snap('G1', 'G1-S7', 900)];
  const best = pickBestSku(rows, { skuOverride: 'G1-S7' });
  assert.equal(best.row.product_code, 'G1-S7');
});

test('pickBestSku: override sem supply NÃO cai no mais barato', () => {
  const rows = [snap('G1', 'G1-S1', 100), snap('G1', 'G1-S7', 900, { status: 'empty' })];
  const best = pickBestSku(rows, { skuOverride: 'G1-S7' });
  assert.equal(best.row, null);
  assert.equal(best.reason, 'override_sem_supply');
});

/* ── elegibilidade por mercado ────────────────────────────────────────── */

test('item sem nenhum mercado habilitado sai da cotação e vira flag', () => {
  const out = build({ items: [ITEM], skuMarkets: [], snapshot: [snap('G1', 'G1-S1', 1000)] });
  assert.equal(out.rows.length, 0);
  assert.equal(out.excluded.length, 1);
  assert.equal(out.flags.filter((f) => f.type === 'sem_de_para').length, 1);
});

test('item habilitado em um mercado entra e marca os outros como inelegíveis', () => {
  const out = build({ items: [ITEM], skuMarkets: [sku('G1', 'PE')], snapshot: [snap('G1', 'G1-S1', 1000)] });
  assert.equal(out.rows.length, 1);
  assert.deepEqual(out.rows[0].eligibleMarkets, ['PE']);
  assert.deepEqual(out.rows[0].ineligibleMarkets, ['AR', 'MX']);
});

test('mercado com enabled=false não habilita', () => {
  const out = build({ items: [ITEM], skuMarkets: [sku('G1', 'AR', { enabled: false })], snapshot: [snap('G1', 'G1-S1', 1000)] });
  assert.equal(out.rows.length, 0);
});

/* ── custo, markup e preço ao parceiro ────────────────────────────────── */

test('custo USD sai do menor IDR dividido pelo câmbio do dia', () => {
  const out = build({
    items: [ITEM], skuMarkets: [sku('G1', 'AR')],
    snapshot: [snap('G1', 'G1-S1', 12416, { country: 'mx' }), snap('G1', 'G1-S2', 20000)]
  });
  const row = out.rows[0];
  assert.equal(row.costIdr, 12416);
  assert.equal(row.costUsd.toFixed(4), '0.7029');          // 12416 / 17663
  assert.equal(row.partnerUsd.toFixed(4), '0.7170');        // x 1,02
  assert.equal(row.bestCountry, 'mx');
});

test('markup do item vence o da oportunidade; fee entra depois do markup', () => {
  const out = build({
    opportunity: { ...OPP, fee_fixed_usd: '0.25' },
    items: [{ ...ITEM, custom_markup_pct: '0.10' }],
    skuMarkets: [sku('G1', 'AR')], snapshot: [snap('G1', 'G1-S1', 17663)]
  });
  // custo 1,00 → 1,00 x 1,10 = 1,10 → + 0,25 = 1,35
  assert.equal(out.rows[0].partnerUsd.toFixed(2), '1.35');
  assert.equal(out.rows[0].customMarkup, true);
});

test('partnerPrice é exato onde o float erraria', () => {
  const p = partnerPrice({ costUsd: dec('0.1'), markupPct: dec('0.2'), feeFixedUsd: dec('0.1') });
  assert.equal(p.toFixed(2), '0.22');   // 0,1*1,2 = 0,12 + 0,1
});

/* ── sem supply ───────────────────────────────────────────────────────── */

test('sem supply: linha fica, sem preço, marcada com a data', () => {
  const out = build({
    items: [ITEM], skuMarkets: [sku('G1', 'AR')],
    snapshot: [snap('G1', 'G1-S1', 1000, { status: 'empty' })]
  });
  const row = out.rows[0];
  assert.equal(row.blocked, true);
  assert.equal(row.partnerUsd, null);
  assert.match(row.blockReason, /SEM SUPPLY em 2026-09-16/);
});

test('grupo ausente do snapshot também é sem supply', () => {
  const out = build({ items: [ITEM], skuMarkets: [sku('G1', 'AR')], snapshot: [] });
  assert.equal(out.rows[0].blocked, true);
});

/* ── headroom ─────────────────────────────────────────────────────────── */

test('headroom usa GLOBAL quando não há benchmark do mercado', () => {
  const out = build({
    items: [ITEM], skuMarkets: [sku('G1', 'AR')], snapshot: [snap('G1', 'G1-S1', 17663)],
    benchmarks: [bench('G1', 'GLOBAL', 2, 'USD')]
  });
  const row = out.rows[0];
  assert.equal(row.reference.market, 'GLOBAL');
  // parceiro 1,02 contra oficial 2,00 → sobra 49%
  assert.equal(row.headroomPct.mul(100).toFixed(1), '49.0');
});

test('sem GLOBAL, a referência vem do primeiro mercado da oportunidade que tem benchmark', () => {
  const out = build({
    items: [ITEM], skuMarkets: [sku('G1', 'AR'), sku('G1', 'MX')], snapshot: [snap('G1', 'G1-S1', 17663)],
    benchmarks: [bench('G1', 'AR', 2857.14, 'ARS')]   // 2857,14 / 1428,57 = USD 2,00
  });
  const row = out.rows[0];
  assert.equal(row.reference.market, 'AR');
  assert.equal(row.reference.usd.toFixed(2), '2.00');
  assert.equal(row.headroomPct.mul(100).toFixed(1), '49.0');
});

test('aba multi-mercado: benchmark do mercado vence o GLOBAL', () => {
  const out = build({
    items: [ITEM], skuMarkets: [sku('G1', 'AR'), sku('G1', 'MX')], snapshot: [snap('G1', 'G1-S1', 17663)],
    benchmarks: [bench('G1', 'GLOBAL', 2, 'USD'), bench('G1', 'MX', 34.9, 'MXN')]
  });
  const ar = out.marketRows.find((r) => r.market === 'AR');
  const mx = out.marketRows.find((r) => r.market === 'MX');
  assert.equal(ar.benchmarkFrom, 'GLOBAL');
  assert.equal(mx.benchmarkFrom, 'MX');
  assert.equal(mx.officialUsd.toFixed(2), '2.00');   // 34,90 / 17,45
});

test('QA SUSPECT e BLOCKED não calculam headroom', () => {
  for (const qa of ['SUSPECT', 'BLOCKED']) {
    const out = build({
      items: [ITEM], skuMarkets: [sku('G1', 'AR')], snapshot: [snap('G1', 'G1-S1', 17663)],
      benchmarks: [bench('G1', 'GLOBAL', 2, 'USD', qa)]
    });
    assert.equal(out.rows[0].headroomPct, null, qa);
    assert.match(out.rows[0].headroomReason, new RegExp(qa));
  }
});

test('moeda sem câmbio nenhum não calcula headroom e vira flag', () => {
  const out = build({
    items: [ITEM], skuMarkets: [sku('G1', 'AR')], snapshot: [snap('G1', 'G1-S1', 17663)],
    benchmarks: [bench('G1', 'GLOBAL', 100, 'COP')]
  });
  assert.equal(out.rows[0].headroomPct, null);
  assert.equal(out.flags.filter((f) => f.type === 'benchmark_sem_fx').length, 1);
});

test('preço acima do oficial dá headroom negativo e flag', () => {
  const out = build({
    items: [ITEM], skuMarkets: [sku('G1', 'AR')], snapshot: [snap('G1', 'G1-S1', 17663)],
    benchmarks: [bench('G1', 'GLOBAL', 0.5, 'USD')]
  });
  assert.equal(out.rows[0].headroomPct.isNegative(), true);
  assert.equal(out.flags.filter((f) => f.type === 'preco_acima_do_oficial').length, 1);
});

test('item sem benchmark nenhum vira flag', () => {
  const out = build({ items: [ITEM], skuMarkets: [sku('G1', 'AR')], snapshot: [snap('G1', 'G1-S1', 17663)] });
  assert.equal(out.flags.filter((f) => f.type === 'sem_benchmark').length, 1);
});

/* ── câmbio ───────────────────────────────────────────────────────────── */

test('override de FX vence o câmbio do dia', () => {
  const { rate, source } = rateFor('ARS', { fxOverrides: { USD_ARS: '1428.57' }, fxRates: { USD_ARS: '1514.75' } });
  assert.equal(source, 'override');
  assert.equal(rate.toFixed(2), '1428.57');
});

test('override defasado mais de 5% vira flag', () => {
  const out = build({ fxRates: { ...FX, USD_ARS: '1514.75' } });
  const f = out.flags.find((x) => x.type === 'fx_override_divergente');
  assert.ok(f, 'esperava flag de divergência');
  assert.match(f.detail, /USD_ARS/);
});

test('divergência abaixo de 5% não vira flag', () => {
  const out = build({ fxRates: { ...FX, USD_ARS: '1450' } });   // ~1,5%
  assert.equal(out.flags.filter((x) => x.type === 'fx_override_divergente').length, 0);
});

test('sem USD_IDR o gerador para em vez de cotar errado', () => {
  assert.throws(() => build({ fxRates: { USD_ARS: '1428.57' } }), /USD_IDR/);
});

/* ── DELTA ────────────────────────────────────────────────────────────── */

test('DELTA lista variação acima de 0,5% e ignora abaixo', () => {
  const base = { items: [ITEM], skuMarkets: [sku('G1', 'AR')] };
  const subiu = build({ ...base, snapshot: [snap('G1', 'G1-S1', 10100)], previousSnapshot: [snap('G1', 'G1-S1', 10000)] });
  assert.equal(subiu.delta.length, 1);
  assert.equal(subiu.delta[0].kind, 'subiu');
  assert.equal(subiu.delta[0].pct.mul(100).toFixed(1), '1.0');

  const quieto = build({ ...base, snapshot: [snap('G1', 'G1-S1', 10040)], previousSnapshot: [snap('G1', 'G1-S1', 10000)] });
  assert.equal(quieto.delta.length, 0, '0,4% fica de fora');
});

test('DELTA marca grupo novo e grupo que sumiu', () => {
  const base = { items: [ITEM], skuMarkets: [sku('G1', 'AR')] };
  const novo = build({ ...base, snapshot: [snap('G1', 'G1-S1', 10000)], previousSnapshot: [] });
  assert.equal(novo.delta[0].kind, 'novo');

  const sumiu = build({ ...base, snapshot: [], previousSnapshot: [snap('G1', 'G1-S1', 10000)] });
  assert.equal(sumiu.delta[0].kind, 'sumiu');
});

/* ── override por mercado ─────────────────────────────────────────────── */

test('overrides diferentes por mercado: fica o mais caro e sai flag', () => {
  const out = build({
    items: [ITEM],
    skuMarkets: [sku('G1', 'AR', { sku_override: 'G1-S1' }), sku('G1', 'MX', { sku_override: 'G1-S7' })],
    snapshot: [snap('G1', 'G1-S1', 100), snap('G1', 'G1-S7', 900)]
  });
  assert.equal(out.rows[0].bestSku, 'G1-S7');
  assert.equal(out.flags.filter((f) => f.type === 'override_conflitante').length, 1);
});

test('include=false fica de fora', () => {
  const out = build({ items: [{ ...ITEM, include: false }], skuMarkets: [sku('G1', 'AR')], snapshot: [snap('G1', 'G1-S1', 100)] });
  assert.equal(out.rows.length, 0);
  assert.equal(out.excluded.length, 0, 'include=false não é "sem DE>PARA"');
});

/* ── Idade do câmbio (achado de 20/09: só o USD_IDR é diário) ─────────── */

test('fxAgeDays lê a data do created_date que o snapshot guardou', () => {
  assert.equal(fxAgeDays('lapak:2026-08-27 14:17:56', '2026-09-20'), 24);
  assert.equal(fxAgeDays('lapak:2026-09-20 00:00:05', '2026-09-20'), 0);
  assert.equal(fxAgeDays('manual', '2026-09-20'), null);
  assert.equal(fxAgeDays(null, '2026-09-20'), null);
});

test('taxa da Lapak com mais de 7 dias vira flag, uma por par', () => {
  const out = build({
    items: [ITEM, { ...ITEM, group_code: 'G2', item_label: '200 Gems' }],
    skuMarkets: [sku('G1', 'PE'), sku('G2', 'PE')],
    snapshot: [snap('G1', 'G1-S1', 17663), snap('G2', 'G2-S1', 17663)],
    benchmarks: [bench('G1', 'PE', 10, 'PEN'), bench('G2', 'PE', 20, 'PEN')],
    fxSources: { USD_IDR: 'lapak:2026-09-16 00:00:05', USD_PEN: 'lapak:2026-08-27 14:17:56' }
  });
  const velhas = out.flags.filter((f) => f.type === 'fx_desatualizado');
  assert.equal(velhas.length, 1, 'um flag por par, não um por item');
  assert.match(velhas[0].detail, /USD_PEN.*20 dias/);
});

test('taxa fresca não vira flag', () => {
  const out = build({ fxSources: { USD_IDR: 'lapak:2026-09-16 00:00:05' } });
  assert.equal(out.flags.filter((f) => f.type === 'fx_desatualizado').length, 0);
});

test('o flag de divergência passa a dizer a idade da taxa comparada', () => {
  const out = build({
    fxRates: { ...FX, USD_ARS: '1514.75' },
    fxSources: { USD_ARS: 'lapak:2026-08-27 14:17:56' }
  });
  const f = out.flags.find((x) => x.type === 'fx_override_divergente');
  assert.match(f.detail, /20 dias atrás/, 'sem a idade, "do dia" sugeria precisão que não existe');
});

test('par coberto por override é sinalizado diferente de par que converte sozinho', () => {
  const comOverride = build({ fxSources: { USD_IDR: 'lapak:2026-09-16 00:00:05', USD_ARS: 'lapak:2025-11-14 08:59:16' } });
  assert.match(comOverride.flags.find((f) => f.type === 'fx_desatualizado').detail, /override/);

  const semOverride = build({
    opportunity: { ...OPP, fx_overrides: {} },
    fxRates: { ...FX, USD_COP: '3123.27' },
    fxSources: { USD_IDR: 'lapak:2026-09-16 00:00:05', USD_COP: 'lapak:2025-11-14 08:59:16' }
  });
  assert.match(semOverride.flags.find((f) => f.detail.includes('USD_COP')).detail, /converte o benchmark/);
});
