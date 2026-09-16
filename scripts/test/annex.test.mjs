/* ──────────────────────────────────────────────────────────────────────────
   O teste que impede o vazamento: GERA o Annex A de verdade, ABRE de volta
   com exceljs e varre célula por célula. Testar só o modelo em memória não
   provaria nada sobre o arquivo que sai pelo e-mail.
   ────────────────────────────────────────────────────────────────────── */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { test } from './harness.mjs';
import { buildPricing } from '../lib/pricing.mjs';
import { writeAnnex, writeInternal, ANNEX_COLUMNS, annexRows } from '../lib/workbook.mjs';

/* Fixture de propósito CHEIO de coisa sensível: custo, margem, SKU de
   provider, país de origem do supply, nota interna que cita provider. */
const FIXTURE = {
  date: '2026-09-16',
  previousDate: '2026-09-15',
  opportunity: {
    slug: 'plusmo', name: 'Plusmo', markets: ['AR', 'MX', 'PE'],
    markup_pct: '0.02', fee_fixed_usd: '0.05',
    fx_overrides: { USD_ARS: '1428.57', USD_MXN: '17.45' }
  },
  items: [
    { group_code: 'FFLATAM100', title: 'Free Fire', item_label: '100 Diamonds', fulfillment: 'topup', include: true, custom_markup_pct: null },
    { group_code: 'XBOXUSD10', title: 'Xbox', item_label: 'Xbox Gift Card USD 10', fulfillment: 'pin', include: true, custom_markup_pct: '0.07' },
    { group_code: 'ZZZ300', title: 'Zenless', item_label: '300 + 30 Monochrome', fulfillment: 'topup', include: true, custom_markup_pct: null }
  ],
  skuMarkets: [
    { group_code: 'FFLATAM100', market: 'AR', enabled: true, sku_override: null },
    { group_code: 'FFLATAM100', market: 'MX', enabled: true, sku_override: null },
    { group_code: 'XBOXUSD10', market: 'AR', enabled: true, sku_override: null },
    { group_code: 'ZZZ300', market: 'AR', enabled: true, sku_override: null }
  ],
  snapshot: [
    { group_code: 'FFLATAM100', product_code: 'FFLATAM100-S136-mx', provider_code: 'S136', price_idr: 12416, status: 'available', query_country: 'mx' },
    { group_code: 'FFLATAM100', product_code: 'FFLATAM100-S116', provider_code: 'S116', price_idr: 13990, status: 'available', query_country: 'ar' },
    { group_code: 'XBOXUSD10', product_code: 'XBOXUSD10-S22-id', provider_code: 'S22', price_idr: 394773, status: 'available', query_country: 'id' }
  ],
  previousSnapshot: [
    { group_code: 'FFLATAM100', product_code: 'FFLATAM100-S136-mx', provider_code: 'S136', price_idr: 12000, status: 'available', query_country: 'mx' }
  ],
  fxRates: { USD_IDR: '17663', USD_ARS: '1514.75', USD_MXN: '17.45' },
  benchmarks: [
    { group_code: 'FFLATAM100', market: 'GLOBAL', official_price: 0.99, currency: 'USD', qa_status: 'TRUSTED', note: 'Confirmar pack 100 vs 110', collected_at: '2026-08-17' },
    { group_code: 'FFLATAM100', market: 'MX', official_price: 19.0, currency: 'MXN', qa_status: 'TRUSTED', note: 'FF MULTI-MARKET v5', collected_at: '2026-08-17' },
    { group_code: 'XBOXUSD10', market: 'GLOBAL', official_price: 10.0, currency: 'USD', qa_status: 'VERIFY', note: 'S22 reabastecido MAIS BARATO (22,35 vs 23,29 do S16)', collected_at: '2026-08-17' },
    { group_code: 'ZZZ300', market: 'GLOBAL', official_price: 4.99, currency: 'USD', qa_status: 'BLOCKED', note: 'SEM SUPPLY em nenhum provedor', collected_at: '2026-08-17' }
  ]
};

const pricing = buildPricing(FIXTURE);

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v.text) return String(v.text);
    if (v.result !== undefined) return String(v.result);
    return JSON.stringify(v);
  }
  return String(v);
}

async function readCells(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const cells = [];
  wb.eachSheet((sheet) => {
    cells.push({ sheet: sheet.name, ref: 'nome da aba', text: sheet.name, value: sheet.name });
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        cells.push({ sheet: sheet.name, ref: `${sheet.name}!R${rowNumber}C${colNumber}`, text: cellText(cell.value), value: cell.value });
      });
    });
  });
  return { wb, cells };
}

function withTmp(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'annex-'));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

/* ── O teste de whitelist ─────────────────────────────────────────────── */

