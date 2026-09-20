/* ──────────────────────────────────────────────────────────────────────────
   pricing.mjs — as regras da planilha v5, em função pura

   Não faz rede, não lê arquivo, não sabe o que é Excel. Recebe um objeto
   com tudo que veio do banco e devolve linhas, delta e flags. É o que
   permite testar a conta sem Supabase e sem xlsx.

   ── ORDEM DAS REGRAS (a do brief, e ela importa) ────────────────────────
     1. Universo: itens da oportunidade com include = true.
     2. Elegibilidade: o grupo precisa estar enabled em com_sku_markets
        para o mercado. Item elegível em PELO MENOS UM mercado entra; os
        mercados não elegíveis ficam marcados na linha.
     3. Custo USD: menor price_idr entre TODOS os providers e TODOS os
        países varridos, convertido pelo USD_IDR do MESMO dia.
     4. Sem nenhum provider available: a linha FICA, marcada BLOCKED
        "SEM SUPPLY em <data>", sem preço cotado (comportamento da v5).
     5. Preço ao parceiro: custo x (1 + markup) + fee, com o markup do
        item vencendo o da oportunidade quando existir.
     6. Headroom: benchmark do mercado, senão o GLOBAL. SUSPECT e BLOCKED
        não calculam headroom.
     7. DELTA: variação de custo por grupo acima de 0,5% contra o snapshot
        anterior.

   ── DECISÕES QUE O BRIEF NÃO FECHA, e o porquê de cada uma ──────────────

   a) EMPATE de preço entre dois SKUs: vence o product_code menor em ordem
      alfabética. Qualquer critério serve, desde que seja SEMPRE o mesmo:
      duas execuções no mesmo dia têm que gerar a mesma planilha, senão o
      DELTA acusa variação que não existe.

   b) sku_override MORA POR MERCADO (a PK de com_sku_markets é grupo +
      mercado), mas o custo da v5 é UM por item. Quando os mercados
      elegíveis apontam overrides DIFERENTES, fica o MAIS CARO e sai FLAG.
      Cotar caro demais se conserta numa conversa; cotar abaixo do custo
      real come margem sem aparecer em lugar nenhum.

   c) Override que não tem supply no dia NÃO cai de volta no "menor do
      grupo". O operador escolheu aquele SKU por um motivo (provider que
      ele sabe que entrega); trocar por outro calado é decidir por ele.
      A linha vira BLOCKED e o FLAG diz que foi o override.

   d) PRICE LIST tem UMA linha por item, então a referência oficial dela é
      a GLOBAL. Sem GLOBAL, usa a do primeiro mercado da oportunidade que
      tiver benchmark (MNCT1720 e MNCT3500 só têm AR) e a coluna
      "Ref. market" diz de onde veio. O headroom mercado a mercado vive na
      aba multi-mercado.

   e) fx_overrides VENCE o câmbio do dia — taxa negociada é decisão, não
      cotação. Mas quando a divergência passa de 5% sai FLAG: o override
      da Plusmo é de 24/07 e em 16/09 já estava ~6% longe do real.
   ────────────────────────────────────────────────────────────────────── */

import { dec, Dec } from './decimal.mjs';

export const DELTA_THRESHOLD = dec('0.005');   // 0,5%
export const FX_DIVERGENCE_THRESHOLD = dec('0.05');  // 5%

/* Idade máxima de uma taxa da Lapak antes de virar FLAG.

   Descoberto em 20/09, e é o motivo desta constante existir: só o USD_IDR
   é diário na Lapak. No mesmo dia, USD_ARS, USD_COP e USD_PEN vieram com
   created_date de 27/08 (24 dias) e USD_PHP de 14/11/2025 (dez meses).
   Uma taxa dessas converte benchmark e sai como headroom sem nada na tela
   dizendo de quando ela é. O dado continua servindo de referência — moeda
   estável não anda muito — mas nunca mais entra mudo numa proposta. */
export const FX_STALE_DAYS = 7;
export const QA_WITHOUT_HEADROOM = new Set(['SUSPECT', 'BLOCKED']);

/* Idade em dias da taxa, lida do `source` que o snapshot grava
   ("lapak:2026-08-27 14:17:56" → o created_date que a Lapak devolveu).
   Devolve null quando não dá para saber — taxa manual, por exemplo. */
export function fxAgeDays(source, referenceDate) {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(String(source || ''));
  if (!m || !referenceDate) return null;
  const criada = Date.parse(`${m[1]}T00:00:00Z`);
  const ref = Date.parse(`${referenceDate}T00:00:00Z`);
  if (Number.isNaN(criada) || Number.isNaN(ref)) return null;
  return Math.round((ref - criada) / 86400000);
}

