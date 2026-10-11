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
  let astNodes = 0;
  const boundAst = (item: Expr) => {
    if (++astNodes > 256) throw new Error("EXPRESSION_LIMIT");
    if (item && typeof item === "object" && "args" in item) item.args.forEach(boundAst);
  };
  boundAst(expr);
  let nodes = 0;
  let iterations = 0;
  let locals: Record<string, unknown> = {};
  const loop = (length: number) => {
    iterations += length;
    if (!Number.isInteger(length) || length < 0 || length > 1000 || iterations > 1000)
      throw new Error("ITERATION_LIMIT");
  };
  const evaluate = (item: Expr, depth = 0): unknown => {
    if (++nodes > 10000 || depth > 16) throw new Error("EXPRESSION_LIMIT");
    if (item === null || typeof item !== "object") return item;
    if ("ref" in item) return Object.hasOwn(locals, item.ref) ? locals[item.ref] : read(item.ref);
    const at = (i: number) => {
      if (i >= item.args.length) throw new Error("MISSING_OPERAND");
      return evaluate(item.args[i], depth + 1);
    };
    const binary = (op: (a: number, b: number) => number) => num(op(num(at(0)), num(at(1))));
    switch (item.op) {
      case "sin":
      case "cos":
      case "exp":
      case "log":
      case "sqrt":
      case "floor":
        return num(Math[item.op](num(at(0))));
      case "pow":
        return binary((a, b) => a ** b);
      case "clamp":
        return Math.min(num(at(2)), Math.max(num(at(1)), num(at(0))));
      case "lerp":
        return num(num(at(0)) + (num(at(1)) - num(at(0))) * num(at(2)));
      case "rng":
        return seededRandom(num(at(0)), num(at(1)));
      case "get": {
        const target = at(0);
        const key = at(1);
        if (!Array.isArray(target) || !Number.isInteger(key))
          throw new Error("EXPECTED_ARRAY_INDEX");
        return target[key as number] ?? null;
      }
      case "numberFormat": {
        const digits = item.args.length > 1 ? num(at(1)) : 2;
        if (!Number.isInteger(digits) || digits < 0 || digits > 8) throw new Error("ROUND_LIMIT");
        const fixed = num(at(0)).toFixed(digits);
        if (item.args.length < 3 || !at(2)) return fixed;
        // Optional third argument: group thousands with "," (locale-independent, so every
        // renderer and the history text agree).
        const [whole, fraction] = fixed.split(".");
        const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        return fraction === undefined ? grouped : `${grouped}.${fraction}`;
      }
      case "range": {
        const length = num(at(0));
        loop(length);
        return Array.from({ length }, (_, i) => i);
      }
      case "map":
      case "filter":
      case "reduce":
      case "scan":
      case "series": {
        const recurrence = item.op === "scan";
        const series = item.op === "series";
        const source = recurrence ? num(at(2)) : at(0);
        const length =
          recurrence || series ? num(source) : Array.isArray(source) ? source.length : -1;
        loop(length);
        const values = Array.isArray(source) ? source : Array.from({ length }, (_, i) => i);
        let acc = item.op === "reduce" ? at(2) : recurrence ? at(0) : null;
        const output: unknown[] = recurrence ? [acc] : [];
        const previous = locals;
        try {
          for (let i = 0; i < length; i++) {
            locals = { ...previous, $item: values[i], $index: i, $acc: acc };
            const result = evaluate(item.args[1]!, depth + 1);
            if (item.op === "reduce" || recurrence) acc = result;
            if (item.op === "filter") {
              if (result) output.push(values[i]);
            } else if (item.op !== "reduce") output.push(result);
          }
        } finally {
          locals = previous;
        }
        return item.op === "reduce" ? acc : output;
      }
      case "if":
        return at(0) ? at(1) : at(2);
      case "and":
        return Boolean(at(0)) && Boolean(at(1));
      case "or":
        return Boolean(at(0)) || Boolean(at(1));
      case "not":
        return !at(0);
      case "add":
        return num(item.args.reduce<number>((sum, _, i) => sum + num(at(i)), 0));
      case "sub":
        return binary((a, b) => a - b);
      case "mul":
        return num(item.args.reduce<number>((product, _, i) => product * num(at(i)), 1));
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
          formatValue(at(Number(index) + 1)),
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

function formatValue(value: unknown): string {
  return value === null || value === undefined
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
}

/** Hash-based random access: no mutable state, identical unsigned-32 arithmetic in Dart. */
export function seededRandom(seed: number, draw: number): number {
  if (!Number.isInteger(seed) || !Number.isInteger(draw) || draw < 0 || draw > 1_000_000)
    throw new Error("RNG_INDEX_LIMIT");
  let x = (seed ^ Math.imul(draw + 1, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}
