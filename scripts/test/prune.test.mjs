/* ──────────────────────────────────────────────────────────────────────────
   Retenção: 14 dias inteiros + segundas de 12 meses só com grupo rastreado.

   Roda contra um PostgREST de mentira em memória que entende os filtros
   que o prune usa de verdade (lt, gt, eq, not.in, order, limit). Conferir
   só "chamou DELETE" não provaria a parte que importa: que a varredura
   CONVERGE. O desenho ingênuo reencontra as mesmas segundas todo dia,
   gasta o orçamento nelas e nunca chega na data que acabou de vencer.
   ────────────────────────────────────────────────────────────────────── */
import assert from 'node:assert/strict';
import { test } from './harness.mjs';
import { pruneSnapshots } from '../../netlify/lib/supply.mjs';

const CFG = { supabaseUrl: 'https://fake.supabase.co', secret: 'x' };

function fakeServer({ rows, tracked }) {
  const state = { rows: [...rows], tracked: [...tracked], calls: [] };
  const original = globalThis.fetch;

  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || 'GET';
    const table = u.pathname.split('/').pop();
    const q = u.searchParams;
    state.calls.push(`${method} ${table}${u.search}`);

    if (table === 'com_sku_markets') {
      return new Response(JSON.stringify(state.tracked.map((g) => ({ group_code: g }))), { status: 200 });
    }

    /* Filtros de data: podem vir dois (lt e gt) na mesma consulta. */
    const dateFilters = q.getAll('snapshot_date');
    const notIn = q.get('group_code');
    const untracked = notIn && notIn.startsWith('not.in.')
      ? notIn.slice('not.in.('.length, -1).split(',').map((s) => s.replace(/^"|"$/g, ''))
      : null;

    const match = (r) => {
      for (const f of dateFilters) {
        const [op, value] = [f.slice(0, f.indexOf('.')), f.slice(f.indexOf('.') + 1)];
        if (op === 'lt' && !(r.snapshot_date < value)) return false;
        if (op === 'gt' && !(r.snapshot_date > value)) return false;
        if (op === 'eq' && r.snapshot_date !== value) return false;
      }
      if (untracked && untracked.includes(r.group_code)) return false;   // not.in
      return true;
    };

    if (method === 'DELETE') {
      state.rows = state.rows.filter((r) => !match(r));
      /* 204 exige corpo null no Node — new Response('', {status:204})
         estoura, e o erro chegaria disfarçado de falha do prune. */
      return new Response(null, { status: 204 });
    }
    const hits = state.rows.filter(match).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    const limit = Number(q.get('limit') || hits.length);
    return new Response(JSON.stringify(hits.slice(0, limit).map((r) => ({ snapshot_date: r.snapshot_date }))), { status: 200 });
  };

  return { state, restore: () => { globalThis.fetch = original; } };
}

const TRACKED = ['FFLATAM100', 'MNCT1720'];
function linhas(date, { rastreados = 2, outros = 5 } = {}) {
  const out = [];
  for (let i = 0; i < rastreados; i += 1) out.push({ snapshot_date: date, group_code: TRACKED[i % TRACKED.length] });
  for (let i = 0; i < outros; i += 1) out.push({ snapshot_date: date, group_code: `OUTRO${i}` });
  return out;
}

async function comServidor(rows, tracked, fn) {
  const srv = fakeServer({ rows, tracked });
  try { return await fn(srv); } finally { srv.restore(); }
}

/* 2026-09-17 é quinta. Janela de 14 dias → corte em 2026-09-03.
   2026-08-31 e 2026-08-24 são segundas. */
const HOJE = '2026-09-17';

test('data fora da janela e que não é segunda sai inteira', () => comServidor(
  [...linhas('2026-09-02'), ...linhas('2026-09-10')], TRACKED, async ({ state }) => {
    const r = await pruneSnapshots(CFG, HOJE);
    assert.deepEqual(r.deleted, ['2026-09-02']);
    assert.equal(state.rows.every((x) => x.snapshot_date === '2026-09-10'), true, 'dentro da janela não se toca');
  }
));