/* ── Passo 3: o SKU vencedor de um grupo ──────────────────────────────── */
export function pickBestSku(rows, { skuOverride = null } = {}) {
  const available = (rows || []).filter((r) => r.status === 'available');

  if (skuOverride) {
    const hit = available.filter((r) => r.product_code === skuOverride);
    if (!hit.length) return { row: null, reason: 'override_sem_supply', skuOverride };
    /* O mesmo product_code pode aparecer em mais de um país consultado,
       com preço diferente. Entre eles, o menor. */
    return { row: cheapest(hit), reason: null, skuOverride };
  }

  if (!available.length) return { row: null, reason: 'sem_supply', skuOverride: null };
  return { row: cheapest(available), reason: null, skuOverride: null };
}

/* Menor preço; empate desempata pelo product_code, depois pelo país. */
function cheapest(rows) {
  return [...rows].sort((a, b) =>
    (a.price_idr - b.price_idr) ||
    String(a.product_code).localeCompare(String(b.product_code)) ||
    String(a.query_country).localeCompare(String(b.query_country))
  )[0];
}

/* ── Passo 5: preço ao parceiro ───────────────────────────────────────── */
export function partnerPrice({ costUsd, markupPct, feeFixedUsd }) {
  return dec(costUsd).mul(dec(1).add(markupPct)).add(feeFixedUsd);
}

/* ── Passo 6: benchmark e headroom ────────────────────────────────────── */

/* Câmbio para converter o benchmark em USD. Convenção única do motor:
   USD_XXX = unidades de XXX por 1 USD, então USD = local / taxa. */
export function rateFor(currency, { fxOverrides = {}, fxRates = {} } = {}) {
  if (!currency) return { rate: null, source: null };
  if (currency === 'USD') return { rate: dec(1), source: 'par' };
  const pair = `USD_${currency}`;
  if (fxOverrides[pair] !== undefined && fxOverrides[pair] !== null) {
    return { rate: dec(fxOverrides[pair]), source: 'override' };
  }
  if (fxRates[pair] !== undefined && fxRates[pair] !== null) {
    return { rate: dec(fxRates[pair]), source: 'lapak' };
  }
  return { rate: null, source: null };
}

export function benchmarkUsd(benchmark, fx) {
  if (!benchmark || benchmark.official_price === null || benchmark.official_price === undefined) {
    return { usd: null, reason: 'sem_preco' };
  }
  const { rate, source } = rateFor(benchmark.currency, fx);
  if (!rate) return { usd: null, reason: 'sem_fx' };
  return { usd: dec(benchmark.official_price).div(rate), reason: null, fxSource: source };
}

/* Headroom = quanto do preço oficial ainda sobra acima do que cobramos.
   Negativo significa que a proposta está ACIMA do preço oficial — não é
   erro de conta, é sinal de que não dá para vender. */
export function headroom({ officialUsd, partnerUsd }) {
  if (!officialUsd || officialUsd.isZero()) return null;
  return dec(officialUsd).sub(partnerUsd).div(officialUsd);
}

