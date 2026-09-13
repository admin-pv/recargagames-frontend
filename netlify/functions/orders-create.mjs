/* ──────────────────────────────────────────────────────────────────────────
   orders-create — POST /api/orders (Fase 2)

   Cria o pedido "aguardando pagamento" do cliente logado. É o ÚNICO
   caminho de escrita em public.orders a partir da loja: o browser não tem
   GRANT nem policy de escrita (migration 0003).

   O QUE O CLIENTE MANDA:
     { country, gameSlug, productCode, redemptionFields, deliveryEmail,
       paymentMethod }
     ou, para refazer um pedido vencido:  { country, retryOf: <uuid> }

   O QUE O CLIENTE NUNCA DECIDE: preço, taxa, moeda, status, validade.
   Qualquer campo de valor no corpo (priceCents, amount...) é ignorado sem
   ser lido. O valor é o `priceCents` do pacote no catálogo do servidor
   (mesmo módulo e mesma cache do /api/catalog), e a taxa vem de
   payment_methods.

   ORDEM DAS CHECAGENS (a primeira que falha responde):
     1. JWT válido (validado pelo próprio Supabase)       401
     2. corpo JSON pequeno e bem formado                  400 / 413
     3. mercado conhecido                                 400
     4. catálogo do mercado disponível                    503
     5. jogo e pacote no catálogo, e o pacote é o canônico 400
     6. campos de resgate batem com os forms da Lapak     400
     7. e-mail de entrega válido                          400
     8. meio de pagamento existe e está ativo no país     400
     9. perfil do cliente existe e não foi excluído       403
    10. menos de 5 pedidos abertos                        429
    11. validação prévia do ID (hoje sempre 'unsupported')  400 se inválido
   Só então grava.

   REFAZER (retryOf), usado pelo checkout.html:
     - pedido ainda aguardando e dentro da validade → devolve O MESMO pedido
       (200, reused:true). Nunca duplica.
     - pedido vencido (status expired, ou awaiting_payment com expires_at no
       passado, antes de o orders-expire passar) → cria um novo com os
       dados GRAVADOS no original, revalidados contra o catálogo de agora.
       O corpo não pode trocar pacote nem campos de um retry.
     - qualquer outro status → 409.

   ── ENV ──
   SUPABASE_URL, STOREFRONT_SECRET_KEY, PROXY_URL, LAPAK_ENV (catálogo).
   PROXY_ADMIN_KEY ainda NÃO é lida: o gancho do check de ID grava
   'unsupported' sem chamar a Lapak, porque a doc v1.6 não tem o endpoint.
   Quando o contrato existir (pré-requisito comercial da Fase 3), a chave
   entra aqui e só aqui. Ver docs/modelo-catalogo-e-fulfillment.md, seção 4.

   ── LOG ──
   Sucesso: `orders-create: ok id=<uuid> code=<product_code>`. Erro: o
   código do erro, o ref do usuário (8 caracteres) e, de upstream, só o
   SQLSTATE. Nunca e-mail, nome, campos de resgate ou corpo de erro do
   PostgREST.
   ────────────────────────────────────────────────────────────────────────── */

import {
  MARKETS, loadCatalog, isFieldValueValid, toCents, catalogEnv,
  CatalogUnavailable, MisconfiguredError
} from '../lib/catalog.mjs';

const ORDER_TTL_MINUTES = 30;
const MAX_OPEN_ORDERS = 5;
const MAX_BODY_BYTES = 8 * 1024;
const SUPABASE_TIMEOUT_MS = 8000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

function fail(statusCode, code, extra) {
  return json(statusCode, Object.assign({ error: code }, extra || {}));
}

/** Do corpo de erro do PostgREST, só o SQLSTATE. Nunca a mensagem. */
function safeDetail(text) {
  try {
    const body = JSON.parse(text);
    return body && body.code ? ` sqlstate=${String(body.code).slice(0, 12)}` : '';
  } catch {
    return '';
  }
}

function safeRef(userId) { return String(userId || '').slice(0, 8); }

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

async function rest(cfg, path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: cfg.secret, Authorization: `Bearer ${cfg.secret}`, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  return fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS)
  });
}

async function restRows(cfg, path) {
  const res = await rest(cfg, path);
  if (!res.ok) {
    const err = new Error('supabase_read_failed');
    err.status = res.status;
    err.detail = safeDetail(await res.text());
    throw err;
  }
  return res.json();
}

/* ── Gancho da validação prévia do ID ─────────────────────────────────────
   Modelo, seção 4: antes da cobrança, se a Lapak permitir, perguntar se o
   ID é elegível para o SKU. Resultado em orders.id_validation.

   Hoje devolve 'unsupported' SEMPRE, sem rede: a doc v1.6 não tem endpoint
   de checagem, e o `check_id` da categoria está 'inactive' nos jogos do
   catálogo. Ativação para FF, PUBG e MLBB é pré-requisito comercial da
   Fase 3. Quando vier, a assinatura já é esta: 'valid' | 'invalid' |
   'unsupported' | 'error'. */
