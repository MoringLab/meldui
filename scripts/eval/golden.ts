/** Independent reference calculations. They share no code with the engine's expression runtime. */

export const compoundFutureValue = (
  principal: number,
  ratePct: number,
  years: number,
  perYear = 1,
  monthly = 0,
) => {
  // Closed form for the lump sum plus end-of-period contributions at the same compounding frequency.
  const r = ratePct / 100 / perYear;
  const n = Math.round(years * perYear);
  const lump = principal * (1 + r) ** n;
  const annuity = r === 0 ? monthly * n : monthly * (((1 + r) ** n - 1) / r);
  return lump + annuity;
};

/** Even split with the remainder distributed one unit at a time so shares sum exactly to the total. */
export const dutchShares = (total: number, people: number, unit = 1) => {
  const units = Math.round(total / unit);
  const base = Math.floor(units / people);
  const extra = units - base * people;
  return Array.from({ length: people }, (_, i) => (base + (i < extra ? 1 : 0)) * unit);
};
/** Weighted split; the largest remainders absorb leftover units. */
export const weightedShares = (total: number, weights: number[], unit = 1) => {
  const units = Math.round(total / unit);
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (units * w) / sum);
  const floor = raw.map(Math.floor);
  let left = units - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) if (left-- > 0) floor[i]++;
  return floor.map((v) => v * unit);
};

export const normalPdf = (x: number, mean = 0, sd = 1) =>
  Math.exp(-0.5 * ((x - mean) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
/** Abramowitz–Stegun 7.1.26 erf, |error| < 1.5e-7. */
const erf = (x: number) => {
  const s = Math.sign(x);
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return s * y;
};
export const normalCdf = (x: number, mean = 0, sd = 1) =>
  0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));

/** 32-bit deterministic generator. Same algorithm the engine's seeded RNG must use (ADR in M8). */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function montyHall(trials: number, seed: number) {
  const rand = mulberry32(seed);
  let stay = 0;
  let swap = 0;
  for (let i = 0; i < trials; i++) {
    const car = Math.floor(rand() * 3);
    const pick = Math.floor(rand() * 3);
    if (pick === car) stay++;
    else swap++; // the host removes the only other goat, so swapping wins iff the first pick was wrong
  }
  return { stay: stay / trials, swap: swap / trials };
}

export type Sir = { s: number; i: number; r: number };
export function sirStep({ s, i, r }: Sir, beta: number, gamma: number, dt = 1): Sir {
  const n = s + i + r;
  const newInf = (beta * s * i * dt) / n;
  const newRec = gamma * i * dt;
  return { s: s - newInf, i: i + newInf - newRec, r: r + newRec };
}
export function sirRun(init: Sir, beta: number, gamma: number, steps: number, dt = 1) {
  const out = [init];
  for (let k = 0; k < steps; k++) out.push(sirStep(out[k], beta, gamma, dt));
  return out;
}