/* ── Orquestração ─────────────────────────────────────────────────────── */
export function buildPricing(input) {
  const {
    date, previousDate = null, opportunity, items = [], skuMarkets = [],
    snapshot = [], previousSnapshot = [], fxRates = {}, fxSources = {}, benchmarks = []
  } = input;

  const markets = opportunity.markets || [];
  const fxOverrides = opportunity.fx_overrides || {};
  const fx = { fxOverrides, fxRates };
  const flags = [];

  const usdIdr = fxRates.USD_IDR;
  if (!usdIdr) throw new Error(`pricing: sem câmbio USD_IDR para ${date} — sem ele não há custo em dólar`);
  const idrRate = dec(usdIdr);

  /* Idade de cada taxa da Lapak. Um flag por PAR, não por item: cinquenta
     linhas repetindo "USD_ARS está velho" enterrariam o resto. */
  const idade = {};
  for (const [pair, source] of Object.entries(fxSources)) {
    const dias = fxAgeDays(source, date);
    idade[pair] = dias;
    if (dias === null || dias <= FX_STALE_DAYS) continue;
    const coberto = fxOverrides[pair] !== undefined && fxOverrides[pair] !== null;
    flags.push({
      type: 'fx_desatualizado', group: null,
      detail: `${pair} da Lapak tem ${dias} dias (criada em ${String(source).replace(/^lapak:/, '')})` +
              (coberto ? ' — nesta oportunidade quem vale é o override, mas a comparação com ele fica frouxa'
                       : ' — é ela que converte o benchmark deste mercado')
    });
  }

  /* fx_overrides defasado é erro silencioso de proposta: só sai daqui. */
  for (const [pair, value] of Object.entries(fxOverrides)) {
    if (fxRates[pair] === undefined || fxRates[pair] === null) continue;
    const ov = dec(value);
    const real = dec(fxRates[pair]);
    if (real.isZero()) continue;
    const diff = ov.sub(real).div(real).abs();
    if (diff.gt(FX_DIVERGENCE_THRESHOLD)) {
      /* A idade entra no texto porque sem ela o flag sugere uma precisão
         que não existe: comparar um override de julho com uma taxa de
         agosto e chamar a segunda de "do dia" é enganoso. */
      const dias = idade[pair];
      const quando = dias === null || dias === undefined ? 'da Lapak'
        : dias === 0 ? 'da Lapak, de hoje'
        : `da Lapak, de ${dias} dia${dias === 1 ? '' : 's'} atrás`;
      flags.push({
        type: 'fx_override_divergente', group: null,
        detail: `${pair}: override ${ov.toFixed(4)} contra ${real.toFixed(4)} ${quando} (${diff.mul(100).toFixed(1)}% de diferença)`
      });
    }
  }

  const byGroup = groupRows(snapshot);
  const prevByGroup = groupRows(previousSnapshot);
  const marketsOf = indexSkuMarkets(skuMarkets);
  const bmOf = indexBenchmarks(benchmarks);

  const rows = [];
  const marketRows = [];
  const excluded = [];

  for (const item of items) {
    if (item.include === false) continue;
    const group = item.group_code;

    /* Passo 2 — elegibilidade */
    const eligible = markets.filter((m) => marketsOf.get(`${group}|${m}`)?.enabled);
    const ineligible = markets.filter((m) => !eligible.includes(m));
    if (!eligible.length) {
      excluded.push({ group, title: item.title, item: item.item_label });
      flags.push({ type: 'sem_de_para', group, detail: `nenhum mercado habilitado em ${markets.join('/')} — item fora da cotação` });
      continue;
    }

    /* Passo 3 — custo, respeitando override (decisão b) */
    const overrides = [...new Set(eligible
      .map((m) => marketsOf.get(`${group}|${m}`)?.sku_override)
      .filter(Boolean))];
    let override = null;
    if (overrides.length === 1) {
      override = overrides[0];
    } else if (overrides.length > 1) {
      const candidates = (byGroup.get(group) || []).filter((r) => overrides.includes(r.product_code) && r.status === 'available');
      override = candidates.length
        ? [...candidates].sort((a, b) => b.price_idr - a.price_idr)[0].product_code
        : overrides.slice().sort()[0];
      flags.push({ type: 'override_conflitante', group, detail: `overrides diferentes por mercado (${overrides.join(', ')}); ficou ${override}, o mais caro` });
    }

    const best = pickBestSku(byGroup.get(group), { skuOverride: override });
    const markupPct = item.custom_markup_pct !== null && item.custom_markup_pct !== undefined
      ? dec(item.custom_markup_pct) : dec(opportunity.markup_pct);
    const feeUsd = dec(opportunity.fee_fixed_usd || 0);

    const row = {
      group, title: item.title, item: item.item_label,
      mode: item.fulfillment,
      eligibleMarkets: eligible, ineligibleMarkets: ineligible,
      markupPct, feeUsd,
      customMarkup: item.custom_markup_pct !== null && item.custom_markup_pct !== undefined,
      blocked: false, blockReason: null,
      bestSku: null, bestProvider: null, bestCountry: null, providersSeen: (byGroup.get(group) || []).length,
      costIdr: null, costUsd: null, partnerUsd: null,
      reference: null, headroomPct: null, headroomReason: null
    };

    /* Passo 4 — sem supply: a linha fica, sem preço */
    if (!best.row) {
      row.blocked = true;
      row.blockReason = best.reason === 'override_sem_supply'
        ? `SEM SUPPLY em ${date} (override ${best.skuOverride} indisponível)`
        : `SEM SUPPLY em ${date}`;
      flags.push({ type: best.reason, group, detail: row.blockReason });
    } else {
      row.bestSku = best.row.product_code;
      row.bestProvider = best.row.provider_code;
      row.bestCountry = best.row.query_country;
      row.costIdr = best.row.price_idr;
      row.costUsd = dec(best.row.price_idr).div(idrRate);
      row.partnerUsd = partnerPrice({ costUsd: row.costUsd, markupPct, feeFixedUsd: feeUsd });
    }

    /* Passo 6 — referência oficial da PRICE LIST (decisão d) */
    const groupBm = bmOf.get(group) || new Map();
    const refMarket = groupBm.has('GLOBAL') ? 'GLOBAL' : eligible.find((m) => groupBm.has(m)) || null;
    const bm = refMarket ? groupBm.get(refMarket) : null;
    if (!bm) {
      flags.push({ type: 'sem_benchmark', group, detail: 'nenhuma referência oficial cadastrada' });
    } else {
      const { usd, reason } = benchmarkUsd(bm, fx);
      row.reference = {
        market: refMarket, price: bm.official_price, currency: bm.currency,
        qa: bm.qa_status, note: bm.note, usd
      };
      if (bm.qa_status === 'COLLECT') {
        flags.push({ type: 'benchmark_collect', group, detail: `referência ${refMarket} ainda não pesquisada` });
      }
      if (QA_WITHOUT_HEADROOM.has(bm.qa_status)) {
        row.headroomReason = `QA ${bm.qa_status} não calcula headroom`;
        if (bm.qa_status === 'SUSPECT') {
          flags.push({ type: 'benchmark_suspect', group, detail: bm.note || 'referência duvidosa' });
        }
      } else if (reason === 'sem_fx') {
        row.headroomReason = `sem câmbio para ${bm.currency}`;
        flags.push({ type: 'benchmark_sem_fx', group, detail: `${bm.currency} sem taxa no dia nem override` });
      } else if (row.partnerUsd && usd) {
        row.headroomPct = headroom({ officialUsd: usd, partnerUsd: row.partnerUsd });
        if (row.headroomPct.isNegative()) {
          flags.push({ type: 'preco_acima_do_oficial', group, detail: `proposta USD ${row.partnerUsd.toFixed(2)} acima do oficial USD ${usd.toFixed(2)}` });
        }
      } else if (!row.partnerUsd) {
        row.headroomReason = 'sem preço cotado';
      }
    }

    /* Aba multi-mercado: uma linha por mercado elegível que tem benchmark
       próprio OU herda o GLOBAL. */
    for (const m of eligible) {
      const mbm = groupBm.get(m) || groupBm.get('GLOBAL') || null;
      if (!mbm) continue;
      const from = groupBm.has(m) ? m : 'GLOBAL';
      const { usd, reason: r2 } = benchmarkUsd(mbm, fx);
      const hr = (!QA_WITHOUT_HEADROOM.has(mbm.qa_status) && usd && row.partnerUsd)
        ? headroom({ officialUsd: usd, partnerUsd: row.partnerUsd }) : null;
      marketRows.push({
        group, title: item.title, item: item.item_label, market: m, benchmarkFrom: from,
        official: mbm.official_price, currency: mbm.currency, qa: mbm.qa_status,
        officialUsd: usd, partnerUsd: row.partnerUsd, headroomPct: hr,
        reason: hr ? null : (QA_WITHOUT_HEADROOM.has(mbm.qa_status) ? `QA ${mbm.qa_status}` : r2 === 'sem_fx' ? `sem câmbio ${mbm.currency}` : 'sem preço cotado')
      });
    }

    rows.push(row);
  }

  return {
    date, previousDate,
    opportunity,
    rows, marketRows, excluded,
    delta: buildDelta({ byGroup, prevByGroup, rows, idrRate }),
    flags,
    inputs: {
      markupPct: dec(opportunity.markup_pct), feeFixedUsd: dec(opportunity.fee_fixed_usd || 0),
      usdIdr: idrRate, fxOverrides, fxRates, fxSources, fxAges: idade, markets
    }
  };
}

