import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import fixtures from "../../fixtures/cases.json";
import { createUIRuntime } from "../../packages/core/src/index.js";
import { evaluateAdvanced } from "./advanced.js";
import { type Row, readJson, split, summarize } from "./common.js";
import { evaluateContent } from "./content.js";
import { dutchShares } from "./golden.js";

const rows: Row[] = [...(await evaluateContent()), ...evaluateAdvanced()];
const node = (runtime: ReturnType<typeof createUIRuntime>, id: string) =>
  runtime.getNodeSnapshot("main", id);

// ── Layer 1: structural (replay fixtures, both interaction and render errors) ──────────────
for (const fixture of fixtures) {
  const runtime = createUIRuntime();
  const start = performance.now();
  for (const message of fixture.messages) runtime.accept(message as any);
  runtime.finish();
  const renderErrors = [...runtime.getSurface("main")!.componentsModel.values]
    .map((n) => node(runtime, n.id).error)
    .filter(Boolean);
  const interactions = fixture.interactions.every((step) => {
    runtime.setValue("main", step.path, step.value as never);
    return (
      JSON.stringify(node(runtime, step.node).props[step.prop]) === JSON.stringify(step.expected)
    );
  });
  rows.push({
    layer: "structural",
    id: fixture.id,
    split: split("original", fixture.id),
    status: !runtime.diagnostics.length && !renderErrors.length && interactions ? "pass" : "fail",
    detail: `${(performance.now() - start).toFixed(1)}ms`,
  });
  runtime.dispose();
}

// ── Layer 2: numeric correctness against independent golden calculators ─────────────────────
const calc: Record<string, (a: number, b: number) => number> = {
  calculator: (a, b) => Math.round((a / b) * 100) / 100,
  "trip-budget": (a, b) => a * b,
  "study-time": (a, b) => a * b,
  "unit-price": (a, b) => Math.round((a / b) * 100) / 100,
  "remaining-budget": (a, b) => a - b,
};
for (const [id, golden] of Object.entries(calc)) {
  const fixture = fixtures.find((f) => f.id === id)!;
  const runtime = createUIRuntime();
  for (const message of fixture.messages) runtime.accept(message as any);
  runtime.finish();
  let bad = "";
  for (const [a, b] of [
    [168000, 4],
    [100000, 3],
    [1000, 7],
    [42, 2],
    [0, 5],
  ]) {
    runtime.setValue("main", "/a", a as never);
    runtime.setValue("main", "/b", b as never);
    const got = Number(node(runtime, "_result").props.text);
    if (Math.abs(got - golden(a, b)) > 1e-9)
      bad = `a=${a} b=${b}: got ${got}, want ${golden(a, b)}`;
  }
  rows.push({
    layer: "numeric",
    id,
    status: bad ? "fail" : "pass",
    detail: bad || "5 input pairs match",
  });
  runtime.dispose();
}
const shareSum = dutchShares(168000, 4).reduce((a, b) => a + b, 0) === 168000;
rows.push({ layer: "numeric", id: "golden:dutch-sum", status: shareSum ? "pass" : "fail" });
// ── Layer 4: learning-content rubric, structural proxy (the LLM judge covers meaning) ──────
const rubric = readJson("eval/rubric/learning.json");
function proxyScore(components: any[]) {
  const text = (c: any) => (typeof c.text === "string" ? c.text : "");
  const all = components.map((c) => `${c.title ?? ""} ${text(c)} ${c.label ?? ""}`).join("\n");
  const byKind = (k: string) => components.filter((c) => c.component === k);
  const root = components.find((c) => c.id === "root");
  const first = (root?.children ?? []).map((id: string) => components.find((c) => c.id === id));
  return {
    goal:
      first[0]?.component === "Heading" &&
      first[1]?.component === "Text" &&
      text(first[1]).length <= 140
        ? 2
        : 0,
    experiments: /try|해보|바꿔|조절|드래그|움직/i.test(all) ? 1 : 0,
    observation: byKind("Callout").some((c) =>
      /notice|관찰|확인|알 수|보이/i.test(`${c.title}${c.text}`),
    )
      ? 2
      : 0,
    formula: byKind("CodeBlock").length || /[=＝]/.test(all) ? 1 : 0,
    check: byKind("Quiz").length ? 2 : 0,
    simplification: /simplif|단순|예시|가정|assum/i.test(all) ? 1 : 0,
  };
}
const learningTargets = fixtures.filter((f) =>
  ["explanation", "dashboard", "game"].includes(f.category),
);
for (const fixture of learningTargets) {
  const comps = fixture.messages.flatMap((m: any) => m.updateComponents?.components ?? []);
  const s = proxyScore(comps);
  const total = Object.values(s).reduce((a, b) => a + b, 0);
  const pass =
    total >= rubric.pass.total && Object.values(s).every((v) => v >= rubric.pass.minEachItem);
  rows.push({
    layer: "learning-proxy",
    id: fixture.id,
    split: split("original", fixture.id),
    status: pass ? "pass" : "fail",
    value: total,
    detail: JSON.stringify(s),
  });
}

