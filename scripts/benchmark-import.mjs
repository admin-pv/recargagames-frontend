#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────────
   benchmark-import.mjs — mantém com_benchmarks por CSV

     node scripts/benchmark-import.mjs export
     node scripts/benchmark-import.mjs import <arquivo.csv> [--dry-run]

   FLUXO PADRÃO: export → edita no Excel → import --dry-run → confere →
   import. O --dry-run mostra o diff e NÃO escreve nada.

   Aceita os dois dialetos de CSV (vírgula/ponto e ponto-e-vírgula/vírgula
   decimal, este último o que o Excel pt-BR exporta), detectando pelo
   cabeçalho. O export sai sempre no padrão vírgula + ponto.

   Linha inválida é bloqueada e reportada; o resto do arquivo entra.
   ────────────────────────────────────────────────────────────────────── */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { OUT_DIR } from './lib/env.mjs';
import { fetchAllBenchmarks, fetchLatestSnapshotDate, fetchKnownGroups, upsertBenchmarks } from './lib/db.mjs';
import { parseCsv, formatCsv, detectDialect } from './lib/csv.mjs';
import { CSV_HEADER, validateRow, diffRows, dedupe } from './lib/benchmark.mjs';

function uso(code = 2) {
  console.error('Uso:\n  node scripts/benchmark-import.mjs export\n  node scripts/benchmark-import.mjs import <arquivo.csv> [--dry-run]');
  process.exit(code);
}

async function exportar() {
  const rows = await fetchAllBenchmarks();
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, 'benchmarks.csv');
  writeFileSync(file, formatCsv(CSV_HEADER, rows.map((r) => ({
    group_code: r.group_code, market: r.market,
    official_price: r.official_price === null ? '' : r.official_price,
    currency: r.currency || '', qa_status: r.qa_status,
    note: r.note || '', collected_at: r.collected_at || ''
  }))), 'utf8');
  console.log(`\n${rows.length} benchmarks → ${file}`);
  console.log('Edita no Excel e roda: node scripts/benchmark-import.mjs import out/benchmarks.csv --dry-run\n');
}

async function importar(file, { dryRun }) {
  const text = readFileSync(file, 'utf8');
  const dialect = detectDialect(text);
  const { header, rows } = parseCsv(text, dialect);

  const faltando = CSV_HEADER.filter((h) => !header.includes(h) && h !== 'note');
  if (faltando.length) throw new Error(`Cabeçalho sem as colunas: ${faltando.join(', ')}. Esperado: ${CSV_HEADER.join(', ')}`);

  const today = new Date().toISOString().slice(0, 10);
  const snapshotDate = await fetchLatestSnapshotDate();
  const knownGroups = await fetchKnownGroups(snapshotDate);
  const current = await fetchAllBenchmarks();

  const validas = [];
  const invalidas = [];
  for (const raw of rows) {
    const r = validateRow(raw, { knownGroups, dialect, today });
    (r.ok ? validas : invalidas).push(r);
  }
  const { rows: unicas, duplicadas } = dedupe(validas);
  const { novo, alterado, igual } = diffRows(unicas.map((v) => v.row), current);

  console.log(`\nArquivo : ${file}`);
  console.log(`Dialeto : ${dialect.name}`);
  console.log(`Linhas  : ${rows.length} (${validas.length} válidas, ${invalidas.length} bloqueadas)`);
  console.log(`Grupos conhecidos conferidos contra o snapshot de ${snapshotDate || '—'} + com_sku_markets\n`);

  if (novo.length) {
    console.log(`NOVOS (${novo.length}):`);
    for (const n of novo) console.log(`  + ${n.row.group_code} ${n.row.market}  ${fmtPreco(n.row)}  ${n.row.qa_status}`);
  }
  if (alterado.length) {
    console.log(`\nALTERADOS (${alterado.length}):`);
    for (const a of alterado) {
      console.log(`  ~ ${a.row.group_code} ${a.row.market}`);
      for (const c of a.changes) console.log(`      ${c.field}: ${fmtVal(c.before)} → ${fmtVal(c.after)}`);
    }
  }
  if (igual.length) console.log(`\nSEM MUDANÇA: ${igual.length}`);
  if (duplicadas.length) {
    console.log(`\nREPETIDAS no arquivo (vence a última): ${duplicadas.length}`);
    for (const d of duplicadas) console.log(`  = ${d.key} (linha ${d.line})`);
  }
  if (invalidas.length) {
    console.log(`\nBLOQUEADAS (${invalidas.length}) — não entram, o resto do arquivo segue:`);
    for (const i of invalidas) console.log(`  x linha ${i.line} ${i.group || '?'} ${i.market || ''}: ${i.errors.join('; ')}`);
  }

  if (dryRun) {
    console.log(`\n--dry-run: nada foi escrito. ${novo.length + alterado.length} linha(s) entrariam.\n`);
    return invalidas.length ? 1 : 0;
  }

  const paraEscrever = [...novo, ...alterado].map((x) => x.row);
  if (!paraEscrever.length) {
    console.log('\nNada a escrever.\n');
    return invalidas.length ? 1 : 0;
  }
  await upsertBenchmarks(paraEscrever);
  console.log(`\nGravadas ${paraEscrever.length} linha(s) em com_benchmarks.\n`);
  return invalidas.length ? 1 : 0;
}

function fmtPreco(r) { return r.official_price === null ? '(sem preço)' : `${r.official_price} ${r.currency}`; }
function fmtVal(v) { return v === null || v === undefined || v === '' ? '(vazio)' : String(v); }

const [, , cmd, ...rest] = process.argv;
const dryRun = rest.includes('--dry-run');
const file = rest.find((a) => !a.startsWith('--'));

try {
  if (cmd === 'export') { await exportar(); process.exit(0); }
  else if (cmd === 'import') {
    if (!file) uso();
    process.exit(await importar(file, { dryRun }));
  } else uso();
} catch (e) {
  console.error(`\nFalhou: ${e.message}\n`);
  process.exit(1);
}
