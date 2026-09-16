/* Runner de teste do repo: sem framework, sem dependência. `node test/run.mjs`.
   Um teste é uma função que lança quando falha — node:assert basta. */
const tests = [];
export function test(name, fn) { tests.push({ name, fn }); }

export async function run() {
  let ok = 0;
  const failures = [];
  for (const t of tests) {
    try { await t.fn(); ok += 1; process.stdout.write('.'); }
    catch (e) { failures.push({ name: t.name, error: e }); process.stdout.write('x'); }
  }
  process.stdout.write('\n\n');
  for (const f of failures) {
    console.error(`FALHOU: ${f.name}`);
    console.error(`  ${f.error && f.error.message}`);
    if (f.error && f.error.stack) console.error(f.error.stack.split('\n').slice(1, 3).join('\n'));
    console.error('');
  }
  console.log(`${ok} passaram, ${failures.length} falharam, ${tests.length} no total`);
  process.exit(failures.length ? 1 : 0);
}
