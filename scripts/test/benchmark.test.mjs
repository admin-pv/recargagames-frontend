import assert from 'node:assert/strict';
import { test } from './harness.mjs';
import { parseCsv, detectDialect, parseDecimal, formatCsv } from '../lib/csv.mjs';
import { validateRow, diffRows, dedupe, CSV_HEADER } from '../lib/benchmark.mjs';

const KNOWN = new Set(['FFLATAM100', 'MNCT1720', 'XBOXUSD10']);
const TODAY = '2026-09-16';
const CAB = CSV_HEADER.join(',');

function valida(linha, dialect) {
  const { rows, dialect: d } = parseCsv(`${CAB}\n${linha}`, dialect);
  return validateRow(rows[0], { knownGroups: KNOWN, dialect: dialect || d, today: TODAY });
}

/* ── Dialetos ─────────────────────────────────────────────────────────── */

test('detecta o dialeto do Excel pt-BR pelo cabeçalho', () => {
  assert.equal(detectDialect('group_code;market;official_price').delimiter, ';');
  assert.equal(detectDialect('group_code;market;official_price').decimal, ',');
  assert.equal(detectDialect('group_code,market,official_price').delimiter, ',');
});

test('o mesmo benchmark lido nos dois dialetos dá o mesmo número', () => {
  const padrao = valida('MNCT1720,AR,13900.50,ARS,TRUSTED,Oficial AR,2026-08-17');
  const ptbr = parseCsv('group_code;market;official_price;currency;qa_status;note;collected_at\nMNCT1720;AR;13900,50;ARS;TRUSTED;Oficial AR;2026-08-17');
  const ptbrRow = validateRow(ptbr.rows[0], { knownGroups: KNOWN, dialect: ptbr.dialect, today: TODAY });
  assert.equal(padrao.ok, true);
  assert.equal(ptbrRow.ok, true);
  assert.equal(padrao.row.official_price, '13900.50');
  assert.equal(ptbrRow.row.official_price, '13900.50');
});

test('aspas preservam vírgula e ponto e vírgula dentro da nota', () => {
  const { rows } = parseCsv(`${CAB}\nFFLATAM100,GLOBAL,0.99,USD,TRUSTED,"Promo 0,79; conferir",2026-08-17`);
  assert.equal(rows[0].note, 'Promo 0,79; conferir');
});

test('aspas duplas escapadas viram uma aspa', () => {
  const { rows } = parseCsv(`${CAB}\nFFLATAM100,GLOBAL,0.99,USD,TRUSTED,"pack ""100"" vs 110",2026-08-17`);
  assert.equal(rows[0].note, 'pack "100" vs 110');
});

test('BOM do Excel não estraga a primeira coluna', () => {
  const { rows } = parseCsv(`﻿${CAB}\nFFLATAM100,GLOBAL,0.99,USD,TRUSTED,,2026-08-17`);
  assert.equal(rows[0].group_code, 'FFLATAM100');
});

test('separador de milhar é recusado em vez de adivinhado', () => {
  assert.ok(parseDecimal('1.234,56', { decimal: ',' }).error);
  assert.ok(parseDecimal('1,234.56', { decimal: '.' }).error);
});

test('formatCsv põe aspas onde precisa e o round-trip volta igual', () => {
  const texto = formatCsv(CSV_HEADER, [{
    group_code: 'X1', market: 'AR', official_price: '10.5', currency: 'ARS',
    qa_status: 'TRUSTED', note: 'tem, vírgula e "aspas"', collected_at: '2026-08-17'
  }]);
  const { rows } = parseCsv(texto);
  assert.equal(rows[0].note, 'tem, vírgula e "aspas"');
});

/* ── Validação: cada erro bloqueia a LINHA, não o arquivo ─────────────── */

test('linha boa passa e normaliza market e currency para maiúscula', () => {
  const r = valida('FFLATAM100,global,0.99,usd,trusted,nota,2026-08-17');
  assert.equal(r.ok, true);
  assert.equal(r.row.market, 'GLOBAL');
  assert.equal(r.row.currency, 'USD');
  assert.equal(r.row.qa_status, 'TRUSTED');
});

test('group_code fora do snapshot e do DE>PARA é bloqueado como typo', () => {
  const r = valida('FFLATAM1OO,GLOBAL,0.99,USD,TRUSTED,,2026-08-17');   // letra O no lugar de zero
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /não existe no snapshot/);
});