test('segunda fora da janela perde só o que não é rastreado', () => comServidor(
  linhas('2026-08-31'), TRACKED, async ({ state }) => {
    const r = await pruneSnapshots(CFG, HOJE);
    assert.deepEqual(r.thinned, ['2026-08-31']);
    assert.deepEqual(r.deleted, []);
    assert.equal(state.rows.length, 2, 'sobram os 2 rastreados');
    assert.equal(state.rows.every((x) => TRACKED.includes(x.group_code)), true);
  }
));

test('a varredura CONVERGE: segunda já filtrada não volta a consumir orçamento', () => comServidor(
  [...linhas('2026-08-24'), ...linhas('2026-08-31'), ...linhas('2026-09-02')], TRACKED, async ({ state }) => {
    const primeira = await pruneSnapshots(CFG, HOJE);
    assert.deepEqual(primeira.thinned, ['2026-08-24', '2026-08-31']);
    assert.deepEqual(primeira.deleted, ['2026-09-02']);

    /* Segunda execução no mesmo dia: nada sobrou para mexer, e é isso que
       prova que a data nova que vencer amanhã terá orçamento. */
    state.calls.length = 0;
    const segunda = await pruneSnapshots(CFG, HOJE);
    assert.deepEqual(segunda.thinned, []);
    assert.deepEqual(segunda.deleted, []);
    const gets = state.calls.filter((c) => c.startsWith('GET com_supply_snapshots')).length;
    assert.equal(gets, 1, 'uma consulta e para — não fica varrendo as segundas antigas');
  }
));

test('a data que acaba de vencer é tratada mesmo com muitas segundas guardadas', () => comServidor(
  [
    ...['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29',
        '2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03',
        '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31']
      .flatMap((d) => linhas(d, { rastreados: 2, outros: 0 })),   // segundas já filtradas
    ...linhas('2026-09-02')                                        // a que venceu agora
  ], TRACKED, async ({ state }) => {
    const r = await pruneSnapshots(CFG, HOJE);
    assert.deepEqual(r.deleted, ['2026-09-02'], '14 segundas guardadas não podem esconder a data nova');
    assert.equal(state.rows.length, 28, 'as segundas filtradas continuam lá');
  }
));

test('segunda com mais de 12 meses sai inteira, mesmo já filtrada', () => comServidor(
  [...linhas('2025-09-01', { rastreados: 2, outros: 0 }), ...linhas('2026-08-31')], TRACKED, async ({ state }) => {
    const r = await pruneSnapshots(CFG, HOJE);
    assert.equal(r.weeklyCutoff, '2025-09-17');
    assert.equal(state.rows.some((x) => x.snapshot_date === '2025-09-01'), false, 'passou de 12 meses');
    assert.equal(state.rows.filter((x) => x.snapshot_date === '2026-08-31').length, 2);
  }
));

test('com_sku_markets vazia: NÃO apaga segunda nenhuma e avisa', () => comServidor(
  [...linhas('2026-08-31'), ...linhas('2026-09-02')], [], async ({ state }) => {
    const r = await pruneSnapshots(CFG, HOJE);
    assert.equal(r.thinning, false);
    assert.deepEqual(r.thinned, []);
    assert.deepEqual(r.deleted, ['2026-09-02'], 'não-segunda continua saindo');
    assert.equal(state.rows.filter((x) => x.snapshot_date === '2026-08-31').length, 7,
      'sem lista de grupos, a segunda fica INTEIRA — falhar guardando dado demais');
  }
));

test('freio: com lista vazia o laço não trava na mesma segunda', () => comServidor(
  [...linhas('2026-08-24'), ...linhas('2026-08-31'), ...linhas('2026-09-02')], [], async ({ state }) => {
    const r = await pruneSnapshots(CFG, HOJE);
    assert.deepEqual(r.deleted, ['2026-09-02'], 'passou por cima das duas segundas e chegou na quarta-feira');
    assert.ok(state.calls.filter((c) => c.startsWith('GET com_supply_snapshots')).length <= 4);
  }
));

test('nada fora da janela: uma consulta e acabou', () => comServidor(
  linhas('2026-09-16'), TRACKED, async ({ state }) => {
    const r = await pruneSnapshots(CFG, HOJE);
    assert.deepEqual(r.deleted, []);
    assert.deepEqual(r.thinned, []);
    assert.equal(state.rows.length, 7);
  }
));
