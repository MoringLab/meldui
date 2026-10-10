import { mkdir, writeFile } from "node:fs/promises";
import cases from "../../fixtures/showcase/cases.json" with { type: "json" };

// Actual isolated execution of the five reference apps; no model requests or benchmark.
const rows: { id: string; pass: boolean; before?: string; after?: string; error?: string }[] = [];
for (const fixture of cases.filter((c) => c.path === "C")) {
  const block = JSON.parse(fixture.wire.split("\n")[0]);
  const render = async (keys: string[]) => {
    const response = await fetch("http://127.0.0.1:8787/api/sandbox/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: block.mode,
        source: block.source,
        width: 640,
        height: 480,
        events: keys.map((key) => ({ type: "key", key })),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Error(`SANDBOX_HTTP_${response.status}`);
    return response.json();
  };
  try {
    const before = await render([]);
    const after = await render(
      fixture.id === "02"
        ? ["Tab", "ArrowRight"]
        : fixture.id === "11"
          ? ["Tab", "Tab", "Enter"]
          : ["Tab", "Enter"],
    );
    rows.push({
      id: fixture.id,
      pass:
        before.text !== after.text &&
        !before.consoleErrors.length &&
        !after.consoleErrors.length &&
        !before.violations.length &&
        !after.violations.length,
      before: before.text,
      after: after.text,
    });
  } catch (error) {
    rows.push({ id: fixture.id, pass: false, error: String(error) });
  }
}
await mkdir("artifacts/sandbox", { recursive: true });
await writeFile(
  "artifacts/sandbox/showcase.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      scope:
        "isolated reference apps, first control and changed readout; no scientific or generation-quality claim",
      rows,
    },
    null,
    2,
  ),
);
console.table(rows);
if (rows.length !== 5 || rows.some((r) => !r.pass)) process.exitCode = 1;
