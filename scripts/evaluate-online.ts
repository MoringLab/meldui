import { mkdir, writeFile } from "node:fs/promises";
import fixtures from "../fixtures/cases.json";
import { createUIRuntime } from "../packages/core/src/index.js";

const base = process.env.ENGINE_SERVER_URL ?? "http://127.0.0.1:8787";
const { models } = (await fetch(`${base}/api/models`).then((r) => r.json())) as {
  models: string[];
};
const jobs = models.flatMap((model) => [
  ...fixtures.map((fixture) => ({ model, fixture, kitId: "neutral" })),
  ...fixtures.slice(0, 6).map((fixture) => ({ model, fixture, kitId: "editorial" })),
]);
const results: any[] = [];
await mkdir("artifacts", { recursive: true });
let cursor = 0;
async function worker() {
  while (cursor < jobs.length) {
    const { model, fixture, kitId } = jobs[cursor++];
    const runtime = createUIRuntime();
    const start = performance.now();
    let sessionId = "";
    let firstMessageMs: number | undefined;
    let repairs = 0;
    let status = "failed";
    let outputBytes = 0;
    let actualModel: string | undefined;
    const errors: string[] = [];
    let initialValid = true;
    let messageCount = 0;
    try {
      const response = await fetch(`${base}/api/ui`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, kitId, prompt: fixture.prompt, platform: "web" }),
        signal: AbortSignal.timeout(360000),
      });
      if (!response.ok) throw Error(`HTTP_${response.status}`);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        outputBytes += value.byteLength;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "session") sessionId = event.sessionId;
          if (event.type === "message") {
            firstMessageMs ??= performance.now() - start;
            messageCount++;
            runtime.accept(event.message);
          }
          if (event.type === "diagnostic") {
            errors.push(event.diagnostic.code);
            if (!repairs && event.diagnostic.severity === "error") initialValid = false;
          }
          if (event.type === "repair") repairs = event.attempt;
          if (event.type === "usage" && event.model) actualModel = event.model;
          if (event.type === "complete") status = event.status;
        }
      }
      runtime.finish();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "ERROR");
      initialValid = false;
    }
    const finalErrors = runtime.surfaceIds.flatMap((sid) =>
      [...runtime.getSurface(sid)!.componentsModel.values]
        .map((node) => runtime.getNodeSnapshot(sid, node.id).error)
        .filter(Boolean),
    );
    const valid =
      status === "completed" &&
      messageCount > 0 &&
      runtime.surfaceIds.length > 0 &&
      runtime.surfaceIds.every((sid) => runtime.getSurface(sid)!.componentsModel.has("root")) &&
      !finalErrors.length;
    const result = {
      id: fixture.id,
      model,
      actualModel: actualModel ?? null,
      kitId,
      initialValid: initialValid && repairs === 0 && valid,
      valid,
      status,
      repairs,
      firstMessageMs,
      elapsedMs: performance.now() - start,
      outputBytes,
      messageCount,
      errors,
      finalErrors,
    };
    results.push(result);
    console.log(
      `${results.length}/${jobs.length} ${model} ${kitId} ${fixture.id}: ${valid ? "PASS" : "FAIL"} (${repairs} repairs)`,
    );
    runtime.dispose();
    if (sessionId) await fetch(`${base}/api/sessions/${sessionId}`, { method: "DELETE" });
    await writeFile(
      "artifacts/online-eval.json",
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          scope:
            "Structural validity and resolvable expressions; semantic UX requires separate review.",
          results,
        },
        null,
        2,
      ),
    );
  }
}
await Promise.all([worker(), worker(), worker()]);
