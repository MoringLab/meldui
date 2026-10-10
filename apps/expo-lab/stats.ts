/** Nearest-rank percentiles over a sorted copy; every raw sample is kept by the caller. */
export function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)];
  const mean = sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1);
  return {
    samples: sorted.length,
    min: sorted[0],
    p50: at(0.5),
    p90: at(0.9),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1],
    mean,
    timingsMs: sorted,
  };
}

type HermesStats = Record<string, number>;
const hermes = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => HermesStats } })
  .HermesInternal;
/** Cumulative Hermes counters (GC count/time, heap), or null when the engine hides them. */
export function gcCounters(): {
  collections: number;
  cpuMs: number;
  wallMs: number;
  heapBytes: number;
  raw: Record<string, number>;
} | null {
  const stats = hermes?.getInstrumentedStats?.();
  if (!stats || typeof stats.js_numGCs !== "number") return null;
  return {
    collections: stats.js_numGCs,
    // Hermes reports these in seconds.
    cpuMs: (stats.js_gcCPUTime ?? 0) * 1000,
    wallMs: (stats.js_gcTime ?? 0) * 1000,
    heapBytes: stats.js_heapSize ?? stats.js_allocatedBytes ?? 0,
    raw: stats,
  };
}
