import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import fixtures from "../../fixtures/cases.json";
import { parseCsvLine, readJson } from "./common.js";

/**
 * LLM judge for the learning rubric, run through OmniRoute. Requires --live and a server gateway key.
 * Output: artifacts/eval/judge.json. Scores are advisory until judge-compare.ts reports calibration.
 */
if (!process.argv.includes("--live")) {
  console.error("Refusing to call a model without --live.");
  process.exit(2);
}
const base = process.env.OMNIROUTE_BASE_URL ?? "http://127.0.0.1:20128/v1";
const key = process.env.OMNIROUTE_API_KEY;
if (!key) {
  console.error("OMNIROUTE_API_KEY is not set (see scripts/local/with-omniroute-key.py).");
  process.exit(2);
}
const model = process.argv.find((a) => a.startsWith("--model="))?.slice(8) ?? "auto/claude-sonnet";
const rubric = readJson("eval/rubric/learning.json");
const ids = (process.argv.find((a) => a.startsWith("--samples="))?.slice(10) ?? "").split(",").filter(Boolean);
const sheet = readFileSync("eval/human/rating-sheet.csv", "utf8").split("\n").slice(1).map((l) => parseCsvLine(l)[0]).filter(Boolean);
const samples = (ids.length ? ids : sheet).map((id) => fixtures.find((f) => f.id === id)).filter(Boolean) as typeof fixtures;
const results: unknown[] = [];
for (const f of samples) {
  const text = f.messages
    .flatMap((m: any) => m.updateComponents?.components ?? [])
    .map((c: any) => `${c.component}: ${JSON.stringify(Object.fromEntries(Object.entries(c).filter(([k]) => ["text", "title", "label", "caption", "code"].includes(k))))}`)
    .join("\n");
  const prompt = `You are grading an interactive learning surface against a rubric. Score each item 0, 1 or 2 using the anchors. Judge only what is present in the component text; do not infer. Reply with ONLY JSON: {"goal":n,"experiments":n,"observation":n,"formula":n,"check":n,"simplification":n,"rationale":"one sentence"}.\nRubric: ${JSON.stringify(rubric.items)}\n\nSurface components:\n${text}`;
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-OmniRoute-No-Cache": "true" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 400, temperature: 0 }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    results.push({ id: f.id, error: `GATEWAY_HTTP_${response.status}`, infra: true });
    continue;
  }
  const body = await response.json();
  const raw: string = body.choices?.[0]?.message?.content ?? "";
  let scores: unknown;
  try {
    scores = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    scores = undefined;
  }
  results.push({ id: f.id, requestedModel: model, actualModel: response.headers.get("x-omniroute-model") ?? body.model ?? null, scores, parseError: scores ? undefined : true });
}
mkdirSync("artifacts/eval", { recursive: true });
writeFileSync("artifacts/eval/judge.json", JSON.stringify({ timestamp: new Date().toISOString(), calibrated: false, results }, null, 1));
console.log(`Judged ${results.length} samples → artifacts/eval/judge.json (uncalibrated until judge-compare.ts)`);
