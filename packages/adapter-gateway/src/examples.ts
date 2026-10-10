import { AnswerSession, createUIRuntime, describeSurface } from "@engine/core";
import { type KitExample, KitExampleSchema, type UIKit } from "@engine/kit-spec";
import type { PromptExample } from "./prompt.js";

export type LoadedExample = KitExample & { tokens: number };

/** Rough token estimate; good enough to enforce a budget without a tokenizer dependency. */
export const estimateTokens = (text: string) =>
  Math.ceil([...text].reduce((n, c) => n + (c.charCodeAt(0) > 0x2e7f ? 1 : 0.28), 0));

/**
 * Resolve the examples a kit names, validate each one and fail loudly on any that would teach the
 * model something invalid: the schema, the replayed A2UI messages, and the declared fallback text.
 */
export function loadKitExamples(kit: UIKit, source: unknown[]): LoadedExample[] {
  const byId = new Map<string, KitExample>();
  for (const raw of source) {
    const example = KitExampleSchema.parse(raw);
    if (byId.has(example.id)) throw new Error(`Duplicate example id ${example.id}`);
    byId.set(example.id, example);
  }
  return kit.examples.map((name) => {
    const example = byId.get(name);
    if (!example) throw new Error(`Kit ${kit.id} names example "${name}" but it was not provided`);
    const runtime = createUIRuntime();
    const session = new AnswerSession(runtime);
    session.push(example.messages.map((m) => JSON.stringify(m)).join("\n"));
    session.end();
    const errors = runtime.diagnostics.filter((d) => d.severity === "error");
    const empty = describeSurface(runtime, "main").startsWith("Interactive content");
    runtime.dispose();
    if (errors.length)
      throw new Error(`Example ${name} is invalid: ${errors.map((e) => e.code).join(", ")}`);
    if (empty) throw new Error(`Example ${name} renders no readable content`);
    return { ...example, tokens: estimateTokens(JSON.stringify(example)) };
  });
}

export type SelectOptions = {
  prompt: string;
  /** Pin a category (e.g. from a router). Otherwise inferred from keywords. */
  category?: string;
  min?: number;
  max?: number;
  tokenBudget?: number;
};
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * Pick 2-4 examples per request by category and keyword overlap, inside a token budget.
 * Deterministic: ties keep the kit's own order. The first `min` examples are always the best
 * matches even when nothing matches (then the kit's leading examples), unless the budget forbids.
 */
export function selectExamples(
  library: LoadedExample[],
  { prompt, category, min = 2, max = 4, tokenBudget = 6000 }: SelectOptions,
): LoadedExample[] {
  const text = prompt.toLowerCase();
  const tokens = new Set(words(prompt));
  const scored = library.map((example, order) => {
    let score = category === example.category ? 5 : 0;
    for (const keyword of example.keywords) {
      const k = keyword.toLowerCase();
      // Korean has no spaces between particles and stems, so substring match; English needs a whole word.
      if (/[\p{Script=Hangul}]/u.test(k) ? text.includes(k) : tokens.has(k)) score += 2;
    }
    return { example, score, order };
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  const picked: LoadedExample[] = [];
  let used = 0;
  for (const { example, score } of scored) {
    if (picked.length >= max) break;
    if (picked.length >= min && score === 0) break;
    if (used + example.tokens > tokenBudget) continue;
    picked.push(example);
    used += example.tokens;
  }
  return picked;
}

export const toPromptExample = (e: LoadedExample): PromptExample => ({
  intro: e.intro,
  fallbackText: e.fallbackText,
  messages: e.messages,
  outro: e.outro,
});
