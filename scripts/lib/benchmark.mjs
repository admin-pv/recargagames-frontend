/* ──────────────────────────────────────────────────────────────────────────
   benchmark.mjs — validação e diff do CSV de benchmarks (puro, testável)

   A manutenção de benchmark é por CSV porque a pesquisa é feita no Excel
   (decisão do Vinicius, 16/09). A tela no admin entra depois da dívida #1
   e vai ler e escrever nesta mesma tabela.

   REGRA DE RECUSA: linha inválida é BLOQUEADA e REPORTADA, e o resto do
   arquivo segue. Abortar o arquivo inteiro por causa de uma linha faria o
   operador perder 20 correções boas por causa de um typo — e o típico erro
   aqui é typo mesmo.
   ────────────────────────────────────────────────────────────────────── */
import { parseDecimal } from './csv.mjs';

export const CSV_HEADER = ['group_code', 'market', 'official_price', 'currency', 'qa_status', 'note', 'collected_at'];
export const QA_STATUSES = new Set(['TRUSTED', 'VERIFY', 'SUSPECT', 'COLLECT', 'BLOCKED']);

/* Extensível de propósito: acrescentar moeda aqui é uma linha, e não
   exige migration (a 0004 só cobra o formato ISO de 3 letras). */
export const KNOWN_CURRENCIES = new Set(['USD', 'ARS', 'MXN', 'PEN', 'BRL', 'COP', 'CLP', 'PHP', 'EUR']);

export function validateRow(raw, { knownGroups, dialect, today }) {
  const errors = [];
  const line = raw.__line;

  const group = String(raw.group_code || '').trim();
  const market = String(raw.market || '').trim().toUpperCase();
  const currency = String(raw.currency || '').trim().toUpperCase();
  const qa = String(raw.qa_status || '').trim().toUpperCase();
  const note = String(raw.note ?? '').trim();
  const collected = String(raw.collected_at || '').trim();

  if (!group) errors.push('group_code vazio');
  /* Grupo desconhecido é quase sempre typo: ele não está no snapshot mais
     recente NEM no DE>PARA. Grupo que só existe no DE>PARA passa — pode
     ser item novo ainda sem supply. */
  else if (knownGroups && knownGroups.size && !knownGroups.has(group)) {
    errors.push(`group_code "${group}" não existe no snapshot mais recente nem em com_sku_markets (typo?)`);
  }

  if (!market) errors.push('market vazio');
  else if (!/^[A-Z]{2,6}$/.test(market)) errors.push(`market "${market}" fora do formato (2 a 6 letras, ou GLOBAL)`);

  if (!QA_STATUSES.has(qa)) errors.push(`qa_status "${raw.qa_status}" fora de ${[...QA_STATUSES].join('/')}`);

  const price = parseDecimal(raw.official_price, dialect);
  if (price.error) errors.push(`official_price: ${price.error}`);

  const temPreco = price.value !== null;
  const temMoeda = currency !== '';
  if (temPreco && Number(price.value) <= 0) errors.push(`official_price "${raw.official_price}" tem que ser maior que zero`);
  if (temMoeda && !KNOWN_CURRENCIES.has(currency)) {
    errors.push(`currency "${currency}" fora da lista conhecida (${[...KNOWN_CURRENCIES].join(', ')})`);
  }
  /* A 0004 tem CHECK ((official_price IS NULL) = (currency IS NULL)):
     deixar passar daqui só adiaria o erro para o meio do upsert, onde ele
     derruba o lote inteiro em vez de uma linha. */
  if (temPreco !== temMoeda) errors.push('preço sem moeda (ou moeda sem preço): os dois juntos, ou nenhum');

  let collectedAt = collected;
  if (!collectedAt) collectedAt = today;
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(collectedAt)) errors.push(`collected_at "${collected}" não é YYYY-MM-DD`);

  if (errors.length) return { ok: false, line, group, market, errors };

  return {
    ok: true, line,
    row: {
      group_code: group, market,
      official_price: temPreco ? price.value : null,
      currency: temMoeda ? currency : null,
      qa_status: qa,
      note: note === '' ? null : note,
      collected_at: collectedAt
    }
  };
}

/* Diff contra o que está no banco. `novo`, `alterado` (com os campos que
   mudaram) e `igual` — é o que o --dry-run mostra antes de escrever. */
export function diffRows(rows, current) {
  const byKey = new Map(current.map((c) => [`${c.group_code}|${c.market}`, c]));
  const novo = [], alterado = [], igual = [];

  for (const r of rows) {
    const key = `${r.group_code}|${r.market}`;
    const before = byKey.get(key);
    if (!before) { novo.push({ row: r }); continue; }

    const mudou = [];
    for (const f of ['official_price', 'currency', 'qa_status', 'note', 'collected_at']) {
      const a = normalize(before[f]);
      const b = normalize(r[f]);
      if (a !== b) mudou.push({ field: f, before: before[f], after: r[f] });
    }
    if (mudou.length) alterado.push({ row: r, changes: mudou });
    else igual.push({ row: r });
  }
  return { novo, alterado, igual };
}

/* numeric do Postgres volta como número; o CSV traz string. Comparar
   "13900.0" com 13900 como texto acusaria mudança que não houve. */
function normalize(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return String(v);
  const s = String(v);
  return /^-?\d+(\.\d+)?$/.test(s) ? String(Number(s)) : s;
}

/* Duas linhas com a mesma (group_code, market) no mesmo arquivo derrubam
   o upsert inteiro no Postgres (21000). Vence a ÚLTIMA, que é o que o
   operador vê ao editar de cima para baixo no Excel. */
export function dedupe(rows) {
  const byKey = new Map();
  const duplicadas = [];
  for (const r of rows) {
    const key = `${r.row.group_code}|${r.row.market}`;
    if (byKey.has(key)) duplicadas.push({ key, line: r.line });
    byKey.set(key, r);
  }
  return { rows: [...byKey.values()], duplicadas };
}
