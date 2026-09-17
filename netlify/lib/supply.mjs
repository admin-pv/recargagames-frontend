/* ──────────────────────────────────────────────────────────────────────────
   supply.mjs — núcleo do snapshot diário de custo Lapak (Motor Comercial)

   Usado por netlify/functions/supply-snapshot.mjs (Scheduled, diária) e,
   enquanto durar o C2, pelo disparador manual supply-snapshot-run.mjs.
   Mora em netlify/lib/ pelo mesmo motivo de catalog.mjs: não virar Function
   própria e não ganhar rota pública.

   O QUE FAZ, na ordem:
     1. /all-products de cada país de SNAPSHOT_COUNTRIES, via /gateway;
     2. grava em com_supply_snapshots o custo do dia (ver "O QUE GRAVA");
     3. grava o câmbio do dia em com_fx_rates;
     4. apaga snapshot velho: 14 dias corridos inteiros, e as segundas
        guardadas por 12 meses só com os grupos que a gente cota.

   ── O QUE GRAVA: SÓ status = "available" ────────────────────────────────
   Medido na API em 16/09: 40.557 produtos/dia nos 9 países, dos quais
   8.616 available. Gravar tudo custa ~7,7 MB/dia com índice — 30 dias já
   seriam ~230 MB de um banco Free de 500 MB que ainda guarda a loja.
   Só o available custa ~4,1 MB/dia com os 11 países (medido em 16/09:
   21.329 linhas). Com a retenção de 14 dias + segundas filtradas, o
   regime estável fica em ~60 MB.

   Não se perde nada do que o pricing precisa: a regra de custo é "menor
   preço entre providers com status available", e grupo que não tem
   nenhuma linha no dia É o "SEM SUPPLY" da v5 — a ausência já é o sinal.
   O que se perde é o histórico de "existia, mas estava empty", que não
   entra em nenhum cálculo. A coluna status continua na tabela: se um dia
   valer a pena guardar empty, muda esta constante e nada mais.

   ── LOG ────────────────────────────────────────────────────────────────
   Contagem e país, nada mais. Custo de atacado é dado sensível e log de
   Netlify não é cofre: nenhum preço, nenhum product_code individual.

   ── ENV ────────────────────────────────────────────────────────────────
   SUPABASE_URL, STOREFRONT_SECRET_KEY, PROXY_URL, LAPAK_ENV,
   PROXY_ADMIN_KEY (só o /fx-rate.php precisa dela), SNAPSHOT_COUNTRIES.
   ────────────────────────────────────────────────────────────────────── */

/* Só isto é gravado. Ver "O QUE GRAVA" acima antes de mexer. */
const STORED_STATUS = 'available';

/* Medido em 16/09: /all-products devolve de 81 (in) a 13.056 (ph) produtos,
   2,6 MB e ~4,5 s por país. Três em paralelo mantém a memória em faixa
   segura e o total em ~15 s. */
const COUNTRY_CONCURRENCY = 3;
const PROXY_TIMEOUT_MS = 30000;
const SUPABASE_TIMEOUT_MS = 15000;
const UPSERT_CHUNK = 500;

/* ── Retenção (decidida com número real em 17/09) ────────────────────────
   14 dias corridos COMPLETOS, e as segundas-feiras guardadas por 12 meses
   SÓ com os grupos que estão em com_sku_markets.

   Por que não os 30 dias + segundas inteiras do brief: o volume real é de
   21.329 linhas/dia (o `id` sozinho é 12.556 delas), e dos 54 grupos da
   Plusmo o dia inteiro produz 165 linhas — 0,8%. A segunda preservada
   INTEIRA e PARA SEMPRE somava 4,1 MB por semana que nunca saíam: 340 MB
   em regime estável, contra uma régua de 150 MB num plano Free de 500 MB.
   Filtrando a segunda pelos grupos rastreados, o regime estável cai para
   ~60 MB e o histórico longo continua existindo exatamente onde importa:
   nos itens que a gente cota.

   MAX_PRUNE_DATES limita quantas datas uma execução mexe: rotina parada
   por dias converge em alguns dias, em vez de um DELETE gigante numa só.

   MAX_TRACKED_FOR_THINNING é um freio de segurança. Com muitos grupos
   rastreados o `not.in.(...)` viraria uma URL gigante e frágil; passando
   disso, a segunda é preservada INTEIRA. Falha para o lado de guardar
   dado demais, nunca para o lado de apagar o que não devia. */