test('qa_status fora do enum é bloqueado', () => {
  const r = valida('FFLATAM100,GLOBAL,0.99,USD,CONFIRMADO,,2026-08-17');
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /qa_status/);
});

test('moeda desconhecida é bloqueada', () => {
  const r = valida('FFLATAM100,GLOBAL,0.99,XYZ,TRUSTED,,2026-08-17');
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /currency/);
});

test('preço não numérico e preço zero ou negativo são bloqueados', () => {
  assert.equal(valida('FFLATAM100,GLOBAL,abc,USD,TRUSTED,,2026-08-17').ok, false);
  assert.equal(valida('FFLATAM100,GLOBAL,0,USD,TRUSTED,,2026-08-17').ok, false);
  assert.equal(valida('FFLATAM100,GLOBAL,-5,USD,TRUSTED,,2026-08-17').ok, false);
});

test('preço sem moeda é bloqueado aqui, não no meio do upsert', () => {
  const r = valida('FFLATAM100,GLOBAL,0.99,,TRUSTED,,2026-08-17');
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /moeda/);
});

test('sem preço E sem moeda é válido — é o caso do COLLECT', () => {
  const r = valida('FFLATAM100,GLOBAL,,,COLLECT,ainda pesquisando,2026-08-17');
  assert.equal(r.ok, true);
  assert.equal(r.row.official_price, null);
  assert.equal(r.row.currency, null);
});

test('collected_at vazio vira a data de hoje; formato errado é bloqueado', () => {
  assert.equal(valida('FFLATAM100,GLOBAL,0.99,USD,TRUSTED,,').row.collected_at, TODAY);
  assert.equal(valida('FFLATAM100,GLOBAL,0.99,USD,TRUSTED,,17/08/2026').ok, false);
});

test('uma linha ruim não derruba as boas do mesmo arquivo', () => {
  const texto = [CAB,
    'FFLATAM100,GLOBAL,0.99,USD,TRUSTED,,2026-08-17',
    'NAOEXISTE,GLOBAL,1.00,USD,TRUSTED,,2026-08-17',
    'MNCT1720,AR,13900,ARS,TRUSTED,,2026-08-17'].join('\n');
  const { rows, dialect } = parseCsv(texto);
  const res = rows.map((r) => validateRow(r, { knownGroups: KNOWN, dialect, today: TODAY }));
  assert.equal(res.filter((r) => r.ok).length, 2);
  assert.equal(res.filter((r) => !r.ok).length, 1);
  assert.equal(res.find((r) => !r.ok).line, 3, 'a linha reportada é a do arquivo, contando o cabeçalho');
});

/* ── Diff e dedupe ────────────────────────────────────────────────────── */

test('diff separa novo, alterado e igual', () => {
  const atual = [
    { group_code: 'FFLATAM100', market: 'GLOBAL', official_price: 0.99, currency: 'USD', qa_status: 'TRUSTED', note: null, collected_at: '2026-08-17' },
    { group_code: 'MNCT1720', market: 'AR', official_price: 13900, currency: 'ARS', qa_status: 'TRUSTED', note: null, collected_at: '2026-08-17' }
  ];
  const novas = [
    { group_code: 'FFLATAM100', market: 'GLOBAL', official_price: '1.09', currency: 'USD', qa_status: 'TRUSTED', note: null, collected_at: '2026-09-16' },
    { group_code: 'MNCT1720', market: 'AR', official_price: '13900.0', currency: 'ARS', qa_status: 'TRUSTED', note: null, collected_at: '2026-08-17' },
    { group_code: 'XBOXUSD10', market: 'GLOBAL', official_price: '10', currency: 'USD', qa_status: 'VERIFY', note: null, collected_at: '2026-09-16' }
  ];
  const { novo, alterado, igual } = diffRows(novas, atual);
  assert.equal(novo.length, 1);
  assert.equal(novo[0].row.group_code, 'XBOXUSD10');
  assert.equal(alterado.length, 1);
  assert.deepEqual(alterado[0].changes.map((c) => c.field).sort(), ['collected_at', 'official_price']);
  assert.equal(igual.length, 1, '13900 e "13900.0" são o mesmo número');
});

test('linha repetida no arquivo não derruba o upsert: vence a última', () => {
  const linhas = [
    { line: 2, row: { group_code: 'A', market: 'AR', official_price: '1' } },
    { line: 5, row: { group_code: 'A', market: 'AR', official_price: '2' } }
  ];
  const { rows, duplicadas } = dedupe(linhas);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].row.official_price, '2');
  assert.equal(duplicadas.length, 1);
});
