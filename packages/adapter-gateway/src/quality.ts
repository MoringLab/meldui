import { assertSafeJson } from "@engine/core";
import {
  type ComponentName,
  ControlLineSchema,
  componentSchemas,
  redactContent,
} from "@engine/protocol";
/** Opt-in framing repair; ordinary JSON examples and unknown protocols remain literal Markdown. */
export function normalizeAnswerWire(wire: string, enabled = false) {
  const fixes: { rule: string; count: number }[] = [];
  if (!enabled || wire.length > 256 * 1024) return { value: wire, fixes };
  const value = wire.replace(
    /^```(?:json|a2ui)?[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm,
    (original, content) => {
      try {
        const parsed = JSON.parse(content);
        assertSafeJson(parsed);
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        if (
          !messages.length ||
          !messages.every((message) => ControlLineSchema.safeParse(message).success)
        )
          return original;
        fixes.push({ rule: "fenced-control", count: messages.length });
        return messages.map((message) => JSON.stringify(message)).join("\n");
      } catch {
        return original;
      }
    },
  );
  return { value, fixes };
}
export type ModelProfile = {
  promptVariant: "standard" | "compact";
  normalization: "off" | "safe";
  repairBudget: 0 | 1 | 2;
  designBrief: boolean;
};
export const DEFAULT_PROFILE: ModelProfile = {
  promptVariant: "standard",
  normalization: "off",
  repairBudget: 2,
  designBrief: false,
};
export function modelProfile(route: string, profiles: Record<string, Partial<ModelProfile>> = {}) {
  return { ...DEFAULT_PROFILE, ...profiles[route] };
}
/** Only documented, ambiguity-free aliases and scalar conversions. Every correction is counted. */
export function normalizeMessage(message: unknown, enabled = false) {
  const fixes: { path: string; rule: string }[] = [];
  const value = structuredClone(message) as any;
  if (!enabled) return { value, fixes };
  const aliases: Record<string, string> = {
    Paragraph: "Text",
    Label: "Text",
    Input: "TextField",
    Range: "Slider",
  };
  for (const [i, c] of (value?.updateComponents?.components ?? []).entries()) {
    if (aliases[c.component]) {
      c.component = aliases[c.component];
      fixes.push({ path: `/updateComponents/components/${i}/component`, rule: "component-alias" });
    }
    const schema = componentSchemas[c.component as ComponentName];
    if (!schema) continue;
    const keys = ["min", "max", "step", "columns"].filter(
      (key) => typeof c[key] === "string" && /^-?\d+(?:\.\d+)?$/.test(c[key]),
    );
    const candidate = { ...c };
    for (const key of keys) candidate[key] = Number(c[key]);
    const { id: _, component: __, ...props } = candidate;
    if (schema.safeParse(props).success)
      for (const key of keys) {
        c[key] = candidate[key];
        fixes.push({ path: `/updateComponents/components/${i}/${key}`, rule: "numeric-literal" });
      }
  }
  return { value, fixes };
}
export function repairReport(
  errors: { code: string; path?: string; expected?: string; componentId?: string }[],
) {
  return errors.slice(0, 20).map((error) => ({
    code: error.code,
    path: error.path ?? error.componentId ?? "/",
    expected: error.expected ?? "the active catalog type",
    got: "redacted invalid value",
    suggestion: error.code.includes("ATTACHMENT")
      ? "Use an id in the host metadata list."
      : error.code.includes("GRAPH")
        ? "Keep root reachable and remove cycles or missing children."
        : "Replace the named property using its catalog schema; preserve other components and user state.",
  }));
}
/** Narrow provider schema: the generated strings are still independently decoded and validated. */
export const LIMITED_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    messages: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "messages"],
  additionalProperties: false,
} as const;
export const DESIGN_BRIEF_SCHEMA = {
  type: "object",
  properties: {
    pattern: { type: "string" },
    components: { type: "array", items: { type: "string" } },
    state: { type: "array", items: { type: "string" } },
    interactions: { type: "array", items: { type: "string" } },
    learningGoal: { type: "string" },
  },
  required: ["pattern", "components", "state", "interactions", "learningGoal"],
  additionalProperties: false,
} as const;
export function redactRepair(value: unknown) {
  return redactContent(value);
}