const RETENTION_DAYS = 14;
const WEEKLY_RETENTION_DAYS = 365;
const MAX_PRUNE_DATES = 10;
const MAX_TRACKED_FOR_THINNING = 400;

/* Câmbio. USD_IDR é obrigatório: sem ele não há custo em dólar e a
   execução falha. Os demais são oportunistas — a Lapak tem ARS, PEN, COP
   e PHP, e NÃO tem BRL, MXN, SGD nem INR (conferido em 16/09). Os que
   faltarem continuam vindo do fx_overrides da oportunidade. */
const FX_BASE = 'USD';
const FX_REQUIRED_QUOTE = 'IDR';
const FX_OPTIONAL_QUOTES = ['ARS', 'PEN', 'COP', 'PHP', 'BRL', 'MXN'];

export class SnapshotError extends Error {
  constructor(reason) {
    super('snapshot_failed');
    this.code = 'snapshot_failed';
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

/* ── Env ───────────────────────────────────────────────────────────────
   PROXY_ADMIN_KEY é obrigatória aqui (ao contrário de catalog.mjs): o
   /fx-rate.php não é rota pública do proxy — responde 401 sem x-proxy-key.
   LAPAK_ENV sem default, mesma razão da Fase 2: câmbio e custo de dev em
   produção passariam despercebidos. */
export function snapshotEnv() {
  const required = ['SUPABASE_URL', 'STOREFRONT_SECRET_KEY', 'PROXY_URL', 'LAPAK_ENV',
                    'PROXY_ADMIN_KEY', 'SNAPSHOT_COUNTRIES'];
  const missing = required.filter((k) => !String(process.env[k] || '').trim());
  if (missing.length) throw new MisconfiguredError(missing);

  const lapakEnv = process.env.LAPAK_ENV.trim().toLowerCase();
  if (lapakEnv !== 'prod' && lapakEnv !== 'dev') throw new MisconfiguredError(['LAPAK_ENV(prod|dev)']);

  const countries = parseCountries(process.env.SNAPSHOT_COUNTRIES);
  if (!countries.length) throw new MisconfiguredError(['SNAPSHOT_COUNTRIES(vazia)']);

  return {
    supabaseUrl: process.env.SUPABASE_URL.trim().replace(/\/+$/, ''),
    secret: process.env.STOREFRONT_SECRET_KEY.trim(),
    proxyUrl: process.env.PROXY_URL.trim().replace(/\/+$/, ''),
    proxyKey: process.env.PROXY_ADMIN_KEY.trim(),
    lapakEnv,
    countries
  };
}

/* "br, ar ,MX,,br" → ['br','ar','mx'] (minúscula, sem vazio, sem repetido). */
export function parseCountries(raw) {
  const seen = new Set();
  return String(raw || '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter((c) => /^[a-z]{2}$/.test(c))
    .filter((c) => (seen.has(c) ? false : (seen.add(c), true)));
}

/* ── Parse do produto ──────────────────────────────────────────────────
   group_product_code e provider_code VÊM DA API — o brief propunha uma
   regex `-S\d+` sobre o código, que estaria errada: 20 dos 71 providers do
   BR não são só dígitos (S110AB2C, S11AUTO, S50A, S98M, S121M…). A regex
   fica como último recurso, para o caso de a Lapak um dia mandar produto
   sem os campos separados.

   Greedy no grupo de propósito: em "BST1000-S1-ph" o grupo é BST1000, e
   num código com dois trechos "-S…" o provider é o último. Grupos com
   underscore (ML40_4, MLGLO78_8) passam intactos.

   SEM o flag `i`, e isso não é detalhe: com ele, "ML40_4-S50A-sg" era
   partido como grupo "ML40_4-S50A" + provider "sg" — o sufixo de país
   casava como provider ("s" + "g"). Código de produto e provider da Lapak
   são MAIÚSCULOS, sufixo de país é minúsculo; é o que separa os dois. */
const CODE_FALLBACK_RE = /^(.+)-(S[0-9A-Z]+)(?:-([a-z]{2}))?$/;

export function parseProduct(p, queryCountry) {
  if (!p || typeof p !== 'object') return null;
  const code = String(p.code || '').trim();
  if (!code) return null;

  let group = String(p.group_product_code || '').trim();
  let provider = String(p.provider_code || '').trim();

  if (!group || !provider) {
    const m = CODE_FALLBACK_RE.exec(code);
    if (!m) return null;
    group = group || m[1];
    provider = provider || m[2];
  }

  const price = p.price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return null;

  return {
    query_country: queryCountry,
    product_code: code,
    group_code: group,
    provider_code: provider,
    price_idr: Math.round(price),
    status: String(p.status || '').trim(),
    category_code: String(p.category_code || '').trim() || null
  };
}

/* Linhas de um país, já filtradas e sem repetição de PK.

   A deduplicação não é zelo: o upsert do PostgREST manda tudo num INSERT
   ... ON CONFLICT só, e o Postgres recusa o lote inteiro (21000) se a
   mesma chave aparecer duas vezes. Empate no mesmo product_code fica com
   o menor preço, que é a regra de custo do motor. */
export function rowsFromProducts(products, queryCountry) {
  const byCode = new Map();
  let skipped = 0;
  let duplicates = 0;

  for (const p of Array.isArray(products) ? products : []) {
    const row = parseProduct(p, queryCountry);
    if (!row) { skipped += 1; continue; }
    if (row.status !== STORED_STATUS) continue;

    const previous = byCode.get(row.product_code);
    if (previous) {
      duplicates += 1;
      if (row.price_idr < previous.price_idr) byCode.set(row.product_code, row);
    } else {
      byCode.set(row.product_code, row);
    }
  }

  return { rows: [...byCode.values()], skipped, duplicates };
}

/* ── Datas ─────────────────────────────────────────────────────────────
   Tudo em UTC: a Function roda agendada em UTC e o `date` do Postgres não
   tem fuso. snapshot_date é o dia UTC em que a foto foi tirada. */
export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export function addDays(isoStr, days) {
  const d = new Date(`${isoStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export function isMonday(isoStr) {
  return new Date(`${isoStr}T00:00:00Z`).getUTCDay() === 1;
}

/* ── Rede ──────────────────────────────────────────────────────────────── */

/* O proxy embrulha a Lapak: { status, ok, data: { code, data } }. */
async function gatewayGet(cfg, endpoint, payload, { authenticated = false } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'x-env': cfg.lapakEnv };
  /* x-proxy-key é o header que o proxy espera (server.js, authState).
     Só as rotas fora de /category, /product e /all-products precisam. */
  if (authenticated) headers['x-proxy-key'] = cfg.proxyKey;

  let res;
  try {
    res = await fetch(`${cfg.proxyUrl}/gateway`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ endpoint, method: 'GET', payload }),
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS)
    });
  } catch (e) {
    throw new SnapshotError(`proxy_${endpoint}_${e.name}`);
  }
  if (!res.ok) throw new SnapshotError(`proxy_${endpoint}_http_${res.status}`);

  const body = await res.json().catch(() => null);
  if (!body || body.ok !== true || !body.data || body.data.code !== 'SUCCESS' || !body.data.data) {
    const code = body && body.data ? body.data.code : 'shape';
    const err = new SnapshotError(`lapak_${endpoint}_${code}`);
    err.lapakCode = code;
    throw err;
  }
  return body.data.data;
}

async function supabase(cfg, method, path, { body, prefer } = {}) {
  const headers = {
    apikey: cfg.secret,
    Authorization: `Bearer ${cfg.secret}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;

  let res;
  try {
    res = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS)
    });
  } catch (e) {
    throw new SnapshotError(`supabase_${e.name}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let sqlstate = '';
    try { const b = JSON.parse(text); if (b && b.code) sqlstate = ` sqlstate=${String(b.code).slice(0, 12)}`; } catch { /* corpo não-JSON */ }
    throw new SnapshotError(`supabase_http_${res.status}${sqlstate}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function upsertChunks(cfg, table, conflict, rows) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    await supabase(cfg, 'POST', `${table}?on_conflict=${conflict}`, {
      body: rows.slice(i, i + UPSERT_CHUNK),
      prefer: 'resolution=merge-duplicates,return=minimal'
    });
  }
}

/* ── Passo 1 e 2: custo do dia ─────────────────────────────────────────
   Um país que falhar NÃO derruba os outros: a foto de 8 países é melhor
   que nenhuma, e a linha do país que falhou simplesmente não existe no
   dia (o gerador trata ausência como SEM SUPPLY e a planilha mostra).
   O relatório diz quem falhou, e o resultado geral é "degraded". */
export async function snapshotCountries(cfg, snapshotDate) {
  const queue = [...cfg.countries];
  const byCountry = [];
  const failed = [];

  async function worker() {
    for (;;) {
      const country = queue.shift();
      if (!country) return;
      try {
        const data = await gatewayGet(cfg, '/all-products', { country_code: country });
        const products = Array.isArray(data.products) ? data.products : null;
        if (!products) throw new SnapshotError(`lapak_shape_${country}`);

        const { rows, skipped, duplicates } = rowsFromProducts(products, country);
        const dated = rows.map((r) => ({ snapshot_date: snapshotDate, ...r }));
        await upsertChunks(cfg, 'com_supply_snapshots',
          'snapshot_date,query_country,product_code', dated);

        byCountry.push({ country, seen: products.length, stored: rows.length, skipped, duplicates });
      } catch (e) {
        failed.push({ country, reason: e.reason || e.code || e.name });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(COUNTRY_CONCURRENCY, cfg.countries.length) }, worker));

  byCountry.sort((a, b) => a.country.localeCompare(b.country));
  failed.sort((a, b) => a.country.localeCompare(b.country));
  return { byCountry, failed, stored: byCountry.reduce((n, c) => n + c.stored, 0) };
}

/* ── Passo 3: câmbio ───────────────────────────────────────────────────
   Guarda pair = 'USD_XXX' e rate = unidades de XXX por 1 USD (a convenção
   da migration 0004 e do fx_overrides). Custo USD = price_idr / rate.

   buy_rate e sell_rate vinham iguais em 16/09 (17663). Quando divergirem,
   fica o MENOR: divisor menor = custo em dólar maior = proposta
   conservadora. Errar para o lado de cotar mais caro é recuperável;
   errar para baixo come margem sem ninguém ver.

   rate_date é a data do snapshot, não o created_date da Lapak: é a data
   com que o gerador casa custo e câmbio. O created_date entra no `source`
   para conferência. */
export async function snapshotFx(cfg, snapshotDate) {
  const rows = [];
  const missing = [];

  const quotes = [FX_REQUIRED_QUOTE, ...FX_OPTIONAL_QUOTES];
  for (const quote of quotes) {
    let data;
    try {
      data = await gatewayGet(cfg, '/fx-rate.php',
        { from_currency: FX_BASE, to_currency: quote }, { authenticated: true });
    } catch (e) {
      if (quote === FX_REQUIRED_QUOTE) throw e;
      missing.push(quote);
      continue;
    }

    const candidates = [data.buy_rate, data.sell_rate]
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!candidates.length) {
      if (quote === FX_REQUIRED_QUOTE) throw new SnapshotError('fx_rate_invalid_IDR');
      missing.push(quote);
      continue;
    }

    rows.push({
      rate_date: snapshotDate,
      pair: `${FX_BASE}_${quote}`,
      rate: Math.min(...candidates),
      source: data.created_date ? `lapak:${String(data.created_date).slice(0, 19)}` : 'lapak'
    });
  }

  await upsertChunks(cfg, 'com_fx_rates', 'rate_date,pair', rows);
  return { stored: rows.map((r) => r.pair), missing };
}

/* ── Passo 4: retenção ─────────────────────────────────────────────────
   Duas operações, nesta ordem:

     a) tudo que passou de 12 meses sai inteiro. Um DELETE só, por faixa:
        pega inclusive as segundas já filtradas, que não têm mais nenhuma
        linha "não rastreada" e por isso nunca apareceriam na varredura de
        baixo;

     b) varredura das datas fora da janela de 14 dias que AINDA TÊM linha
        de grupo não rastreado. Não-segunda sai inteira; segunda perde só
        o que não é rastreado.

   A CONSULTA DE (b) É O PULO DO GATO, e o desenho óbvio não funciona:
   varrer "a data mais velha fora da janela" e pular as segundas faz a
   varredura reencontrar as mesmas 52 segundas todo santo dia, gastar o
   orçamento de 10 datas nelas e NUNCA chegar na data nova que acabou de
   vencer — a janela cresceria para sempre, calada. Perguntando pela data
   mais velha QUE AINDA TEM LINHA NÃO RASTREADA, a segunda já filtrada
   some sozinha do resultado e cada execução cai em regime numa iteração.

   com_fx_rates não é podada: são ~7 linhas por dia, o histórico inteiro
   cabe em nada, e é o que permite reconferir uma proposta antiga. */
export async function pruneSnapshots(cfg, snapshotDate) {
  const cutoff = addDays(snapshotDate, -RETENTION_DAYS);
  const weeklyCutoff = addDays(snapshotDate, -WEEKLY_RETENTION_DAYS);
  const deleted = [];
  const thinned = [];

  /* (a) 12 meses */
  await supabase(cfg, 'DELETE', `com_supply_snapshots?snapshot_date=lt.${weeklyCutoff}`, { prefer: 'return=minimal' });

  /* Grupos rastreados = o DE>PARA do operador. Lista vazia seria uma
     configuração quebrada, e com ela o not.in.() apagaria a segunda
     inteira: nesse caso não filtra nada e avisa. */
  const tracked = await fetchTrackedGroups(cfg);
  const canThin = tracked.length > 0 && tracked.length <= MAX_TRACKED_FOR_THINNING;
  const untrackedFilter = canThin
    ? `group_code=not.in.(${tracked.map((g) => `"${String(g).replace(/"/g, '""')}"`).join(',')})`
    : null;

  /* (b) varredura.

     O cursor `after` só serve para o caso do freio: sem filtro de grupo,
     a segunda preservada continuaria aparecendo como "a mais velha" a
     cada volta e travaria o laço nela. Com o filtro ligado ele é
     desnecessário — a segunda filtrada some sozinha do resultado — mas
     fica, porque não custa nada e o laço não pode depender de qual dos
     dois caminhos está ativo. */
  let after = null;
  for (let i = 0; i < MAX_PRUNE_DATES; i += 1) {
    const filters = [`snapshot_date=lt.${cutoff}`];
    if (after) filters.push(`snapshot_date=gt.${after}`);
    if (untrackedFilter) filters.push(untrackedFilter);
    const found = await supabase(cfg, 'GET',
      `com_supply_snapshots?select=snapshot_date&${filters.join('&')}&order=snapshot_date.asc&limit=1`);

    const date = Array.isArray(found) && found.length ? found[0].snapshot_date : null;
    if (!date) break;

    if (isMonday(date)) {
      if (!untrackedFilter) {
        /* Freio ligado: a segunda fica INTEIRA. Apagá-la aqui seria
           exatamente o dado histórico que a regra existe para guardar. */
        after = date;
        continue;
      }
      await supabase(cfg, 'DELETE', `com_supply_snapshots?snapshot_date=eq.${date}&${untrackedFilter}`, { prefer: 'return=minimal' });
      thinned.push(date);
    } else {
      await supabase(cfg, 'DELETE', `com_supply_snapshots?snapshot_date=eq.${date}`, { prefer: 'return=minimal' });
      deleted.push(date);
    }
  }

  return { cutoff, weeklyCutoff, deleted, thinned, tracked: tracked.length, thinning: canThin };
}

