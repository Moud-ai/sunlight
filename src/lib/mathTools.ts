/**
 * Math tools for Sunlight AI — precise calculations via math.js.
 *
 * Provides three tools: math_eval (expression evaluation), unit_convert
 * (unit conversion), and statistics (descriptive stats).
 */
import {create, all} from 'mathjs';

const math = create(all, {
  number: 'BigNumber',
  precision: 64,
});

// ---------------------------------------------------------------------------
// math_eval — evaluate mathematical expressions
// ---------------------------------------------------------------------------

/**
 * Evaluate a mathematical expression with arbitrary precision.
 * Supports: arithmetic, algebra, calculus, linear algebra, statistics.
 */
export function executeMathEval(expression: string): string {
  try {
    const result = math.evaluate(expression);
    // Format BigNumber results to avoid scientific notation noise
    if (typeof result === 'object' && result !== null && 'toString' in result) {
      const str = (result as {toString(): string}).toString();
      // If it's a matrix, format nicely
      if (Array.isArray(result)) {
        return JSON.stringify(result);
      }
      return str;
    }
    return String(result);
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : 'invalid expression'}`;
  }
}

// ---------------------------------------------------------------------------
// unit_convert — convert between units
// ---------------------------------------------------------------------------

/** Known unit aliases for non-math.js conversions */
const UNIT_ALIASES: Record<string, string> = {
  celsius: 'celsius',
  fahrenheit: 'fahrenheit',
  kelvin: 'kelvin',
  km: 'km',
  miles: 'mi',
  mi: 'mi',
  meters: 'm',
  m: 'm',
  cm: 'cm',
  mm: 'mm',
  ft: 'ft',
  feet: 'ft',
  inch: 'in',
  inches: 'in',
  in: 'in',
  yards: 'yd',
  yd: 'yd',
  kg: 'kg',
  grams: 'g',
  g: 'g',
  mg: 'mg',
  lbs: 'lb',
  lb: 'lb',
  pounds: 'lb',
  oz: 'oz',
  ounces: 'oz',
  tons: 't',
  t: 't',
  seconds: 's',
  s: 's',
  ms: 'ms',
  minutes: 'min',
  min: 'min',
  hours: 'h',
  h: 'h',
  days: 'd',
  d: 'd',
  liters: 'L',
  L: 'L',
  ml: 'mL',
  mL: 'mL',
  gallons: 'gal',
  gal: 'gal',
  bytes: 'B',
  B: 'B',
  kb: 'kB',
  kB: 'kB',
  mb: 'MB',
  MB: 'MB',
  gb: 'GB',
  GB: 'GB',
  tb: 'TB',
  TB: 'TB',
};

/** Currency conversion (approximate rates, updated periodically). */
const CURRENCY_RATES: Record<string, number> = {
  usd: 1,
  eur: 0.92,
  gbp: 0.79,
  jpy: 149.5,
  cny: 7.24,
  krw: 1330,
  brl: 4.97,
  mxn: 17.15,
  ars: 350,
  cop: 3950,
  clp: 880,
  pen: 3.72,
  inr: 83.1,
  cad: 1.36,
  aud: 1.53,
  chf: 0.88,
  czk: 22.5,
  pln: 4.02,
  sek: 10.45,
  nok: 10.65,
  dkk: 6.87,
  hkd: 7.82,
  sgd: 1.34,
  thb: 35.2,
  php: 56,
  idr: 15400,
  myr: 4.72,
  vnd: 24500,
  egp: 48.5,
  zar: 18.9,
  ngn: 1550,
  ke: 153,
  btc: 0.0000145,
};

/**
 * Convert a value between units.
 * Supports: temperature, distance, weight, volume, time, data, currency.
 */
export async function executeUnitConvert(
  value: string,
  from: string,
  to: string,
): Promise<string> {
  try {
    const num = parseFloat(value);
    if (isNaN(num)) {
      return 'Error: invalid number';
    }

    const fromLower = from.toLowerCase().trim();
    const toLower = to.toLowerCase().trim();

    // Currency conversion
    if (fromLower in CURRENCY_RATES && toLower in CURRENCY_RATES) {
      const inUsd = num / CURRENCY_RATES[fromLower];
      const result = inUsd * CURRENCY_RATES[toLower];
      return `${num} ${from} = ${result.toFixed(2)} ${to}`;
    }

    // Temperature (special case — not linear conversion)
    if (fromLower === 'celsius' || fromLower === 'fahrenheit' || fromLower === 'kelvin') {
      let celsius: number;
      if (fromLower === 'celsius') celsius = num;
      else if (fromLower === 'fahrenheit') celsius = (num - 32) * 5 / 9;
      else celsius = num - 273.15;

      let result: number;
      if (toLower === 'celsius') result = celsius;
      else if (toLower === 'fahrenheit') result = celsius * 9 / 5 + 32;
      else result = celsius + 273.15;

      return `${num} ${from} = ${result.toFixed(2)} ${to}`;
    }

    // Try math.js unit conversion
    const fromUnit = UNIT_ALIASES[fromLower] || fromLower;
    const toUnit = UNIT_ALIASES[toLower] || toLower;

    const result = math.evaluate(`${num} ${fromUnit} to ${toUnit}`);
    if (typeof result === 'object' && result !== null && 'toString' in result) {
      return `${num} ${from} = ${(result as {toString(): string}).toString()} ${to}`;
    }
    return `${num} ${from} = ${String(result)} ${to}`;
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : 'conversion failed'}`;
  }
}

// ---------------------------------------------------------------------------
// statistics — descriptive statistics
// ---------------------------------------------------------------------------

interface StatsResult {
  count: number;
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
  sum: number;
  q1?: number;
  q3?: number;
}

function computeStats(data: number[]): StatsResult {
  const sorted = [...data].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  const median =
    n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];

  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);

  const q1Idx = Math.floor(n * 0.25);
  const q3Idx = Math.floor(n * 0.75);

  return {
    count: n,
    mean: parseFloat(mean.toFixed(6)),
    median: parseFloat(median.toFixed(6)),
    std: parseFloat(std.toFixed(6)),
    min: sorted[0],
    max: sorted[n - 1],
    sum: parseFloat(sum.toFixed(6)),
    q1: sorted[q1Idx],
    q3: sorted[q3Idx],
  };
}

/**
 * Compute descriptive statistics for a dataset.
 */
export function executeStatistics(data: number[]): string {
  if (!Array.isArray(data) || data.length === 0) {
    return 'Error: provide a non-empty array of numbers';
  }
  if (data.some(d => typeof d !== 'number' || isNaN(d))) {
    return 'Error: all elements must be valid numbers';
  }

  const s = computeStats(data);
  return [
    `count: ${s.count}`,
    `mean: ${s.mean}`,
    `median: ${s.median}`,
    `std: ${s.std}`,
    `min: ${s.min}`,
    `max: ${s.max}`,
    `sum: ${s.sum}`,
    `q1: ${s.q1}`,
    `q3: ${s.q3}`,
  ].join(', ');
}
