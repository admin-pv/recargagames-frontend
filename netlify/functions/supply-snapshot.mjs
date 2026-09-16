/* ──────────────────────────────────────────────────────────────────────────
   supply-snapshot — foto diária do custo Lapak (Motor Comercial)

   Scheduled Function, uma vez por dia às 07:00 UTC (netlify.toml,
   [functions."supply-snapshot"]). Toda a lógica está em
   netlify/lib/supply.mjs; aqui só entra env, log e código de saída.

   IDEMPOTENTE. A chave é (snapshot_date, query_country, product_code) e a
   escrita é upsert: rodar duas vezes no mesmo dia reescreve as mesmas
   linhas com os mesmos valores. Dia anterior nunca é tocado — é o que faz
   o DELTA do gerador ser confiável.

   PARCIAL É ACEITÁVEL, DE PROPÓSITO: país que falhar não derruba os
   outros. A proposta prefere 8 países a nenhum, e o grupo que ficou sem
   linha aparece como "SEM SUPPLY" na planilha, que é exatamente o
   comportamento da v5 quando falta supply.

   Não tem rota em /api/ e não recebe entrada: não há nada para manipular.
   (Enquanto durar o C2 existe supply-snapshot-run, TEMPORÁRIO e atrás do
   gate, que chama esta mesma runSnapshot.)

   ── ENV ── SUPABASE_URL, STOREFRONT_SECRET_KEY, PROXY_URL, LAPAK_ENV,
             PROXY_ADMIN_KEY, SNAPSHOT_COUNTRIES.
   ── LOG ── contagem e país. Nenhum preço, nenhum código de produto.
   ────────────────────────────────────────────────────────────────────────── */

import { runSnapshot, logSnapshot } from '../lib/supply.mjs';

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

export const handler = async () => {
  try {
    const r = await runSnapshot();
    logSnapshot('supply-snapshot', r);
    /* 200 mesmo degradado: o dia foi gravado. O que separa "degradado" de
       "falhou" está no corpo e no log, não no código HTTP — Scheduled
       Function que devolve erro entra em retry e refaz o trabalho inteiro
       por causa de um país. */
    return json(200, {
      date: r.snapshotDate,
      stored: r.stored,
      countries: r.countries.length,
      failed: r.failedCountries.map((c) => c.country),
      ok: r.ok
    });
  } catch (e) {
    if (e.code === 'misconfigured') {
      console.error('supply-snapshot: misconfigured missing=%s', (e.missing || []).join(','));
      return json(500, { error: 'misconfigured' });
    }
    console.error('supply-snapshot: failed reason=%s err=%s', e.reason || '-', e.name);
    return json(502, { error: 'snapshot_failed' });
  }
};