/* Grupos do DE>PARA, sem repetição. Hoje são 54; o limite de 1000 do
   PostgREST cobre com folga e o freio de MAX_TRACKED_FOR_THINNING entra
   muito antes disso. */
async function fetchTrackedGroups(cfg) {
  const rows = await supabase(cfg, 'GET', 'com_sku_markets?select=group_code&limit=1000');
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => r.group_code).filter(Boolean))];
}

/* ── Orquestração ──────────────────────────────────────────────────────
   Ordem importa: custo e câmbio primeiro (é o que a proposta precisa), a
   limpeza por último — se ela falhar, o dia já está gravado e a próxima
   execução limpa. O FX vem depois do custo pelo mesmo motivo: uma falha
   de câmbio não pode apagar a foto de custo que já subiu. */
export async function runSnapshot({ now = new Date() } = {}) {
  const cfg = snapshotEnv();
  const snapshotDate = isoDate(now);
  const startedAt = Date.now();

  const supply = await snapshotCountries(cfg, snapshotDate);

  let fx = null;
  let fxError = null;
  try {
    fx = await snapshotFx(cfg, snapshotDate);
  } catch (e) {
    fxError = e.reason || e.code || e.name;
  }

  let prune = null;
  let pruneError = null;
  try {
    prune = await pruneSnapshots(cfg, snapshotDate);
  } catch (e) {
    pruneError = e.reason || e.code || e.name;
  }

  return {
    snapshotDate,
    countries: supply.byCountry,
    failedCountries: supply.failed,
    stored: supply.stored,
    fx,
    fxError,
    prune,
    pruneError,
    elapsedMs: Date.now() - startedAt,
    ok: supply.failed.length === 0 && !fxError && !pruneError
  };
}