test('Annex A: o arquivo gerado não tem custo, margem, SKU de provider nem IDR', () => withTmp(async (dir) => {
  const file = path.join(dir, 'plusmo-annex-a-2026-09-16.xlsx');
  await writeAnnex(pricing, file);
  const { wb, cells } = await readCells(file);

  /* Números proibidos: custo em IDR, custo em USD (em toda casa decimal
     plausível) e o markup. */
  const proibidosNum = [];
  for (const r of pricing.rows) {
    if (r.costIdr !== null) proibidosNum.push({ n: r.costIdr, o_que: `custo IDR de ${r.group}` });
    if (r.costUsd) for (const casas of [2, 3, 4, 6]) proibidosNum.push({ n: r.costUsd.toNumber(casas), o_que: `custo USD de ${r.group}` });
    proibidosNum.push({ n: r.markupPct.toNumber(6), o_que: `markup de ${r.group}` });
  }

  /* Textos proibidos: SKU, provider, grupo da Lapak, país de origem do
     supply, notas internas e a palavra IDR. */
  const proibidosTxt = [{ re: /\bIDR\b/i, o_que: 'a palavra IDR' },
                        { re: /custo|cost|markup|margem|margin|provider|supplier|fornecedor/i, o_que: 'vocabulário de custo/margem' },
                        { re: /-S\d+[A-Z]*/, o_que: 'SKU de provider' }];
  for (const r of pricing.rows) {
    if (r.bestSku) proibidosTxt.push({ re: new RegExp(escapeRe(r.bestSku)), o_que: `o SKU ${r.bestSku}` });
    if (r.bestProvider) proibidosTxt.push({ re: new RegExp(`\\b${escapeRe(r.bestProvider)}\\b`), o_que: `o provider ${r.bestProvider}` });
    proibidosTxt.push({ re: new RegExp(`\\b${escapeRe(r.group)}\\b`), o_que: `o group_code ${r.group}` });
  }
  for (const b of FIXTURE.benchmarks) {
    if (b.note) proibidosTxt.push({ re: new RegExp(escapeRe(b.note.slice(0, 20))), o_que: 'nota interna do benchmark' });
  }

  for (const c of cells) {
    for (const p of proibidosTxt) {
      assert.ok(!p.re.test(c.text), `VAZOU ${p.o_que} em ${c.ref}: "${c.text}"`);
    }
    if (typeof c.value === 'number') {
      for (const p of proibidosNum) {
        assert.ok(Math.abs(c.value - p.n) > 1e-9, `VAZOU ${p.o_que} (${p.n}) em ${c.ref}`);
      }
    }
  }

  /* Metadado também vaza. */
  assert.equal(wb.creator, 'Playvision');
  assert.equal(wb.lastModifiedBy, 'Playvision');
}));

test('Annex A: só as colunas da whitelist, nesta ordem, e uma aba só', () => withTmp(async (dir) => {
  const file = path.join(dir, 'annex.xlsx');
  await writeAnnex(pricing, file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  assert.equal(wb.worksheets.length, 1, 'o Annex A tem uma aba só');
  const sheet = wb.worksheets[0];
  assert.equal(sheet.name, 'Annex A');

  const header = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (c) => header.push(cellText(c.value)));
  assert.deepEqual(header, ANNEX_COLUMNS.map((c) => c.header));
  assert.equal(header.length, 6, 'coluna nova no Annex tem que ser decisão, não acidente');
}));

test('Annex A: leva o que tem que levar — preço, referência e headroom do item cotado', () => {
  const rows = annexRows(pricing);
  const ff = rows.find((r) => r.item === '100 Diamonds');
  assert.equal(ff.mode, 'Top-up');
  // custo 12416/17663 = 0,70293 → x1,02 = 0,71699 → +0,05 = 0,76699
  assert.equal(ff.price, 0.767);
  assert.equal(ff.reference, 0.99);
  assert.ok(ff.headroom > 0.22 && ff.headroom < 0.23, `headroom inesperado: ${ff.headroom}`);
});

test('Annex A: item sem supply aparece sem preço, não some da lista', () => {
  const rows = annexRows(pricing);
  const zzz = rows.find((r) => r.item.startsWith('300 +'));
  assert.ok(zzz, 'o item sem supply tem que continuar na lista que o parceiro pediu');
  assert.equal(zzz.price, 'No supply');
  assert.equal(zzz.headroom, '—');
});

test('Annex A: modo sai como Top-up / PIN, nunca o valor cru do banco', () => {
  const rows = annexRows(pricing);
  assert.deepEqual([...new Set(rows.map((r) => r.mode))].sort(), ['PIN', 'Top-up']);
});

/* ── A interna é o espelho: ela PRECISA ter o que o Annex não pode ────── */

test('a planilha interna tem custo, SKU e IDR — é o contraste que prova o teste', () => withTmp(async (dir) => {
  const file = path.join(dir, 'interna.xlsx');
  await writeInternal(pricing, file);
  const { cells } = await readCells(file);
  const texto = cells.map((c) => c.text).join('\n');

  assert.match(texto, /Cost IDR/, 'a interna mostra custo em IDR');
  assert.match(texto, /FFLATAM100-S136-mx/, 'a interna mostra o SKU vencedor');
  assert.match(texto, /Markup/, 'a interna mostra o markup');
  const abas = [...new Set(cells.map((c) => c.sheet))];
  assert.deepEqual(abas, ['READ ME', 'INPUTS', 'PRICE LIST', 'MULTI-MARKET', 'DELTA', 'FLAGS']);
}));

test('a interna registra o override de câmbio defasado', () => {
  const f = pricing.flags.find((x) => x.type === 'fx_override_divergente');
  assert.ok(f, 'USD_ARS 1428,57 contra 1514,75 do dia tem que virar flag');
});

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
