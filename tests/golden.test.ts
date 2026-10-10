import { describe, expect, it } from "vitest";
import {
  compoundFutureValue,
  dutchShares,
  montyHall,
  mulberry32,
  normalCdf,
  normalPdf,
  sirRun,
  weightedShares,
} from "../scripts/eval/golden.js";

describe("golden calculators", () => {
  it("compound interest matches known values", () => {
    expect(compoundFutureValue(1000, 10, 2)).toBeCloseTo(1210, 6);
    expect(compoundFutureValue(1000, 12, 1, 12)).toBeCloseTo(1126.8250301, 5);
    expect(compoundFutureValue(0, 6, 1, 12, 100)).toBeCloseTo(1233.556, 3);
  });
  it("dutch shares always sum to the total", () => {
    for (const [total, n] of [
      [168000, 4],
      [100001, 3],
      [10, 7],
      [1, 5],
    ] as const)
      expect(dutchShares(total, n).reduce((a, b) => a + b, 0)).toBe(total);
    expect(weightedShares(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(weightedShares(99.99, [2, 3, 5], 0.01).reduce((a, b) => a + b, 0)).toBeCloseTo(99.99, 8);
  });
  it("normal distribution matches tabulated values", () => {
    expect(normalPdf(0)).toBeCloseTo(0.3989423, 6);
    expect(normalPdf(1)).toBeCloseTo(0.2419707, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021, 5);
    expect(normalCdf(0, 5, 2)).toBeCloseTo(0.0062097, 5);
  });
  it("monty hall with a fixed seed is reproducible and near 1/3 vs 2/3", () => {
    const a = montyHall(20000, 7);
    expect(montyHall(20000, 7)).toEqual(a);
    expect(a.stay).toBeCloseTo(1 / 3, 1);
    expect(Math.abs(a.stay - 1 / 3)).toBeLessThan(0.01);
    expect(Math.abs(a.swap - 2 / 3)).toBeLessThan(0.01);
    expect(a.stay + a.swap).toBeCloseTo(1, 12);
  });
  it("SIR conserves the population", () => {
    const run = sirRun({ s: 990, i: 10, r: 0 }, 0.4, 0.1, 200);
    for (const p of run) expect(p.s + p.i + p.r).toBeCloseTo(1000, 8);
    expect(Math.max(...run.map((p) => p.i))).toBeGreaterThan(10);
  });
  it("rng is deterministic", () => {
    const [a, b] = [mulberry32(1), mulberry32(1)];
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
