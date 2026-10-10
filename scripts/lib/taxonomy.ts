import { isInfraFailure } from "../../packages/adapter-gateway/src/health.js";

export const FAILURE_CLASSES = [
  "infra",
  "invalid-envelope",
  "incomplete-graph",
  "unresolvable-expression",
  "component-error",
  "semantic",
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

const table: [RegExp, FailureClass][] = [
  [/^(INVALID_JSON|INVALID_ENVELOPE|INVALID_MESSAGE|INVALID_SCHEMA|MESSAGE_LIMIT|STREAM_LIMIT)$/, "invalid-envelope"],
  [/^(MISSING_ROOT|INCOMPLETE_OUTPUT|UNKNOWN_SURFACE|DUPLICATE_|MISSING_CHILD|CYCLE)/, "incomplete-graph"],
  [/^(EXPECTED_|EXPRESSION_|IMPURE_EXPRESSION)/, "unresolvable-expression"],
  [/^(INVALID_COMPONENT|UNKNOWN_COMPONENT|COMPONENT_)/, "component-error"],
  [/^(SEMANTIC_|ROUTING_|NUMERIC_|BEHAVIOR_|LAYOUT_)/, "semantic"],
];
export function classifyCode(code: string): FailureClass {
  if (isInfraFailure(code)) return "infra";
  return table.find(([re]) => re.test(code))?.[1] ?? "component-error";
}

type Row = {
  id: string;
  model: string;
  kitId?: string;
  initialValid?: boolean;
  valid?: boolean;
  errors?: string[];
  finalErrors?: unknown[];
};
/** The dominant class decides the row's bucket; infra always wins because nothing else was measurable. */
export function classifyRow(row: Row): FailureClass | null {
  const codes = [...(row.errors ?? [])];
  if (!codes.length && row.finalErrors?.length) codes.push("COMPONENT_ERROR");
  if (!codes.length) return row.initialValid ? null : "component-error";
  if (codes.some(isInfraFailure)) return "infra";
  const counts = new Map<FailureClass, number>();
  for (const code of codes) counts.set(classifyCode(code), (counts.get(classifyCode(code)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
