/* ──────────────────────────────────────────────────────────────────────────
   account-delete — exclusão de conta do cliente (LGPD, direito de exclusão)

   Primeira Netlify Function deste repo.

   POR QUE ISTO NÃO PODE SER FEITO NO BROWSER: apagar de auth.users exige
   a secret key. Secret key no front é secret vazada — qualquer visitante
   a leria no DevTools e teria poder de admin sobre o projeto inteiro.

   O QUE ACONTECE, NESTA ORDEM:
     1. valida o JWT do usuário (quem ele diz que é, de fato é)
     2. anonimiza a linha em customer_profiles e carimba deleted_at
     3. apaga o usuário de auth.users

   A ORDEM IMPORTA. Se apagasse o auth.users primeiro e a anonimização
   falhasse, a linha ficaria órfã com o e-mail e o telefone reais dentro
   — exatamente o dado que a exclusão deveria remover, agora sem nenhum
   dono para pedir de novo. Anonimizar primeiro faz o pior caso ser
   "usuário ainda existe mas o perfil está limpo", que é recuperável e
   não vaza nada.

   A LINHA NÃO É APAGADA, e isso é de propósito. `user_id` tem
   ON DELETE SET NULL (não CASCADE), então ela sobrevive à exclusão do
   auth.users: anônima, com deleted_at, e invisível para todo mundo — a
   policy de SELECT exige `user_id = auth.uid()`, e auth.uid() nunca é
   NULL. Só esta Function a enxerga. Na Fase 2 é ela que segura o
   histórico de pedidos, que tem retenção fiscal e não pode sumir junto
   com a conta.

   PEDIDOS NÃO SÃO APAGADOS. Hoje nem estão aqui — vivem no localStorage
   do navegador (ver o cabeçalho FASE 2 de app/shared/js/store.js).
   Quando virarem tabela, esta Function continua não os apagando: a base
   legal da retenção fiscal é diferente da do perfil.

   ── ENV ──
   SUPABASE_URL            já existia (todos os contextos)
   STOREFRONT_SECRET_KEY   = storefront_fn_v1

   NUNCA usar SUPABASE_SECRET_KEY aqui. Essa é a gate_v1, do gate; usá-la
   aqui daria a esta Function um credencial de outro escopo e faria as
   duas caírem juntas numa rotação.

   ── POR QUE .mjs E NÃO .js ──

   Este arquivo é ESM (`export const handler`). O repo não tem
   package.json — é decisão do projeto, sem build step e sem gerenciador
   de pacotes — então não há `"type": "module"` para declarar o formato.
   Um `.js` aqui seria interpretado como CommonJS e morreria no deploy com
   `SyntaxError: Unexpected token 'export'`. A extensão `.mjs` declara o
   formato sem introduzir package.json nenhum.

   A rota não muda: netlify/functions/account-delete.mjs continua sendo
   servido em /.netlify/functions/account-delete.

   ── LOG ──
   Nenhum PII. Nem e-mail, nem nome, nem telefone, nem o corpo de erro do
   PostgREST (`message`/`details`/`hint` são justamente onde o Postgres
   ecoa valores da linha). Só o SQLSTATE — mesma regra do `safeDetail` do
   reload. O user id entra truncado: é opaco e serve para correlacionar.
   ────────────────────────────────────────────────────────────────────────── */

const REQUIRED_ENV = ['SUPABASE_URL', 'STOREFRONT_SECRET_KEY'];

/** Do corpo de erro do PostgREST/GoTrue, só o SQLSTATE. Nunca a mensagem. */
function safeDetail(text) {
  try {
    const body = JSON.parse(text);
    return body && body.code ? ` sqlstate=${String(body.code).slice(0, 12)}` : '';
  } catch {
    return '';
  }
}

/** Identificador opaco e curto, para correlacionar logs sem guardar o id inteiro. */
function safeRef(userId) {
  return String(userId || '').slice(0, 8);
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { code: 'method_not_allowed' });
  }

  const missing = REQUIRED_ENV.filter((k) => !String(process.env[k] || '').trim());
  if (missing.length) {
    // Nomes de variável, nunca valores.
    console.error('account-delete: missing env vars:', missing.join(', '));
    return json(500, { code: 'misconfigured' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL.trim().replace(/\/+$/, '');
  const SECRET = process.env.STOREFRONT_SECRET_KEY.trim();

  // ---- 1. Quem está pedindo? ----
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return json(401, { code: 'missing_token' });
  }

  /* O JWT é validado pelo próprio Supabase, não decodificado aqui. Ler o
     `sub` do payload sem verificar assinatura aceitaria um token forjado
     — e o pedido é para APAGAR uma conta, então a checagem é o produto. */
  let userId;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SECRET, Authorization: `Bearer ${jwt}` }
    });
    if (!res.ok) {
      console.warn('account-delete: token rejected, status=%d', res.status);
      return json(401, { code: 'invalid_token' });
    }
    const user = await res.json();
    userId = user && user.id;
    if (!userId) return json(401, { code: 'invalid_token' });
  } catch (e) {
    console.error('account-delete: auth lookup failed:', e.name);
    return json(502, { code: 'upstream_unavailable' });
  }

  const ref = safeRef(userId);

  // ---- 2. Anonimizar o perfil, ANTES de apagar o usuário ----
  /* Valores fixos, não nulos: NULL em todas as colunas tornaria
     indistinguível "excluído" de "nunca preencheu". O marcador deixa
     legível, para quem olhar a tabela um ano depois, que a linha foi
     esvaziada por pedido do titular. */
  const anonymized = {
    email: `deleted+${ref}@invalid.local`,
    full_name: '[excluído a pedido do titular]',
    phone: null,
    nickname: null,
    favorite_games: [],
    linked_accounts: [],
    marketing_opt_in: false,
    notifications: {},
    deleted_at: new Date().toISOString()
  };

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/customer_profiles?user_id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SECRET,
          Authorization: `Bearer ${SECRET}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(anonymized)
      }
    );
    if (!res.ok) {
      const detail = safeDetail(await res.text());
      console.error('account-delete: anonymise failed ref=%s status=%d%s', ref, res.status, detail);
      return json(502, { code: 'anonymise_failed' });
    }
  } catch (e) {
    console.error('account-delete: anonymise threw ref=%s err=%s', ref, e.name);
    return json(502, { code: 'upstream_unavailable' });
  }

  // ---- 3. Apagar de auth.users ----
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` }
    });
    /* 404 = já não existe. Um duplo-clique no botão não deve virar erro
       para o usuário: o estado desejado (conta inexistente) foi atingido. */
    if (!res.ok && res.status !== 404) {
      const detail = safeDetail(await res.text());
      console.error('account-delete: auth delete failed ref=%s status=%d%s', ref, res.status, detail);
      /* O perfil JÁ foi anonimizado. O dado pessoal saiu, que é a
         obrigação principal; o que ficou pendente é a remoção da
         credencial. Devolve erro para a tela não afirmar conclusão. */
      return json(502, { code: 'auth_delete_failed', profileAnonymised: true });
    }
  } catch (e) {
    console.error('account-delete: auth delete threw ref=%s err=%s', ref, e.name);
    return json(502, { code: 'upstream_unavailable', profileAnonymised: true });
  }

  console.log('account-delete: ok ref=%s', ref);
  return json(200, { ok: true });
};