// Generated semantic results remain separate from hand-authored replays.
rows.push({
  layer: "safety-injection",
  id: "live-model-injection",
  status: "not-run",
  detail:
    "metadata/quoted prompt controls tested; no claim of an adversarial live-model success rate",
});
for (const set of ["routing", "multiturn"])
  for (const item of readJson<any[]>(`eval/${set}.json`))
    rows.push({
      layer: set,
      id: item.id,
      split: split(set, item.id),
      status: "not-run",
      detail: "host contract exists; this row requires a captured live/replay behavior result",
    });
for (const item of readJson<any[]>("eval/media.json"))
  rows.push({
    layer: "media",
    id: item.id,
    split: split("media", item.id),
    status: "not-run",
    detail: "media display exists; generated answer quality requires live eval",
  });
for (const item of readJson<any[]>("eval/showcase.json"))
  rows.push({
    layer: "showcase",
    id: item.id,
    split: split("showcase", item.id),
    status: "not-run",
    detail: `${item.key}: replay implemented; generated semantic/human acceptance remains separate.`,
  });

// ── Browser layers: layout and behavior (Playwright) ────────────────────────────────────────
let browserRun: "not-run" | "completed" | "failed" = "not-run";
if (!process.argv.includes("--no-browser")) {
  const run = spawnSync("pnpm", ["exec", "playwright", "test", "-c", "playwright.eval.config.ts"], {
    stdio: "inherit",
    // The exhaustive layout/axe matrix has its own 10-minute test deadline.
    timeout: 630_000,
  });
  browserRun = run.status === 0 ? "completed" : "failed";
  if (run.status !== 0) {
    console.error(
      "Browser evaluation did not complete:",
      run.error?.message ?? run.signal ?? run.status,
    );
    process.exitCode = 1;
  }
}
if (browserRun !== "failed" && existsSync("artifacts/eval/layout.json")) {
  const layout = readJson("artifacts/eval/layout.json").rows as any[];
  for (const fixture of fixtures) {
    const mine = layout.filter((r) => r.fixture === fixture.id);
    if (!mine.length) continue;
    const bad = (key: string) =>
      mine.filter((r) => (Array.isArray(r[key]) ? r[key].length : r[key])).length;
    for (const [id, key] of [
      ["overflow", "overflow"],
      ["touch-44", "smallTargets"],
      ["contrast", "contrast"],
      ["first-paint", "firstPaintEmpty"],
    ] as const) {
      const n = bad(key);
      rows.push({
        layer: `layout:${id}`,
        id: fixture.id,
        split: split("original", fixture.id),
        status: n ? "fail" : "pass",
        detail: n ? `${n}/${mine.length} configs` : `${mine.length} configs`,
      });
    }
  }
}
if (browserRun !== "failed" && existsSync("artifacts/eval/behavior.json"))
  for (const r of readJson("artifacts/eval/behavior.json").rows as any[])
    rows.push({
      layer: `behavior:${r.check}`,
      id: r.fixture,
      split: split("original", r.fixture),
      status: r.status,
      unlockedBy: r.unlockedBy,
      detail: r.detail,
    });

await mkdir("artifacts/eval", { recursive: true });
const layers = [...new Set(rows.map((r) => r.layer))];
const summary = Object.fromEntries(
  layers.map((layer) => [layer, summarize(rows.filter((r) => r.layer === layer))]),
);
await writeFile(
  "artifacts/eval/offline.json",
  JSON.stringify({ timestamp: new Date().toISOString(), browserRun, summary, rows }, null, 1),
);
console.table(summary);
const hardFail = rows.filter(
  (r) => r.status === "fail" && ["structural", "numeric"].includes(r.layer),
);
if (hardFail.length) {
  console.error(hardFail);
  process.exitCode = 1;
}
