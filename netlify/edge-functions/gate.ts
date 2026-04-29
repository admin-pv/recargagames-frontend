// Edge Function do Netlify — Gate de senha para /br/*
// Roda na borda do CDN antes do HTML chegar ao browser
//
// Responsabilidades:
//   1. POST /_gate/auth         → valida senha contra hash bcrypt no Supabase, emite JWT em cookie
//   2. GET /br/* sem cookie     → serve a página de gate
//   3. GET /br/* com cookie OK  → deixa o request seguir para o HTML real
//
// Variáveis de ambiente necessárias (configuradas no painel do Netlify):
//   - SUPABASE_URL
//   - SUPABASE_SECRET_KEY    (a sb_secret_... que você rotacionou)
//   - JWT_SIGNING_SECRET     (segredo de assinatura do JWT)

import type { Context, Config } from "https://edge.netlify.com/";
import bcrypt from "https://esm.sh/bcryptjs@2.4.3";
import { create, verify, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const COOKIE_NAME = "rg_gate";
const COOKIE_MAX_AGE_DAYS = 90;
const JWT_ISSUER = "recargagames";

// ---------------- Helpers ----------------

async function getJwtKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function fetchPasswordHash(supabaseUrl: string, secretKey: string): Promise<string | null> {
  const url = `${supabaseUrl}/rest/v1/access_config?key=eq.site_password_hash&select=value`;
  const res = await fetch(url, {
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
    },
  });
  if (!res.ok) {
    console.error("Supabase fetch failed:", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0].value as string;
}

async function issueJwt(jwtSecret: string): Promise<string> {
  const key = await getJwtKey(jwtSecret);
  return await create(
    { alg: "HS256", typ: "JWT" },
    {
      iss: JWT_ISSUER,
      sub: "site_access",
      iat: getNumericDate(0),
      exp: getNumericDate(60 * 60 * 24 * COOKIE_MAX_AGE_DAYS),
    },
    key
  );
}

async function verifyJwt(token: string, jwtSecret: string): Promise<boolean> {
  try {
    const key = await getJwtKey(jwtSecret);
    const payload = await verify(token, key);
    return payload.iss === JWT_ISSUER && payload.sub === "site_access";
  } catch {
    return false;
  }
}

function getCookie(req: Request, name: string): string | null {
  const cookieHeader = req.headers.get("cookie") || "";
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k, v.join("=")];
    })
  );
  return cookies[name] || null;
}

function setCookieHeader(token: string): string {
  const maxAge = 60 * 60 * 24 * COOKIE_MAX_AGE_DAYS;
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

// ---------------- Main handler ----------------

export default async (req: Request, ctx: Context): Promise<Response | undefined> => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SECRET_KEY = Deno.env.get("SUPABASE_SECRET_KEY");
  const JWT_SIGNING_SECRET = Deno.env.get("JWT_SIGNING_SECRET");

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !JWT_SIGNING_SECRET) {
    console.error("Missing required env vars");
    return new Response("Service misconfigured", { status: 500 });
  }

  // --- ROTA 1: POST /_gate/auth (valida senha) ---
  if (pathname === "/_gate/auth" && req.method === "POST") {
    let body: { password?: string; next?: string };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }

    const password = (body.password || "").trim();
    const next = (body.next || "/br/").startsWith("/") ? body.next! : "/br/";

    if (!password) {
      return jsonResponse({ error: "missing_password" }, 400);
    }

    const hash = await fetchPasswordHash(SUPABASE_URL, SUPABASE_SECRET_KEY);
    if (!hash) {
      return jsonResponse({ error: "config_unavailable" }, 500);
    }

    const valid = await bcrypt.compare(password, hash);
    if (!valid) {
      // Pequeno delay artificial para reduzir efetividade de timing/brute-force
      await new Promise((r) => setTimeout(r, 400));
      return jsonResponse({ error: "invalid_password" }, 401);
    }

    const jwt = await issueJwt(JWT_SIGNING_SECRET);
    return jsonResponse(
      { ok: true, redirect: next },
      200,
      { "Set-Cookie": setCookieHeader(jwt) }
    );
  }

  // --- ROTA 2: GET /br/* (verifica cookie ou mostra gate) ---
  if (pathname === "/br" || pathname.startsWith("/br/")) {
    // Não bloquear o próprio _gate.html nem assets necessários para a página de gate
    // (no nosso caso, a página de gate é totalmente self-contained, então não precisamos de exceções)

    const token = getCookie(req, COOKIE_NAME);
    if (token && (await verifyJwt(token, JWT_SIGNING_SECRET))) {
      // Cookie válido — deixa o request seguir para o conteúdo real
      return ctx.next();
    }

    // Sem cookie ou cookie inválido — serve a página de gate
    // Buscamos o HTML estático do próprio site (que está em /br/_gate.html)
    const gateUrl = new URL("/br/_gate.html", req.url);
    const gateRes = await fetch(gateUrl, { headers: { "x-skip-gate": "1" } });
    if (!gateRes.ok) {
      return new Response("Gate page unavailable", { status: 503 });
    }
    const html = await gateRes.text();
    return new Response(html, {
      status: 401,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  // Qualquer outra rota: deixa passar
  return ctx.next();
};

// Configuração da Edge Function
export const config: Config = {
  path: ["/br", "/br/*", "/_gate/auth"],
  // Excluímos o próprio _gate.html para evitar loop quando o handler busca a página
  excludedPath: ["/br/_gate.html"],
};