async function checkIdEligibility(/* { cfg, product, productCode, fields } */) {
  return 'unsupported';
}

/* Pacote canônico do jogo, ou o motivo de não ser. */
function resolvePackage(catalog, gameSlug, productCode) {
  const product = catalog.products.find((p) => p.id === gameSlug);
  if (!product) return { error: 'product_not_available' };
  const pkg = product.packages.find((k) => k.id === productCode);
  if (pkg) return { product, pkg };
  for (const alts of catalog.alternatives.values()) {
    if (alts.includes(productCode)) return { error: 'package_not_canonical' };
  }
  return { error: 'product_not_available' };
}

/* Só os nomes que o forms da Lapak pede, todos presentes e válidos.
   Chave a mais também é recusada: não se grava o que o jogo não pediu. */
function cleanRedemptionFields(product, raw) {
  if (!isPlainObject(raw)) return { error: 'invalid_redemption_fields' };
  const allowed = new Set(product.fields.map((f) => f.name));
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return { error: 'invalid_redemption_fields', field: key.slice(0, 40) };
  }
  const clean = {};
  for (const rule of product.fields) {
    const value = raw[rule.name];
    if (typeof value !== 'string' || !isFieldValueValid(rule, value)) {
      return { error: 'invalid_redemption_fields', field: rule.name };
    }
    clean[rule.name] = value.trim();
  }
  return { clean };
}

/* payment_methods: o admin exibe `method_name || method_code`, então a
   chave pode estar em qualquer um dos dois. Ativo = nem `active` nem
   `is_active` explicitamente false. */
function findPaymentMethod(rows, key) {
  const k = String(key || '').trim().toLowerCase();
  if (!k || k.length > 32) return null;
  const row = rows.find((r) =>
    String(r.method_code || '').toLowerCase() === k || String(r.method_name || '').toLowerCase() === k);
  if (!row || row.active === false || row.is_active === false) return null;
  return row;
}

/* D2: taxa absorvida, gravada como custo. Aritmética inteira:
   transaction_cost_percent "0.99" → 99 centésimos de ponto percentual;
   fixed_cost em REAIS → centavos. */
