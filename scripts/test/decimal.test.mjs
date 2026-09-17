import assert from 'node:assert/strict';
import { test } from './harness.mjs';
import { dec } from '../lib/decimal.mjs';

test('decimal não acumula erro de float', () => {
  assert.equal(dec('0.1').add('0.2').toFixed(2), '0.30');
  let acc = dec(0);
  for (let i = 0; i < 100; i += 1) acc = acc.add('0.01');
  assert.equal(acc.toFixed(2), '1.00');
});

test('arredondamento de exibição é meio para cima', () => {
  assert.equal(dec('2.345').toFixed(2), '2.35');
  assert.equal(dec('2.344').toFixed(2), '2.34');
  assert.equal(dec('-2.345').toFixed(2), '-2.35');
  assert.equal(dec('0.005').toFixed(2), '0.01');
});

test('número vira decimal sem sujeira binária', () => {
  assert.equal(dec(0.02).toString(), '0.02');
  assert.equal(dec(29.26).mul(100).toFixed(0), '2926');   // o caso do float 2925.9999...
});

test('divisão arredonda na escala interna, não nas 2 casas', () => {
  const um_terco = dec(1).div(3);
  assert.equal(um_terco.mul(3).toFixed(2), '1.00');
});

test('entrada inválida estoura em vez de virar NaN', () => {
  assert.throws(() => dec('abc'));
  assert.throws(() => dec(''));
  assert.throws(() => dec(Infinity));
  assert.throws(() => dec(1).div(0));
});
