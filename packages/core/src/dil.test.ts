import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AnswerSession } from "./answer";
import { createUIRuntime } from "./index";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../../../docs/ChatGPT_DIL_EXAMPLE");
const samples = (() => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
})();

describe.runIf(samples.length)("DIL-style markup", () => {
  it.each(samples)("%s compiles without repairs", (file) => {
    const diags: { code?: string; message?: string }[] = [];
    const runtime = createUIRuntime({ onDiagnostic: (d: { code?: string; message?: string }) => diags.push(d) });
    const s = new AnswerSession(runtime, {});
    s.push(`샘플\n\n${readFileSync(join(dir, file), "utf8")}`);
    s.end();
    expect(s.getSnapshot().blocks.some((b) => b.kind === "surface")).toBe(true);
    // Repairs cost a prop; a formula that cannot run costs a part of the UI.
    // JavaScript helpers (fmt, padStart) are not part of the language: only their text is lost.
    const lost = diags.map((d) => `${d.code}: ${d.message}`).filter((m) => !/COMPONENT_REPAIRED|AsyncImage|Left out text/.test(m));
    expect(lost).toEqual([]);
    runtime.dispose();
  });
});
