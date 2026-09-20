/* ──────────────────────────────────────────────────────────────────────────
   workbook.mjs — as duas planilhas: a interna e o Annex A

   A INTERNA é para nós: tem custo, margem, SKU do provider e IDR.
   O ANNEX A vai para o parceiro: NÃO pode ter nada disso.

   ── COMO O ANNEX FICA SEGURO ────────────────────────────────────────────
   Por LISTA POSITIVA, nunca por remoção. ANNEX_COLUMNS é a lista inteira
   do que existe no arquivo, e annexRows() monta cada linha campo a campo a
   partir dela. Não existe "pega a linha interna e apaga as colunas
   sensíveis": esse desenho falha aberto no dia em que alguém acrescenta
   uma coluna à planilha interna e esquece de atualizar a remoção.

   A prova está em test/annex.test.mjs, que GERA o arquivo, ABRE de volta e
   varre célula por célula atrás de custo, margem, SKU de provider e a
   palavra IDR — inclusive nos metadados do arquivo.
   ────────────────────────────────────────────────────────────────────── */
import ExcelJS from 'exceljs';

const MODE_LABEL = { topup: 'Top-up', pin: 'PIN' };
const EMPTY = '—';
const NO_SUPPLY = 'No supply';

const FMT_USD4 = '0.0000';
const FMT_USD2 = '0.00';
const FMT_IDR = '#,##0';
const FMT_PCT = '0.0%';

/* ── A lista positiva do Annex A ──────────────────────────────────────── */
export const ANNEX_COLUMNS = [
  { key: 'title',     header: 'Title',                   width: 22 },
  { key: 'item',      header: 'Item',                    width: 30 },
  { key: 'mode',      header: 'Mode',                    width: 10 },
  { key: 'price',     header: 'Partner Price (USD)',     width: 20, numFmt: FMT_USD4 },
  { key: 'reference', header: 'Official Reference (USD)', width: 24, numFmt: FMT_USD2 },
  { key: 'headroom',  header: 'Headroom',                width: 12, numFmt: FMT_PCT }
];

/* Puro de propósito: o teste do Annex valida esta função E o arquivo. */
export function annexRows(pricing) {
  return pricing.rows.map((r) => ({
    title: r.title,
    item: r.item,
    mode: MODE_LABEL[r.mode] || r.mode,
    price: r.blocked || !r.partnerUsd ? NO_SUPPLY : r.partnerUsd.toNumber(4),
    reference: r.reference && r.reference.usd ? r.reference.usd.toNumber(2) : EMPTY,
    headroom: r.headroomPct ? r.headroomPct.toNumber(6) : EMPTY
  }));
}

function newWorkbook() {
  const wb = new ExcelJS.Workbook();
  /* Metadado também é conteúdo: sai fixo, não com o usuário da máquina. */
  wb.creator = 'Playvision';
  wb.lastModifiedBy = 'Playvision';
  wb.created = new Date();
  wb.modified = new Date();
  return wb;
}

function header(sheet, columns) {
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 16 }));
  const row = sheet.getRow(1);
  row.font = { bold: true };
  row.alignment = { vertical: 'middle' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const c of columns) {
    if (c.numFmt) sheet.getColumn(c.key).numFmt = c.numFmt;
  }
}

/* ── Annex A — só o que está em ANNEX_COLUMNS ─────────────────────────── */
export async function writeAnnex(pricing, filePath) {
  const wb = newWorkbook();
  const sheet = wb.addWorksheet('Annex A');
  header(sheet, ANNEX_COLUMNS);
  for (const row of annexRows(pricing)) sheet.addRow(row);
  await wb.xlsx.writeFile(filePath);
  return filePath;
}

