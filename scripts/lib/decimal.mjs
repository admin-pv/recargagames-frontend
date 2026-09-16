/* ──────────────────────────────────────────────────────────────────────────
   decimal.mjs — aritmética decimal exata para o pricing

   POR QUE EXISTE: o motor multiplica custo por markup, soma fee e divide
   por câmbio, e o resultado vira preço numa proposta comercial. Em ponto
   flutuante, 0.1 + 0.2 é 0.30000000000000004, e um encadeamento desses
   erros pode virar um centavo a menos numa linha que o parceiro confere
   na mão. O brief é explícito: nada de float acumulado.

   COMO: todo valor é um BigInt em escala fixa de 8 casas. 1 USD = 10^8.
   Multiplicação e divisão arredondam meio para cima NA ESCALA INTERNA,
   longe das 2 casas que aparecem na planilha, então nenhum arredondamento
   de exibição realimenta a conta seguinte.

   ARREDONDAMENTO DE EXIBIÇÃO: só em toFixed(), a única função que a
   planilha chama. É a "regra definida numa função única" do brief.
   ────────────────────────────────────────────────────────────────────── */

const SCALE = 8n;
const UNIT = 10n ** SCALE;

export class Dec {
  constructor(raw) { this.raw = raw; }          // raw = valor * 10^8, BigInt

  static zero() { return new Dec(0n); }

  /* Aceita string, number, bigint ou Dec. Number passa por String, que dá
     a representação decimal curta e exata do double ("0.02", não
     "0.020000000000000004"). Notação científica (1e-7) é normalizada por
     toFixed antes do parse — não acontece nas nossas ordens de grandeza,
     mas um NaN silencioso aqui viraria preço errado. */
  static from(value) {
    if (value instanceof Dec) return value;
    if (typeof value === 'bigint') return new Dec(value * UNIT);

    let s;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError(`Dec.from: número inválido (${value})`);
      s = Math.abs(value) < 1e-6 && value !== 0 ? value.toFixed(Number(SCALE)) : String(value);
      if (/e/i.test(s)) s = value.toFixed(Number(SCALE));
    } else {
      s = String(value ?? '').trim();
    }
    if (s === '') throw new TypeError('Dec.from: vazio');

    const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
    if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) {
      throw new TypeError(`Dec.from: não é decimal (${s})`);
    }
    const [, sign, intPart, fracPart = ''] = m;
    const frac = (fracPart + '0'.repeat(Number(SCALE))).slice(0, Number(SCALE));
    /* Casa além da 8ª é truncada, não arredondada: entrada com mais de 8
       decimais é dado de origem duvidosa, e truncar mantém a conta
       reproduzível. */
    const raw = BigInt(intPart || '0') * UNIT + BigInt(frac);
    return new Dec(sign === '-' ? -raw : raw);
  }

  add(other) { return new Dec(this.raw + Dec.from(other).raw); }
  sub(other) { return new Dec(this.raw - Dec.from(other).raw); }

  mul(other) { return new Dec(divRound(this.raw * Dec.from(other).raw, UNIT)); }

  div(other) {
    const d = Dec.from(other).raw;
    if (d === 0n) throw new RangeError('Dec.div: divisão por zero');
    return new Dec(divRound(this.raw * UNIT, d));
  }

  cmp(other) { const o = Dec.from(other).raw; return this.raw < o ? -1 : this.raw > o ? 1 : 0; }
  lt(other) { return this.cmp(other) < 0; }
  gt(other) { return this.cmp(other) > 0; }
  isZero() { return this.raw === 0n; }
  isNegative() { return this.raw < 0n; }
  abs() { return new Dec(this.raw < 0n ? -this.raw : this.raw); }

  /* A ÚNICA porta de arredondamento de exibição. Meio para cima em valor
     absoluto: 2.345 → "2.35", -2.345 → "-2.35". */
  toFixed(places = 2) {
    const p = BigInt(places);
    if (p < 0n || p > SCALE) throw new RangeError(`Dec.toFixed: ${places} fora de 0..${SCALE}`);
    const factor = 10n ** (SCALE - p);
    const rounded = divRound(this.raw, factor);
    const neg = rounded < 0n;
    const digits = (neg ? -rounded : rounded).toString().padStart(Number(p) + 1, '0');
    const int = digits.slice(0, digits.length - Number(p));
    const frac = digits.slice(digits.length - Number(p));
    return `${neg ? '-' : ''}${int}${frac ? '.' + frac : ''}`;
  }

  /* Para a célula do Excel, que guarda número. Sai JÁ arredondado nas
     casas pedidas: a planilha nunca recebe a escala interna de 8 casas. */
  toNumber(places = 2) { return Number(this.toFixed(places)); }

  toString() { return this.toFixed(Number(SCALE)).replace(/0+$/, '').replace(/\.$/, ''); }
}

/* Divisão inteira com arredondamento meio para cima em valor absoluto. */
function divRound(numerator, denominator) {
  const neg = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let q = n / d;
  if ((n % d) * 2n >= d) q += 1n;
  return neg ? -q : q;
}

export function dec(value) { return Dec.from(value); }
export const ZERO = Dec.zero();