function feeCents(amountCents, row) {
  const pctHundredths = toCents(row.transaction_cost_percent ?? 0) ?? 0;
  const fixed = toCents(row.fixed_cost ?? 0) ?? 0;
  return Math.round((amountCents * pctHundredths) / 10000) + fixed;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return fail(405, 'method_not_allowed');

  let cfg;
  try {
    cfg = catalogEnv();
  } catch (e) {
    if (e instanceof MisconfiguredError) {
      console.error('orders-create: missing env vars: %s', e.missing.join(', '));
      return fail(500, 'misconfigured');
    }
    throw e;
  }

  // ---- 1. Quem está pedindo? ----
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return fail(401, 'missing_token');

  let userId;
  try {
    const res = await fetch(`${cfg.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: cfg.secret, Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS)
    });
    if (!res.ok) return fail(401, 'invalid_token');
    const user = await res.json();
    userId = user && user.id;
    if (!userId) return fail(401, 'invalid_token');
  } catch (e) {
    console.error('orders-create: auth lookup failed err=%s', e.name);
    return fail(502, 'upstream_unavailable');
  }
  const ref = safeRef(userId);

  // ---- 2. Corpo ----
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) return fail(413, 'body_too_large');
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return fail(400, 'invalid_json');
  }
  if (!isPlainObject(body)) return fail(400, 'invalid_json');

  // ---- 3. Mercado ----
  const country = String(body.country || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(MARKETS, country)) return fail(400, 'invalid_country');

  try {
    // ---- Refazer um pedido? ----
    let input = body;
    if (body.retryOf !== undefined) {
      const retryOf = String(body.retryOf || '');
      if (!UUID_RE.test(retryOf)) return fail(400, 'invalid_retry');
      const rows = await restRows(cfg,
        `orders?select=id,status,expires_at,amount_cents,currency_code,product_code,game_slug,` +
        `redemption_fields,delivery_email,payment_method,country` +
        `&id=eq.${retryOf}&user_id=eq.${encodeURIComponent(userId)}&channel=eq.storefront&limit=1`);
      const original = rows[0];
      if (!original) return fail(404, 'order_not_found');

      const stillOpen = original.status === 'awaiting_payment' && new Date(original.expires_at).getTime() > Date.now();
      if (stillOpen) {
        return json(200, {
          id: original.id, amountCents: original.amount_cents, currency: original.currency_code,
          expiresAt: original.expires_at, reused: true
        });
      }
      const expired = original.status === 'expired' || original.status === 'awaiting_payment';
      if (!expired) return fail(409, 'order_not_retryable');
      if (original.country && original.country !== country) return fail(400, 'invalid_country');

      input = {
        gameSlug: original.game_slug,
        productCode: original.product_code,
        redemptionFields: original.redemption_fields,
        deliveryEmail: original.delivery_email,
        paymentMethod: original.payment_method
      };
    }

    const gameSlug = typeof input.gameSlug === 'string' ? input.gameSlug.trim().slice(0, 100) : '';
    const productCode = typeof input.productCode === 'string' ? input.productCode.trim().slice(0, 100) : '';
    if (!gameSlug || !productCode) return fail(400, 'product_not_available');

    // ---- 4. Catálogo ----
    let catalog;
    try {
      catalog = await loadCatalog(country);
    } catch (e) {
      console.error('orders-create: catalog unavailable ref=%s reason=%s', ref, e && e.reason);
      return fail(503, 'catalog_unavailable');
    }

    // ---- 5. Pacote ----
    const resolved = resolvePackage(catalog, gameSlug, productCode);
    if (resolved.error) {
      console.warn('orders-create: reject ref=%s reason=%s code=%s', ref, resolved.error, productCode);
      return fail(400, resolved.error);
    }
    const { product, pkg } = resolved;

    // ---- 6. Campos de resgate ----
    const fields = cleanRedemptionFields(product, input.redemptionFields);
    if (fields.error) {
      console.warn('orders-create: reject ref=%s reason=%s field=%s', ref, fields.error, fields.field || '-');
      return fail(400, fields.error, fields.field ? { field: fields.field } : undefined);
    }

    // ---- 7. E-mail de entrega ----
    const deliveryEmail = typeof input.deliveryEmail === 'string' ? input.deliveryEmail.trim() : '';
    if (deliveryEmail.length > 254 || !EMAIL_RE.test(deliveryEmail)) return fail(400, 'invalid_email');

    // ---- 8. Meio de pagamento ----
    const methods = await restRows(cfg, `payment_methods?select=*&country_code=eq.${encodeURIComponent(country)}`);
    const method = findPaymentMethod(methods, input.paymentMethod);
    if (!method) return fail(400, 'invalid_payment_method');
    const paymentMethod = String(input.paymentMethod).trim().toLowerCase();

    // ---- 9. Perfil ----
    const profiles = await restRows(cfg,
      `customer_profiles?select=id&user_id=eq.${encodeURIComponent(userId)}&deleted_at=is.null&limit=1`);
    if (!profiles[0]) return fail(403, 'profile_missing');

    // ---- 10. Rate limit: pedidos abertos ----
    /* Checagem e INSERT não são atômicos: duas requisições simultâneas
       podem passar do limite por um. Aceitável para o que isto protege
       (lixo em orders por clique repetido), não é controle de dinheiro. */
    const open = await restRows(cfg,
      `orders?select=id&user_id=eq.${encodeURIComponent(userId)}&channel=eq.storefront` +
      `&status=eq.awaiting_payment&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=${MAX_OPEN_ORDERS}`);
    if (open.length >= MAX_OPEN_ORDERS) return fail(429, 'too_many_open_orders');

    // ---- 11. Validação prévia do ID ----
    const idValidation = await checkIdEligibility({ cfg, product, productCode: pkg.id, fields: fields.clean });
    if (idValidation === 'invalid') {
      /* Fallback do modelo (seção 4): tentar as variantes do mesmo jogo +
         face_value com o mesmo ID. Inalcançável enquanto o gancho devolve
         'unsupported'; o preço de uma variante trocada é decisão da Fase 3. */
      return fail(400, 'id_not_eligible');
    }

    // ---- Grava ----
    const amountCents = pkg.priceCents;
    const expiresAt = new Date(Date.now() + ORDER_TTL_MINUTES * 60 * 1000).toISOString();
    const row = {
      channel: 'storefront',
      status: 'awaiting_payment',
      payment_status: 'awaiting',
      user_id: userId,
      customer_profile_id: profiles[0].id,
      country,
      currency_code: MARKETS[country].currency,
      product_code: pkg.id,
      game_slug: product.id,
      package_label: pkg.label,
      face_value: pkg.faceValue,
      redemption_fields: fields.clean,
      delivery_email: deliveryEmail,
      payment_method: paymentMethod,
      amount_cents: amountCents,
      fee_cents: feeCents(amountCents, method),
      id_validation: idValidation,
      expires_at: expiresAt
      // user_type: default 'guest' da tabela, de propósito (decisão de 13/09)
    };

    const res = await rest(cfg, 'orders?select=id,expires_at', {
      method: 'POST', body: row, prefer: 'return=representation'
    });
    if (!res.ok) {
      console.error('orders-create: insert failed ref=%s status=%d%s', ref, res.status, safeDetail(await res.text()));
      return fail(502, 'order_insert_failed');
    }
    const created = (await res.json())[0];

    console.log('orders-create: ok id=%s code=%s', created.id, pkg.id);
    return json(201, {
      id: created.id,
      amountCents,
      currency: MARKETS[country].currency,
      expiresAt: created.expires_at
    });
  } catch (e) {
    if (e instanceof CatalogUnavailable) return fail(503, 'catalog_unavailable');
    console.error('orders-create: upstream ref=%s err=%s status=%s%s', ref, e && e.message, e && e.status, (e && e.detail) || '');
    return fail(502, 'upstream_unavailable');
  }
};
