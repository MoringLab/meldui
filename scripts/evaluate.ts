import { mkdir, writeFile } from "node:fs/promises";
import fixtures from "../fixtures/cases.json";
import { createUIRuntime } from "../packages/core/src/index.js";

const results = fixtures.map((fixture) => {
  const runtime = createUIRuntime();
  const start = performance.now();
  for (const message of fixture.messages) runtime.accept(message);
  runtime.finish();
  const renderErrors = [...runtime.getSurface("main")!.componentsModel.values]
    .map((node) => runtime.getNodeSnapshot("main", node.id).error)
    .filter(Boolean);
  const interactions = fixture.interactions.every((step) => {
    runtime.setValue("main", step.path, step.value);
    return (
      JSON.stringify(runtime.getNodeSnapshot("main", step.node).props[step.prop]) ===
      JSON.stringify(step.expected)
    );
  });
  const result = {
    id: fixture.id,
    valid: !runtime.diagnostics.length && !renderErrors.length,
    interactions,
    processingMs: Math.round((performance.now() - start) * 100) / 100,
    diagnostics: runtime.diagnostics,
    renderErrors,
  };
  runtime.dispose();
  return result;
});
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/offline-eval.json",
  JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2),
);
console.table(
  results.map(({ id, valid, interactions, processingMs }) => ({
    id,
    valid,
    interactions,
    processingMs,
  })),
);
if (results.some((r) => !r.valid || !r.interactions)) process.exitCode = 1;
