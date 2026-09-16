/* ──────────────────────────────────────────────────────────────────────────
   db.mjs — leitura do motor comercial no Supabase (PostgREST)

   Só LÊ. Escrita existe num lugar só, no benchmark-import, e é upsert de
   com_benchmarks. Nenhuma função aqui toca em tabela da loja.

   PAGINAÇÃO: o PostgREST corta em 1000 linhas por resposta e não avisa —
   devolve 1000 e pronto. Um snapshot de 54 grupos x ~10 providers x 11
   países passa disso com folga, e o corte silencioso viraria "SEM SUPPLY"
   em item que tem supply. Por isso toda leitura de lista é paginada até
   voltar menos que a página.
   ────────────────────────────────────────────────────────────────────── */
import { loadEnv } from './env.mjs';

const PAGE = 1000;
const TIMEOUT_MS = 30000;

let cfg = null;
function config() { if (!cfg) cfg = loadEnv(); return cfg; }

async function get(pathAndQuery) {
  const { url, key } = config();
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status} em ${pathAndQuery.split('?')[0]}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function getAll(pathAndQuery) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const sep = pathAndQuery.includes('?') ? '&' : '?';
    const page = await get(`${pathAndQuery}${sep}limit=${PAGE}&offset=${offset}`);
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/* group_code é [A-Z0-9_], mas a lista vai encodada do mesmo jeito: um dia
   um código com vírgula quebraria o in.() de um jeito difícil de ver. */
function inList(values) {
  return `in.(${values.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')})`;
}

export async function fetchOpportunity(slug) {
  const rows = await get(`com_opportunities?slug=eq.${encodeURIComponent(slug)}&select=*`);
  if (!rows.length) throw new Error(`Oportunidade "${slug}" não existe em com_opportunities.`);
  return rows[0];
}

export async function fetchItems(opportunityId) {
  return getAll(`com_opportunity_items?opportunity_id=eq.${opportunityId}&select=*&order=title.asc,group_code.asc`);
}

export async function fetchSkuMarkets(groups) {
  if (!groups.length) return [];
  return getAll(`com_sku_markets?group_code=${encodeURIComponent(inList(groups))}&select=*`);
}

export async function fetchBenchmarks(groups) {
  if (!groups.length) return [];
  return getAll(`com_benchmarks?group_code=${encodeURIComponent(inList(groups))}&select=*`);
}

export async function fetchAllBenchmarks() {
  return getAll('com_benchmarks?select=*&order=group_code.asc,market.asc');
}

export async function fetchLatestSnapshotDate() {
  const rows = await get('com_supply_snapshots?select=snapshot_date&order=snapshot_date.desc&limit=1');
  return rows.length ? rows[0].snapshot_date : null;
}

export async function fetchPreviousSnapshotDate(date) {
  const rows = await get(`com_supply_snapshots?select=snapshot_date&snapshot_date=lt.${date}&order=snapshot_date.desc&limit=1`);
  return rows.length ? rows[0].snapshot_date : null;
}

export async function fetchSnapshot(date, groups) {
  if (!date || !groups.length) return [];
  return getAll(
    `com_supply_snapshots?snapshot_date=eq.${date}&group_code=${encodeURIComponent(inList(groups))}` +
    '&select=group_code,product_code,provider_code,price_idr,status,query_country,category_code'
  );
}

export async function fetchFxRates(date) {
  const rows = await getAll(`com_fx_rates?rate_date=eq.${date}&select=pair,rate,source`);
  const map = {};
  for (const r of rows) map[r.pair] = r.rate;
  return { map, rows };
}

/* Grupos conhecidos: o que existe no snapshot mais recente OU no DE>PARA.
   É o universo contra o qual o benchmark-import valida group_code. */
export async function fetchKnownGroups(date) {
  const known = new Set();
  if (date) {
    for (const r of await getAll(`com_supply_snapshots?snapshot_date=eq.${date}&select=group_code`)) known.add(r.group_code);
  }
  for (const r of await getAll('com_sku_markets?select=group_code')) known.add(r.group_code);
  return known;
}

export async function upsertBenchmarks(rows) {
  const { url, key } = config();
  const res = await fetch(`${url}/rest/v1/com_benchmarks?on_conflict=group_code,market`, {
    method: 'POST',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json', Accept: 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status} no upsert de com_benchmarks: ${body.slice(0, 300)}`);
  }
  return rows.length;
}
