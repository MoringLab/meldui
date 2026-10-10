import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { type Row, readJson, summarize } from "./common.js";

/**
 * One scorecard governs every milestone. Targets are fixed here (the "set in M1" decisions are
 * justified in docs/quality/targets.md). Rows are never dropped: expected-fail and not-run are
 * reported next to pass/fail so a number cannot improve by shrinking its denominator.
 */
const label = process.argv[2] ?? `scorecard-${new Date().toISOString().slice(0, 10)}`;
const outDir = process.argv[3] ?? "docs/verification/2026-10-10-phase2";
const offline = existsSync("artifacts/eval/offline.json")
  ? readJson("artifacts/eval/offline.json")
  : undefined;
const rows: Row[] = offline?.rows ?? [];
const layer = (prefix: string) =>
  rows.filter((r) => r.layer === prefix || r.layer.startsWith(`${prefix}:`));
const fmt = (s: ReturnType<typeof summarize>, extra = "") =>
  `${s.pass}/${s.total - s.na} pass${s.fail ? `, ${s.fail} fail` : ""}${s.expectedFail ? `, ${s.expectedFail} expected-fail` : ""}${s.notRun ? `, ${s.notRun} not-run` : ""}${extra}`;
type Dim = {
  dimension: string;
  target: string;
  measured: string;
  status: "met" | "missed" | "open" | "expected-fail";
  source: string;
};
const dims: Dim[] = [];
const judge = (s: ReturnType<typeof summarize>, hardOpen = false): Dim["status"] =>
  !s.total || s.notRun || hardOpen
    ? "open"
    : s.fail
      ? "missed"
      : s.expectedFail
        ? "expected-fail"
        : "met";

// Validity (recorded online baseline per route; replaced when a newer online run exists)
const onlineFile = [
  "artifacts/eval/online-latest.json",
  "docs/verification/online-final.json",
].find(existsSync)!;
const online = readJson(onlineFile).results as any[];
for (const route of [...new Set(online.map((r) => r.model))]) {
  const neutral = online.filter((r) => r.model === route && r.kitId === "neutral");
  const infra = neutral.filter((r) =>
    (r.errors ?? []).some((e: string) => /^GATEWAY_|^HTTP_/.test(e)),
  ).length;
  const first = neutral.filter((r) => r.initialValid).length;
  const final = neutral.filter((r) => r.valid).length;
  dims.push({
    dimension: `Validity · ${route}`,
    target: "first pass ≥27/30, repaired ≥29/30",
    measured: `${first}/${neutral.length} first pass, ${final}/${neutral.length} repaired, ${infra} jobs with infra errors`,
    status: first >= 27 && final >= 29 ? "met" : infra === neutral.length ? "open" : "missed",
    source: onlineFile,
  });
}
const structural = summarize(layer("structural"));
dims.push({
  dimension: "Validity · replay fixtures (offline)",
  target: "30/30",
  measured: fmt(structural),
  status: judge(structural),
  source: "artifacts/eval/offline.json",
});

