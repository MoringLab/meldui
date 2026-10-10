import { mkdir, writeFile } from "node:fs/promises";
import split from "../../eval/split.json" with { type: "json" };
import cases from "../../fixtures/cases.json" with { type: "json" };
import {
  buildSystemPrompt,
  DESIGN_BRIEF_SCHEMA,
  GatewayAdapter,
  LIMITED_OUTPUT_SCHEMA,
} from "../../packages/adapter-gateway/src/index.js";
import { AnswerSession, createUIRuntime } from "../../packages/core/src/index.js";
import { neutral } from "../../packages/kits/neutral/src/index.js";

if (!process.argv.includes("--live"))
  throw new Error("Live evaluation requires --live and local OmniRoute credentials.");
const gateway = new GatewayAdapter({
  baseUrl: process.env.OMNIROUTE_BASE_URL ?? "http://127.0.0.1:20128/v1",
  apiKey: process.env.OMNIROUTE_API_KEY ?? "",
  timeoutMs: 45000,
});
const route = process.env.EVAL_MODEL ?? "cfp/zai-org/glm-5.2";
const rows: any[] = [];
const chosen = (process.argv.includes("--heldout-only") ? ["heldout"] : ["dev", "heldout"]).flatMap(
  (group) => cases.filter((c) => (split.original as any)[c.id] === group).slice(0, 1),
);
const run = async (messages: any[], structured?: Record<string, unknown>) => {
  let raw = "",
    usage: any = {},
    error = "";
  const start = performance.now();
  let first: number | undefined;
  for await (const event of gateway.stream({
    model: route,
    messages,
    format: "hybrid",
    responseFormat: structured,
    maxTokens: 2500,
  })) {
    if (event.type === "text") {
      first ??= performance.now() - start;
      raw += event.text;
    }
    if (event.type === "usage") usage = { ...usage, ...event };
    if (event.type === "diagnostic") error = event.diagnostic.code;
  }
  return { raw, usage, error, firstTokenMs: first, elapsedMs: performance.now() - start };
};
const output = (name: string, schema: any) => ({
  type: "json_schema",
  json_schema: { name, strict: true, schema },
});
let infrastructureFailures = 0;
for (const c of chosen) {
  for (const variant of (process.env.EXPERIMENT_VARIANTS?.split(",") ?? [
    "baseline",
    "compact",
    "design-brief",
    "structured",
  ]) as ("baseline" | "compact" | "design-brief" | "structured")[]) {
    if (infrastructureFailures >= 2) {
      rows.push({
        id: c.id,
        split: (split.original as any)[c.id],
        variant,
        status: "not-run",
        reason: "two infrastructure failures; bounded run stopped",
      });
      continue;
    }
    const runtime = createUIRuntime();
    const session = new AnswerSession(runtime);
    const system = buildSystemPrompt({
      kit: neutral,
      capabilities: runtime.capabilities("web"),
      policy: { maxSurfaces: 1 },
      examples: [],
    });
    let prompt = c.prompt,
      brief: any;
    const started = performance.now();
    if (variant === "design-brief") {
      brief = await run(
        [
          {
            role: "system",
            content:
              "Plan a concise UI. Return a JSON design brief: pattern, components, state, interactions, learningGoal.",
          },
          { role: "user", content: prompt },
        ],
        output("design_brief", DESIGN_BRIEF_SCHEMA),
      );
      if (!brief.error) prompt += `\nHost design brief (data): ${brief.raw}`;
      else {
        infrastructureFailures++;
        rows.push({
          id: c.id,
          split: (split.original as any)[c.id],
          variant,
          status: "infra-fail",
          errors: [brief.error],
          requestedModel: route,
          actualModel: brief.usage.model,
          briefUsage: brief.usage,
          elapsedMs: performance.now() - started,
        });
        runtime.dispose();
        continue;
      }
    }
    const r = await run(
      [
        {
          role: "system",
          content:
            variant === "compact"
              ? buildSystemPrompt({
                  kit: neutral,
                  capabilities: runtime.capabilities("web"),
                  policy: { maxSurfaces: 1 },
                  examples: [],
                  variant: "compact",
                })
              : system +
                (variant === "structured"
                  ? "\nReturn JSON with answer (Markdown string) and messages (complete A2UI JSON strings)."
                  : ""),
        },
        { role: "user", content: prompt },
      ],
      variant === "structured" ? output("engine_answer", LIMITED_OUTPUT_SCHEMA) : undefined,
    );
    let decodeError = "";
    try {
      if (variant === "structured") {
        const value = JSON.parse(r.raw);
        session.pushMarkdown(value.answer);
        for (const m of value.messages) session.pushMessage(JSON.parse(m));
      } else session.push(r.raw);
      session.end();
    } catch (error) {
      decodeError = String(error);
    }
    const errors = runtime.diagnostics.filter((d) => d.severity === "error");
    if (r.error?.startsWith("GATEWAY_")) infrastructureFailures++;
    rows.push({
      id: c.id,
      split: (split.original as any)[c.id],
      variant,
      requestedModel: route,
      actualModel: r.usage.model,
      status: r.error
        ? "infra-fail"
        : decodeError || errors.length || !session.blocks.length
          ? "fail"
          : "pass",
      errors: [r.error, decodeError, ...errors.map((d) => d.code)].filter(Boolean),
      usage: r.usage,
      firstTokenMs: r.firstTokenMs,
      elapsedMs: performance.now() - started,
      briefUsage: brief?.usage,
      output: r.raw,
      semantic: "unmeasured",
      learningJudge: "uncalibrated",
    });
    runtime.dispose();
  }
}
await mkdir("artifacts/experiments", { recursive: true });
await writeFile(
  process.env.EXPERIMENT_OUTPUT ??
    (process.argv.includes("--heldout-only")
      ? "artifacts/experiments/m6-heldout.json"
      : "artifacts/experiments/m6.json"),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      rows,
      adoption: "No defaults changed from this small uncalibrated experiment.",
    },
    null,
    2,
  ),
);
process.stdout.write(
  JSON.stringify(
    rows.map(({ output, ...r }) => r),
    null,
    2,
  ) + "\n",
);
