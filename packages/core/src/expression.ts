import { type Expr, ExprSchema } from "@engine/protocol";

/** Check untrusted JSON before recursive schema validation or upstream mutation. */
export function assertSafeJson(value: unknown, maxDepth = 50): void {
  const pending: [unknown, number][] = [[value, 0]];
  let count = 0;
  while (pending.length) {
    const [item, depth] = pending.pop()!;
    if (++count > 100_000 || depth > maxDepth) throw new Error("JSON_LIMIT");
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("NON_FINITE_NUMBER");
    if (!item || typeof item !== "object") continue;
    for (const [key, child] of Object.entries(item)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("UNSAFE_KEY");
      pending.push([child, depth + 1]);
    }
  }
}

/** Resolve the A2UI relative-pointer extension, rejecting prototype access. */
export function resolvePath(path: string, scope = "/"): string {
  const result = path.startsWith("/") ? path : `${scope === "/" ? "" : scope}/${path}`;
  for (const segment of result.split("/").slice(1)) {
    if (/~(?![01])/u.test(segment)) throw new Error("INVALID_POINTER");
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("UNSAFE_PATH");
  }
  return result || "/";
}

function num(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("EXPECTED_NUMBER");
  return value;
}

/** Deterministic bounded AST evaluation. Conditional branches are lazy. */
export function evaluateExpression(expression: Expr, read: (path: string) => unknown): unknown {
  assertSafeJson(expression, 34);
  const expr = ExprSchema.parse(expression);
  let nodes = 0;
  const evaluate = (item: Expr, depth = 0): unknown => {
    if (++nodes > 256 || depth > 16) throw new Error("EXPRESSION_LIMIT");
    if (item === null || typeof item !== "object") return item;
    if ("ref" in item) return read(item.ref);
    const at = (i: number) => {
      if (i >= item.args.length) throw new Error("MISSING_OPERAND");
      return evaluate(item.args[i], depth + 1);
    };
    const binary = (op: (a: number, b: number) => number) => num(op(num(at(0)), num(at(1))));
    switch (item.op) {
      case "if":
        return at(0) ? at(1) : at(2);
      case "and":
        return Boolean(at(0)) && Boolean(at(1));
      case "or":
        return Boolean(at(0)) || Boolean(at(1));
      case "not":
        return !at(0);
      case "add":
        return binary((a, b) => a + b);
      case "sub":
        return binary((a, b) => a - b);
      case "mul":
        return binary((a, b) => a * b);
      case "div":
        return binary((a, b) => {
          if (b === 0) throw new Error("DIVISION_BY_ZERO");
          return a / b;
        });
      case "mod":
        return binary((a, b) => {
          if (b === 0) throw new Error("DIVISION_BY_ZERO");
          return a % b;
        });
      case "eq":
        return at(0) === at(1);
      case "ne":
        return at(0) !== at(1);
      case "lt":
        return num(at(0)) < num(at(1));
      case "lte":
        return num(at(0)) <= num(at(1));
      case "gt":
        return num(at(0)) > num(at(1));
      case "gte":
        return num(at(0)) >= num(at(1));
      case "round": {
        const places = num(at(1));
        if (!Number.isInteger(places) || Math.abs(places) > 8) throw new Error("ROUND_LIMIT");
        const p = 10 ** places;
        return num(Math.round(num(at(0)) * p) / p);
      }
      case "array":
        return item.args.map((arg) => evaluate(arg, depth + 1));
      case "format": {
        const template = at(0);
        if (typeof template !== "string") throw new Error("EXPECTED_STRING");
        return template.replace(/\{(\d+)\}/g, (_, index: string) =>
          String(at(Number(index) + 1) ?? ""),
        );
      }
      case "sum":
      case "count":
      case "min":
      case "max": {
        const values = at(0);
        if (!Array.isArray(values) || values.length > 1000) throw new Error("ARRAY_LIMIT");
        if (item.op === "count") return values.length;
        const numbers = values.map(num);
        if (item.op === "sum") return num(numbers.reduce((a, b) => a + b, 0));
        if (!numbers.length) throw new Error("EMPTY_ARRAY");
        return item.op === "min" ? Math.min(...numbers) : Math.max(...numbers);
      }
      default:
        throw new Error("UNKNOWN_OPERATOR");
    }
  };
  return evaluate(expr);
}
