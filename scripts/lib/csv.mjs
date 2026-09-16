/* ──────────────────────────────────────────────────────────────────────────
   csv.mjs — CSV nos dois dialetos que aparecem na prática

   O padrão do projeto é vírgula + ponto decimal. Só que a pesquisa de
   benchmark é feita no Excel, e Excel em português exporta com PONTO E
   VÍRGULA + VÍRGULA DECIMAL. Um arquivo desses lido como vírgula vira
   uma coluna só, e "13900,00" lido como ponto decimal vira duas colunas.
   Nos dois casos o erro aparece longe da causa.

   DETECÇÃO PELO CABEÇALHO: conta ';' e ',' na primeira linha e escolhe o
   separador que aparece mais. O cabeçalho é de nomes de coluna conhecidos,
   sem número e sem texto livre, então é a linha mais confiável do arquivo.
   ────────────────────────────────────────────────────────────────────── */

export function detectDialect(text) {
  const firstLine = String(text).split(/\r?\n/, 1)[0] || '';
  const semis = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semis > commas
    ? { delimiter: ';', decimal: ',', name: 'ponto e vírgula + vírgula decimal (Excel pt-BR)' }
    : { delimiter: ',', decimal: '.', name: 'vírgula + ponto decimal' };
}

/* Parser com aspas: "a,b" fica inteiro e "" vira uma aspa. */
export function parseCsv(text, dialect = null) {
  const d = dialect || detectDialect(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text).replace(/^﻿/, '');   // BOM do Excel

  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === d.delimiter) { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const nonEmpty = rows.filter((r) => r.some((v) => String(v).trim() !== ''));
  if (!nonEmpty.length) return { dialect: d, header: [], rows: [] };

  const header = nonEmpty[0].map((h) => h.trim());
  const out = nonEmpty.slice(1).map((r, idx) => {
    const obj = { __line: idx + 2 };
    header.forEach((h, i) => { obj[h] = (r[i] === undefined ? '' : String(r[i]).trim()); });
    return obj;
  });
  return { dialect: d, header, rows: out };
}

/* "13900,00" no dialeto pt-BR e "13900.00" no padrão viram "13900.00".
   Separador de milhar NÃO é aceito: "1.234,56" e "1,234.56" são ambíguos
   o bastante para merecer uma recusa em vez de um palpite. */
export function parseDecimal(raw, dialect) {
  const s = String(raw ?? '').trim();
  if (s === '') return { value: null, error: null };
  const normalized = dialect.decimal === ',' ? s.replace(',', '.') : s;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return { value: null, error: `"${s}" não é número no dialeto ${dialect.decimal === ',' ? 'pt-BR' : 'padrão'}` };
  }
  return { value: normalized, error: null };
}

export function formatCsv(header, rows, dialect = { delimiter: ',', decimal: '.' }) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /["\n\r]/.test(s) || s.includes(dialect.delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.map(esc).join(dialect.delimiter)];
  for (const r of rows) lines.push(header.map((h) => esc(r[h])).join(dialect.delimiter));
  return lines.join('\n') + '\n';
}