/* ── Passo 7: DELTA ───────────────────────────────────────────────────── */
function buildDelta({ byGroup, prevByGroup, rows, idrRate }) {
  const out = [];
  for (const row of rows) {
    const prevBest = pickBestSku(prevByGroup.get(row.group));
    const now = row.costIdr;
    const before = prevBest.row ? prevBest.row.price_idr : null;

    if (before === null && now === null) continue;
    if (before === null) { out.push({ group: row.group, title: row.title, item: row.item, kind: 'novo', before: null, now, pct: null }); continue; }
    if (now === null) { out.push({ group: row.group, title: row.title, item: row.item, kind: 'sumiu', before, now: null, pct: null }); continue; }

    const pct = dec(now).sub(before).div(before);
    if (pct.abs().gt(DELTA_THRESHOLD)) {
      out.push({
        group: row.group, title: row.title, item: row.item,
        kind: pct.isNegative() ? 'baixou' : 'subiu',
        before, now, pct,
        beforeUsd: dec(before).div(idrRate), nowUsd: dec(now).div(idrRate)
      });
    }
  }
  return out;
}

/* ── Índices ──────────────────────────────────────────────────────────── */
function groupRows(snapshot) {
  const m = new Map();
  for (const r of snapshot) {
    if (!m.has(r.group_code)) m.set(r.group_code, []);
    m.get(r.group_code).push(r);
  }
  return m;
}

function indexSkuMarkets(list) {
  const m = new Map();
  for (const s of list) m.set(`${s.group_code}|${s.market}`, s);
  return m;
}

function indexBenchmarks(list) {
  const m = new Map();
  for (const b of list) {
    if (!m.has(b.group_code)) m.set(b.group_code, new Map());
    m.get(b.group_code).set(b.market, b);
  }
  return m;
}

export { Dec };
