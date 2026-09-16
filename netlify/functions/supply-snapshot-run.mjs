/* ──────────────────────────────────────────────────────────────────────────
   supply-snapshot-run — TEMPORÁRIO, SÓ PARA O C2 DO MOTOR COMERCIAL

   >>> REMOVER ANTES DO MERGE: este arquivo, as duas linhas de rota
       (netlify.toml e _redirects) e as duas entradas em GATED_API_PATHS /
       config.path do gate.ts. <<<

   POR QUE EXISTE: o Netlify recusa chamar Scheduled Function pela URL
   (403, conferido na Fase 2) e só a dispara sozinha em produção. O C2
   precisa de uma execução no dia em que o Vinicius exporta o CSV da
   interface web da Lapak para comparar linha a linha. Este disparador
   chama a MESMA runSnapshot() de netlify/lib/supply.mjs. Não reimplementa
   nada, não tem parâmetro próprio.

   Superfície mínima enquanto existir:
     - atrás do gate (cookie rg_gate), como /api/orders;
     - só POST (GET de prefetch ou de crawler não dispara);
     - não lê corpo nem parâmetro;
     - devolve contagem por país, e nenhum preço.

   Mesmo padrão do orders-expire-run da Fase 2, que foi removido no merge
   do PR #4 (commit d3a3cf2).
   ────────────────────────────────────────────────────────────────────────── */

import { runSnapshot, logSnapshot } from '../lib/supply.mjs';

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  try {
    const r = await runSnapshot();
    logSnapshot('supply-snapshot-run', r);
    return json(200, {
      date: r.snapshotDate,
      stored: r.stored,
      countries: r.countries,
      failed: r.failedCountries,
      fx: r.fx,
      fxError: r.fxError,
      prune: r.prune,
      pruneError: r.pruneError,
      elapsedMs: r.elapsedMs,
      ok: r.ok
    });
  } catch (e) {
    if (e.code === 'misconfigured') {
      console.error('supply-snapshot-run: misconfigured missing=%s', (e.missing || []).join(','));
      return json(500, { error: 'misconfigured', missing: e.missing });
    }
    console.error('supply-snapshot-run: failed reason=%s err=%s', e.reason || '-', e.name);
    return json(502, { error: 'snapshot_failed', reason: e.reason || null });
  }
};