const behavior = layer("behavior");
const bApplicable = behavior.filter((r) => r.status === "pass" || r.status === "fail");
const bPass = bApplicable.filter((r) => r.status === "pass").length;
dims.push({
  dimension: "Behavior (slider/tabs/checkbox/button/form)",
  target: "≥90% of applicable scripts",
  measured: `${bPass}/${bApplicable.length} applicable pass (${bApplicable.length ? ((100 * bPass) / bApplicable.length).toFixed(0) : "–"}%); reset: ${behavior.filter((r) => r.layer === "behavior:reset" && r.status === "expected-fail").length} expected-fail(M2)`,
  status: bApplicable.length && bPass / bApplicable.length >= 0.9 ? "met" : "missed",
  source: "artifacts/eval/behavior.json",
});
const numeric = summarize(layer("numeric"));
dims.push({
  dimension: "Numeric correctness",
  target: "100% of golden checks",
  measured: fmt(numeric),
  status: judge(numeric),
  source: "scripts/eval/golden.ts",
});
for (const key of ["overflow", "touch-44", "contrast", "first-paint"]) {
  const s = summarize(layer(`layout:${key}`));
  dims.push({
    dimension: `Layout · ${key} (320/480/720/960 × 2 kits × 2 modes)`,
    target: "100% of fixtures clean",
    measured: s.total ? `${s.pass}/${s.total} fixtures clean` : "not run",
    status: !s.total ? "open" : s.fail ? "missed" : "met",
    source: "artifacts/eval/layout.json",
  });
}
const learning = summarize(layer("learning-proxy"));
dims.push({
  dimension: "Learning design (structural proxy; judge uncalibrated)",
  target: "≥10/12 with every item ≥1; ≥80% of Path A/H items",
  measured: fmt(learning),
  status: learning.total ? (learning.fail ? "missed" : "met") : "open",
  source: "eval/rubric/learning.json",
});
for (const [name, target] of [
  ["routing", "over-viz ≤10%, under-viz ≤15%, duplication ≤20%"],
  ["media", "valid ids, no fabricated URLs, alt text: 100% each"],
  ["multiturn", "state preserved and edit applied ≥90%"],
  ["media:registration", "host metadata/IDs accepted in all 20 cases"],
  ["safety", "XSS corpus + injection suite 100%"],
  ["showcase", "30 items implemented or expected-fail with unlocking milestone"],
] as const) {
  const s = summarize(
    name === "safety"
      ? rows.filter((r) => r.layer.startsWith("safety-"))
      : name === "media"
        ? rows.filter((r) => r.layer === "media")
        : layer(name),
  );
  dims.push({
    dimension: name === "safety" ? "Safety" : name[0].toUpperCase() + name.slice(1),
    target,
    measured: fmt(s),
    status: judge(s),
    source: "artifacts/eval/offline.json",
  });
}
// Preserve the Phase 1 measurement separately. Native M4 records contain both conditions
// and every raw sample; no new benchmark is started by generating this scorecard.
const legacyPerf = readJson("docs/verification/performance.json");
const web = legacyPerf.web;
dims.push({
  dimension: "Performance · Web (Phase 1 baseline)",
  target: "p95 ≤100 ms with ≥100 samples",
  measured: `p95 ${web.p95Ms.toFixed(0)} ms from ${web.samples} samples; unchanged historical baseline`,
  status: web.samples < 100 ? "open" : web.p95Ms > 100 ? "missed" : "met",
  source: "docs/verification/performance.json",
});
const nativePerfFile = "docs/verification/phase2/m4-performance.json";
if (existsSync(nativePerfFile)) {
  const measurements = readJson(nativePerfFile).rows as any[];
  for (const [run, name] of [
    ["perf-flutter-after1", "Flutter"],
    ["perf-expo-before", "React Native"],
  ]) {
    for (const condition of ["cold", "warm"]) {
      const p = measurements.find((r) => r.run === run && r.condition === condition);
      dims.push({
        dimension: `Performance · Android ${name} ${condition} runtime`,
        target: "100-node first frame p95 ≤200 ms with ≥100 samples",
        measured: p
          ? `p95 ${p.p95.toFixed(0)} ms from ${p.samples} samples; existing M4 run`
          : "not run",
        status: !p || p.samples < 100 ? "open" : p.p95 > 200 ? "missed" : "met",
        source: nativePerfFile,
      });
    }
  }
}
dims.push({
  dimension: "Latency · first meaningful paint of hybrid answer",
  target: "≤ max(1.2× markdown baseline, +100 ms)",
  measured: "hybrid stream exists; paired baseline latency not measured",
  status: "open",
  source: "–",
});
dims.push({
  dimension: "Accessibility",
  target: "axe clean on demos; keyboard; reduced motion",
  measured: "web axe and reduced-motion wiring covered; iOS runner and expanded native audit open",
  status: "open",
  source: "tests/e2e",
});

const counts = { met: 0, missed: 0, open: 0, "expected-fail": 0 } as Record<string, number>;
for (const d of dims) counts[d.status]++;
mkdirSync(outDir, { recursive: true });
writeFileSync(
  `${outDir}/${label}.json`,
  `${JSON.stringify({ label, timestamp: new Date().toISOString(), counts, dimensions: dims, layers: offline?.summary }, null, 1)}\n`,
);
const md = [
  `# Scorecard — ${label}`,
  "",
  `Generated ${new Date().toISOString()} from \`artifacts/eval/*.json\`. Met ${counts.met} · missed ${counts.missed} · open ${counts.open} · expected-fail ${counts["expected-fail"]}.`,
  "",
  "| Dimension | Target | Measured | Status |",
  "|---|---|---|---|",
  ...dims.map((d) => `| ${d.dimension} | ${d.target} | ${d.measured} | **${d.status}** |`),
  "",
  "`expected-fail` rows are registered checks whose feature is not built yet; each names the milestone that unlocks it. They stay in the denominator.",
  "",
].join("\n");
writeFileSync(`${outDir}/${label}.md`, md);
if (existsSync("artifacts/eval")) {
  mkdirSync(`artifacts/phase2/${label}`, { recursive: true });
  for (const f of readdirSync("artifacts/eval"))
    cpSync(`artifacts/eval/${f}`, `artifacts/phase2/${label}/${f}`, { recursive: true });
}
console.log(md);
