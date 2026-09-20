/* ──────────────────────────────────────────────────────────────────────────
   env.mjs — lê o .env local (gitignored) dos scripts do motor comercial.

   Procura, nesta ordem, e a PRIMEIRA chave encontrada vence:
     <raiz do repo>/.env        (o lugar padrão)
     <raiz do repo>/scripts/.env

   NÃO existe fallback embutido de URL nem de chave: script de pricing lê
   custo de fornecedor, e uma credencial default seria uma credencial no
   repo. Sem .env, ele para e diz o que falta.
   ────────────────────────────────────────────────────────────────────── */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const SCRIPTS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPO_ROOT = path.dirname(SCRIPTS_DIR);
export const OUT_DIR = path.join(REPO_ROOT, 'out');

function parseEnvFile(file) {
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadEnv() {
  const merged = {};
  for (const file of [path.join(REPO_ROOT, '.env'), path.join(SCRIPTS_DIR, '.env')]) {
    if (existsSync(file)) Object.assign(merged, parseEnvFile(file), merged);
  }
  /* process.env vence o arquivo: dá para rodar com a chave só na sessão do
     shell, sem nunca escrever em disco. */
  Object.assign(merged, Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined && v !== '')
  ));

  const url = (merged.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = (merged.SUPABASE_SECRET_KEY || merged.STOREFRONT_SECRET_KEY || '').trim();

  const missing = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!key) missing.push('SUPABASE_SECRET_KEY (ou STOREFRONT_SECRET_KEY)');
  if (missing.length) {
    throw new Error(
      `Faltando ${missing.join(' e ')}.\n` +
      `Crie ${path.join(REPO_ROOT, '.env')} com:\n` +
      `  SUPABASE_URL=https://ashmirzgyuhspymldpfv.supabase.co\n` +
      `  SUPABASE_SECRET_KEY=<secret key do projeto>\n` +
      `O .env está no .gitignore. Modelo em scripts/.env.example.`
    );
  }
  return { url, key };
}
