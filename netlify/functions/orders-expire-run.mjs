/* ──────────────────────────────────────────────────────────────────────────
   orders-expire-run — TEMPORÁRIO, SÓ PARA O C5 DA FASE 2

   >>> REMOVER ANTES DO MERGE DO PR #4: este arquivo, as duas linhas de
       rota (netlify.toml e _redirects) e as duas entradas em
       GATED_API_PATHS / config.path do gate.ts. <<<

   POR QUE EXISTE: o Netlify recusa chamar Scheduled Function pela URL
   (HTTP 403, 14/09) e só a dispara sozinha em produção. Para provar no
   Deploy Preview o código que vai rodar agendado (mesma função, mesmas
   variáveis de ambiente, mesmo banco), este disparador chama a MESMA
   expireOrders() de orders-expire.mjs. Não reimplementa nada.

   Superfície mínima enquanto existir:
     - atrás do gate (cookie rg_gate), como /api/orders;
     - só POST (um GET de prefetch ou de crawler não dispara);
     - não lê corpo nem parâmetro: não há entrada para manipular;
     - devolve só contagem, ids opacos e o corte usado.
   A operação é idempotente e só vence o que já passou do prazo.

   Decisão do Vinicius em 14/09 (opção A do C5).
   ────────────────────────────────────────────────────────────────────────── */

import { expireOrders } from './orders-expire.mjs';

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });

  const missing = ['SUPABASE_URL', 'STOREFRONT_SECRET_KEY'].filter((k) => !String(process.env[k] || '').trim());
  if (missing.length) {
    console.error('orders-expire-run: missing env vars: %s', missing.join(', '));
    return json(500, { error: 'misconfigured' });
  }

  try {
    const result = await expireOrders();
    console.log('orders-expire-run: ok expired=%d cutoff=%s%s', result.expired, result.cutoff,
      result.expired ? ' ids=' + result.ids.join(',') : '');
    return json(200, result);
  } catch (e) {
    console.error('orders-expire-run: failed status=%s%s err=%s', e.status || '-', e.detail || '', e.name);
    return json(502, { error: 'expire_failed' });
  }
};
