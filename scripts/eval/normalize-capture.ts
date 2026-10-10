import { readFile, writeFile } from "node:fs/promises";
import { normalizeAnswerWire } from "../../packages/adapter-gateway/src/quality.js";
import { AnswerSession, createUIRuntime } from "../../packages/core/src/index.js";

const capture = JSON.parse(await readFile("artifacts/eval/feature-smoke.json", "utf8")).rows.find(
  (r: any) => r.id === "media-left",
);
const wire = capture.events
  .filter((e: any) => e.type === "text")
  .map((e: any) => e.text)
  .join("");
const normalized = normalizeAnswerWire(wire, true),
  runtime = createUIRuntime();
for (const id of ["photo-a", "photo-b"])
  runtime.attachments.attach({ id, kind: "image", mime: "image/png", name: id, alt: id });
const answer = new AnswerSession(runtime, { policy: { maxSurfaces: 0 } });
answer.push(normalized.value);
answer.end();
const media = answer.blocks.find((b) => b.kind === "media");
const passed =
  media?.kind === "media" &&
  media.layout === "carousel" &&
  media.placement === "left" &&
  Boolean(media.markdown);
const result = {
  at: new Date().toISOString(),
  requestedModel: capture.requestedModel,
  actualModel: capture.actualModel,
  scope:
    "Offline normalization of captured real output; no new model request, not a quality-rate or latency claim",
  before: capture.status,
  after: passed ? "pass" : "fail",
  fixes: normalized.fixes,
  wire: normalized.value,
  blocks: answer.blocks,
  diagnostics: runtime.diagnostics,
};
await writeFile("artifacts/experiments/framing-capture.json", JSON.stringify(result, null, 2));
runtime.dispose();
if (!passed) throw Error("Captured carrier still failed validation");
console.log({ before: result.before, after: result.after, fixes: result.fixes });