/* ── Planilha interna, no espírito da v5 ──────────────────────────────── */
export async function writeInternal(pricing, filePath) {
  const wb = newWorkbook();
  const { opportunity: opp, inputs } = pricing;

  /* READ ME */
  const readme = wb.addWorksheet('READ ME');
  readme.columns = [{ width: 24 }, { width: 100 }];
  const linhas = [
    ['Oportunidade', `${opp.name} (${opp.slug})`],
    ['Snapshot de custo', pricing.date],
    ['Snapshot anterior', pricing.previousDate || 'não há — sem DELTA nesta execução'],
    ['Gerado em', new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC'],
    ['', ''],
    ['USO INTERNO', 'Esta planilha tem CUSTO DE FORNECEDOR e MARGEM. Não mandar para o parceiro.'],
    ['Para o parceiro', 'Use o arquivo -annex-a-, que tem só título, item, modo, preço, referência e headroom.'],
    ['', ''],
    ['PRICE LIST', 'Uma linha por item cotado. Custo = menor preço available entre todos os providers e países do snapshot.'],
    ['MULTI-MARKET', 'Headroom mercado a mercado, quando há referência oficial própria do mercado.'],
    ['DELTA', `Variação de custo contra ${pricing.previousDate || 'o snapshot anterior'}, acima de 0,5%.`],
    ['FLAGS', 'O que precisa de olho humano antes de mandar a proposta.'],
    ['', ''],
    ['Sem supply', 'Item sem nenhum provider available no dia fica na lista, sem preço, marcado SEM SUPPLY.'],
    ['Headroom', '(referência oficial − preço ao parceiro) ÷ referência oficial. QA SUSPECT e BLOCKED não calculam.'],
    ['Câmbio', 'fx_overrides da oportunidade vence o câmbio do dia. Divergência acima de 5% aparece em FLAGS.']
  ];
  for (const l of linhas) readme.addRow(l);
  readme.getColumn(1).font = { bold: true };
  readme.getRow(6).font = { bold: true, color: { argb: 'FFB00020' } };

  /* INPUTS */
  const inputs_ = wb.addWorksheet('INPUTS');
  header(inputs_, [
    { key: 'campo', header: 'Campo', width: 26 },
    { key: 'valor', header: 'Valor', width: 40 },
    { key: 'obs', header: 'Observação', width: 60 }
  ]);
  inputs_.addRow({ campo: 'Markup padrão', valor: inputs.markupPct.mul(100).toNumber(2) + '%', obs: 'Item com custom_markup_pct usa o próprio' });
  inputs_.addRow({ campo: 'Fee fixo (USD)', valor: inputs.feeFixedUsd.toNumber(4), obs: 'Somado depois do markup' });
  inputs_.addRow({ campo: 'Mercados', valor: (inputs.markets || []).join(', '), obs: 'com_opportunities.markets' });
  inputs_.addRow({ campo: 'Snapshot', valor: pricing.date, obs: 'com_supply_snapshots' });
  inputs_.addRow({ campo: 'Snapshot anterior', valor: pricing.previousDate || '—', obs: 'base do DELTA' });
  inputs_.addRow({ campo: '', valor: '', obs: '' });
  inputs_.addRow({ campo: 'CÂMBIO', valor: 'unidades por 1 USD', obs: 'override da oportunidade vence o do dia' });
  const pares = new Set([...Object.keys(inputs.fxRates || {}), ...Object.keys(inputs.fxOverrides || {})]);
  for (const pair of [...pares].sort()) {
    const ov = inputs.fxOverrides ? inputs.fxOverrides[pair] : undefined;
    const dia = inputs.fxRates ? inputs.fxRates[pair] : undefined;
    inputs_.addRow({
      campo: pair,
      valor: Number(ov !== undefined && ov !== null ? ov : dia),
      obs: ov !== undefined && ov !== null
        ? `override da oportunidade${dia !== undefined ? ` (Lapak no dia: ${dia})` : ''}`
        : 'Lapak no dia'
    });
  }

  /* PRICE LIST */
  const price = wb.addWorksheet('PRICE LIST');
  header(price, [
    { key: 'title', header: 'Title', width: 20 },
    { key: 'item', header: 'Item', width: 28 },
    { key: 'mode', header: 'Mode', width: 9 },
    { key: 'group', header: 'Group', width: 20 },
    { key: 'sku', header: 'Best SKU (provider)', width: 26 },
    { key: 'country', header: 'Country', width: 9 },
    { key: 'providers', header: 'SKUs seen', width: 10 },
    { key: 'costIdr', header: 'Cost IDR', width: 12, numFmt: FMT_IDR },
    { key: 'costUsd', header: 'Cost USD', width: 11, numFmt: FMT_USD4 },
    { key: 'markup', header: 'Markup', width: 9, numFmt: FMT_PCT },
    { key: 'fee', header: 'Fee USD', width: 9, numFmt: FMT_USD4 },
    { key: 'partner', header: 'Partner Price USD', width: 18, numFmt: FMT_USD4 },
    { key: 'refMarket', header: 'Ref. market', width: 12 },
    { key: 'official', header: 'Official', width: 12 },
    { key: 'currency', header: 'Currency', width: 10 },
    { key: 'officialUsd', header: 'Official USD', width: 13, numFmt: FMT_USD2 },
    { key: 'qa', header: 'QA', width: 10 },
    { key: 'headroom', header: 'Headroom', width: 11, numFmt: FMT_PCT },
    { key: 'marketsOk', header: 'Markets', width: 14 },
    { key: 'marketsOut', header: 'Not eligible', width: 14 },
    { key: 'status', header: 'Status', width: 44 }
  ]);
  for (const r of pricing.rows) {
    const row = price.addRow({
      title: r.title, item: r.item, mode: MODE_LABEL[r.mode] || r.mode, group: r.group,
      sku: r.bestSku || EMPTY, country: r.bestCountry || EMPTY, providers: r.providersSeen,
      costIdr: r.costIdr === null ? EMPTY : r.costIdr,
      costUsd: r.costUsd ? r.costUsd.toNumber(4) : EMPTY,
      markup: r.markupPct.toNumber(6),
      fee: r.feeUsd.toNumber(4),
      partner: r.partnerUsd ? r.partnerUsd.toNumber(4) : EMPTY,
      refMarket: r.reference ? r.reference.market : EMPTY,
      official: r.reference && r.reference.price !== null ? Number(r.reference.price) : EMPTY,
      currency: r.reference ? r.reference.currency || EMPTY : EMPTY,
      officialUsd: r.reference && r.reference.usd ? r.reference.usd.toNumber(2) : EMPTY,
      qa: r.reference ? r.reference.qa : EMPTY,
      headroom: r.headroomPct ? r.headroomPct.toNumber(6) : EMPTY,
      marketsOk: r.eligibleMarkets.join('/'),
      marketsOut: r.ineligibleMarkets.join('/') || EMPTY,
      status: r.blocked ? r.blockReason : (r.headroomReason || 'OK')
    });
    if (r.blocked) row.font = { color: { argb: 'FFB00020' } };
    else if (r.headroomPct && r.headroomPct.isNegative()) row.font = { color: { argb: 'FFB00020' } };
  }

  /* MULTI-MARKET, só quando há o que mostrar */
  if (pricing.marketRows.length) {
    const multi = wb.addWorksheet('MULTI-MARKET');
    header(multi, [
      { key: 'title', header: 'Title', width: 20 },
      { key: 'item', header: 'Item', width: 28 },
      { key: 'group', header: 'Group', width: 20 },
      { key: 'market', header: 'Market', width: 9 },
      { key: 'from', header: 'Benchmark from', width: 15 },
      { key: 'official', header: 'Official', width: 12 },
      { key: 'currency', header: 'Currency', width: 10 },
      { key: 'officialUsd', header: 'Official USD', width: 13, numFmt: FMT_USD2 },
      { key: 'partner', header: 'Partner Price USD', width: 18, numFmt: FMT_USD4 },
      { key: 'headroom', header: 'Headroom', width: 11, numFmt: FMT_PCT },
      { key: 'obs', header: 'Observação', width: 34 }
    ]);
    for (const m of pricing.marketRows) {
      multi.addRow({
        title: m.title, item: m.item, group: m.group, market: m.market, from: m.benchmarkFrom,
        official: m.official === null ? EMPTY : Number(m.official), currency: m.currency || EMPTY,
        officialUsd: m.officialUsd ? m.officialUsd.toNumber(2) : EMPTY,
        partner: m.partnerUsd ? m.partnerUsd.toNumber(4) : EMPTY,
        headroom: m.headroomPct ? m.headroomPct.toNumber(6) : EMPTY,
        obs: m.reason || ''
      });
    }
  }

  /* DELTA */
  const delta = wb.addWorksheet('DELTA');
  header(delta, [
    { key: 'group', header: 'Group', width: 20 },
    { key: 'title', header: 'Title', width: 20 },
    { key: 'item', header: 'Item', width: 28 },
    { key: 'kind', header: 'O que houve', width: 12 },
    { key: 'before', header: 'Antes IDR', width: 13, numFmt: FMT_IDR },
    { key: 'now', header: 'Agora IDR', width: 13, numFmt: FMT_IDR },
    { key: 'pct', header: 'Variação', width: 11, numFmt: FMT_PCT },
    { key: 'beforeUsd', header: 'Antes USD', width: 12, numFmt: FMT_USD4 },
    { key: 'nowUsd', header: 'Agora USD', width: 12, numFmt: FMT_USD4 }
  ]);
  if (!pricing.previousDate) {
    delta.addRow({ group: '—', title: 'Sem snapshot anterior para comparar', item: '', kind: '' });
  }
  for (const d of pricing.delta) {
    delta.addRow({
      group: d.group, title: d.title, item: d.item, kind: d.kind,
      before: d.before === null ? EMPTY : d.before,
      now: d.now === null ? EMPTY : d.now,
      pct: d.pct ? d.pct.toNumber(6) : EMPTY,
      beforeUsd: d.beforeUsd ? d.beforeUsd.toNumber(4) : EMPTY,
      nowUsd: d.nowUsd ? d.nowUsd.toNumber(4) : EMPTY
    });
  }

  /* FLAGS */
  const flags = wb.addWorksheet('FLAGS');
  header(flags, [
    { key: 'type', header: 'Tipo', width: 26 },
    { key: 'group', header: 'Group', width: 20 },
    { key: 'detail', header: 'Detalhe', width: 90 }
  ]);
  for (const f of pricing.flags) flags.addRow({ type: f.type, group: f.group || '', detail: f.detail });
  for (const e of pricing.excluded) {
    flags.addRow({ type: 'fora_da_cotacao', group: e.group, detail: `${e.title} — ${e.item}: sem DE>PARA em nenhum mercado da oportunidade` });
  }
  if (!pricing.flags.length && !pricing.excluded.length) flags.addRow({ type: 'nenhuma', group: '', detail: 'Nada precisou de olho humano nesta execução.' });

  await wb.xlsx.writeFile(filePath);
  return filePath;
}
