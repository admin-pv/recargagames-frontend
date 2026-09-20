#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────────
   opportunity-export.mjs — gera a proposta de uma oportunidade

     node scripts/opportunity-export.mjs <slug> [--date YYYY-MM-DD]

   Sem --date, usa o snapshot mais recente que existir no banco.

   Sai em out/ (gitignored):
     <slug>-pricing-<data>.xlsx   interna: custo, margem, SKU, DELTA, FLAGS
     <slug>-annex-a-<data>.xlsx   parceiro: título, item, modo, preço,
                                  referência, headroom — e mais nada

   O terminal mostra o resumo e as flags. Preço por item fica no arquivo:
   custo de fornecedor não é coisa que se cola num chat sem pensar.
   ────────────────────────────────────────────────────────────────────── */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { OUT_DIR } from './lib/env.mjs';
import {
  fetchOpportunity, fetchItems, fetchSkuMarkets, fetchBenchmarks,
  fetchLatestSnapshotDate, fetchPreviousSnapshotDate, fetchSnapshot, fetchFxRates
} from './lib/db.mjs';
import { buildPricing } from './lib/pricing.mjs';
import { writeInternal, writeAnnex } from './lib/workbook.mjs';

function parseArgs(argv) {
  const args = argv.slice(2);
  const slug = args.find((a) => !a.startsWith('--'));
  const dateIdx = args.indexOf('--date');
  const date = dateIdx >= 0 ? args[dateIdx + 1] : null;
  if (!slug) {
    console.error('Uso: node scripts/opportunity-export.mjs <slug> [--date YYYY-MM-DD]');
    process.exit(2);
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`--date tem que ser YYYY-MM-DD, veio "${date}"`);
    process.exit(2);
  }
  return { slug, date };
}

async function main() {
  const { slug, date: pedida } = parseArgs(process.argv);

  const opportunity = await fetchOpportunity(slug);
  if (opportunity.status !== 'active') {
    console.warn(`Aviso: a oportunidade "${slug}" está com status "${opportunity.status}".`);
  }

  const items = (await fetchItems(opportunity.id)).filter((i) => i.include !== false);
  if (!items.length) throw new Error(`"${slug}" não tem item com include = true.`);
  const groups = [...new Set(items.map((i) => i.group_code))];

  const date = pedida || await fetchLatestSnapshotDate();
  if (!date) throw new Error('com_supply_snapshots está vazia — rode o supply-snapshot antes.');

  const [skuMarkets, benchmarks, snapshot, { map: fxRates, sources: fxSources, rows: fxRows }] = await Promise.all([
    fetchSkuMarkets(groups), fetchBenchmarks(groups), fetchSnapshot(date, groups), fetchFxRates(date)
  ]);

  if (!snapshot.length) {
    throw new Error(`Nenhuma linha de snapshot em ${date} para os ${groups.length} grupos de "${slug}". Data errada, ou o snapshot do dia não rodou.`);
  }
  if (!fxRates.USD_IDR) {
    throw new Error(`Sem câmbio USD_IDR em ${date}. Sem ele não há custo em dólar; confira com_fx_rates.`);
  }

  const previousDate = await fetchPreviousSnapshotDate(date);
  const previousSnapshot = previousDate ? await fetchSnapshot(previousDate, groups) : [];

  const pricing = buildPricing({
    date, previousDate, opportunity, items, skuMarkets, snapshot, previousSnapshot, fxRates, fxSources, benchmarks
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const interna = path.join(OUT_DIR, `${slug}-pricing-${date}.xlsx`);
  const annex = path.join(OUT_DIR, `${slug}-annex-a-${date}.xlsx`);
  await writeInternal(pricing, interna);
  await writeAnnex(pricing, annex);

  const cotados = pricing.rows.filter((r) => !r.blocked).length;
  const semSupply = pricing.rows.length - cotados;
  const comHeadroom = pricing.rows.filter((r) => r.headroomPct).length;

  console.log(`\n${opportunity.name} (${slug}) — snapshot ${date}${previousDate ? `, anterior ${previousDate}` : ' (sem anterior)'}`);
  console.log(`  itens na oportunidade : ${items.length}`);
  console.log(`  cotados               : ${cotados}`);
  console.log(`  SEM SUPPLY            : ${semSupply}`);
  console.log(`  fora da cotação       : ${pricing.excluded.length} (sem DE>PARA)`);
  console.log(`  com headroom          : ${comHeadroom}`);
  console.log(`  DELTA (>0,5%)         : ${pricing.delta.length}`);
  console.log(`  câmbio do dia         : ${fxRows.map((r) => `${r.pair}=${r.rate}`).join(' ') || '—'}`);

  if (pricing.flags.length) {
    const porTipo = pricing.flags.reduce((m, f) => (m[f.type] = (m[f.type] || 0) + 1, m), {});
    console.log(`\n  FLAGS: ${Object.entries(porTipo).map(([t, n]) => `${t}=${n}`).join(' ')}`);
    for (const f of pricing.flags.filter((x) => x.type === 'fx_override_divergente' || x.type === 'fx_desatualizado' || x.type === 'preco_acima_do_oficial')) {
      console.log(`    ! ${f.type} ${f.group || ''} ${f.detail}`);
    }
  }

  console.log(`\n  interna : ${interna}`);
  console.log(`  Annex A : ${annex}\n`);
}

main().catch((e) => {
  console.error(`\nFalhou: ${e.message}\n`);
  process.exit(1);
});
