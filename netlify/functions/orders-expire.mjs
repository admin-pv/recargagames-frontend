/* ──────────────────────────────────────────────────────────────────────────
   orders-expire — expira pedidos da loja que passaram do prazo (Fase 2)

   Scheduled Function, a cada 10 minutos (netlify.toml,
   [functions."orders-expire"]). Faz uma coisa só:

     orders com channel = 'storefront', status = 'awaiting_payment' e
     expires_at < now()  →  status = 'expired'

   IDEMPOTENTE. É um UPDATE condicional num único comando do PostgREST: a
   linha que já expirou não casa mais com o filtro, então rodar de novo não
   muda nada e devolve expired=0. Duas execuções simultâneas não brigam: o
   Postgres trava a linha, e a segunda não a encontra mais em
   awaiting_payment.

   O QUE NÃO FAZ, de propósito:
     - não mexe em payment_status. O brief define a transição só de
       `status`; o que payment_status vira num pedido que nunca foi pago é
       decisão da Fase 3, junto com o webhook do PagBrasil;
     - não toca em channel 'proxy', 'reload' ou 'partner': o filtro de
       canal está no UPDATE, não só no status;
     - não apaga nada. Pedido expirado fica para histórico e para o retry
       (checkout.html → orders-create com retryOf).

   A tela não depende disto para mostrar "expirado": order-details e
   my-orders tratam awaiting_payment com expires_at no passado como vencido
   (RecargaStore.isOrderExpired). Esta Function acerta o banco, que é o que
   o rate limit de 5 pedidos abertos e os relatórios leem.

   ── ENV ── SUPABASE_URL, STOREFRONT_SECRET_KEY.
   ── LOG ── contagem e ids de pedido (opacos). Nenhum dado de cliente.
   ────────────────────────────────────────────────────────────────────────── */

const REQUIRED_ENV = ['SUPABASE_URL', 'STOREFRONT_SECRET_KEY'];
const TIMEOUT_MS = 8000;

function safeDetail(text) {
  try {
    const body = JSON.parse(text);
    return body && body.code ? ` sqlstate=${String(body.code).slice(0, 12)}` : '';
  } catch {
    return '';
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

export async function expireOrders({ now = new Date() } = {}) {
  const url = process.env.SUPABASE_URL.trim().replace(/\/+$/, '');
  const secret = process.env.STOREFRONT_SECRET_KEY.trim();
  const cutoff = encodeURIComponent(now.toISOString());

  const res = await fetch(
    `${url}/rest/v1/orders?channel=eq.storefront&status=eq.awaiting_payment&expires_at=lt.${cutoff}&select=id`,
    {
      method: 'PATCH',
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({ status: 'expired' }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    }
  );
  if (!res.ok) {
    const err = new Error('expire_failed');
    err.status = res.status;
    err.detail = safeDetail(await res.text());
    throw err;
  }
  const rows = await res.json();
  return { expired: rows.length, ids: rows.map((r) => r.id), cutoff: now.toISOString() };
}

export const handler = async () => {
  const missing = REQUIRED_ENV.filter((k) => !String(process.env[k] || '').trim());
  if (missing.length) {
    console.error('orders-expire: missing env vars: %s', missing.join(', '));
    return json(500, { error: 'misconfigured' });
  }

  try {
    const result = await expireOrders();
    console.log('orders-expire: ok expired=%d cutoff=%s%s', result.expired, result.cutoff,
      result.expired ? ' ids=' + result.ids.join(',') : '');
    return json(200, { expired: result.expired, cutoff: result.cutoff });
  } catch (e) {
    console.error('orders-expire: failed status=%s%s err=%s', e.status || '-', e.detail || '', e.name);
    return json(502, { error: 'expire_failed' });
  }
};