/* Só contagem e país. Nenhum preço, nenhum product_code. */
export function logSnapshot(tag, r) {
  console.log('%s: date=%s stored=%d countries=%s elapsed_ms=%d', tag, r.snapshotDate, r.stored,
    r.countries.map((c) => `${c.country}:${c.stored}/${c.seen}`).join(' '), r.elapsedMs);
  if (r.failedCountries.length) {
    console.error('%s: countries_failed=%s', tag,
      r.failedCountries.map((c) => `${c.country}(${c.reason})`).join(' '));
  }
  if (r.fx) {
    console.log('%s: fx_stored=%s fx_missing=%s', tag,
      r.fx.stored.join(',') || '-', r.fx.missing.join(',') || '-');
  }
  if (r.fxError) console.error('%s: fx_failed reason=%s', tag, r.fxError);
  if (r.prune) {
    console.log('%s: prune cutoff=%s deleted=%s thinned=%s tracked=%d%s', tag, r.prune.cutoff,
      r.prune.deleted.join(',') || '-', r.prune.thinned.join(',') || '-', r.prune.tracked,
      r.prune.thinning ? '' : ' THINNING_OFF');
    if (!r.prune.thinning) {
      console.warn('%s: segundas preservadas INTEIRAS — com_sku_markets tem %d grupos (vazio ou acima do limite)', tag, r.prune.tracked);
    }
  }
  if (r.pruneError) console.error('%s: prune_failed reason=%s', tag, r.pruneError);
}
