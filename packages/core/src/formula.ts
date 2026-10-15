/**
 * Formula strings → the expression tree (no eval, no host access): what a model writes for
 * "/principal * r / (1 - (1 + r) ^ -n)" instead of a deeply nested AST, where one missing quote
 * loses the whole surface.
 *
 * Grammar (lowest to highest precedence):
 *   cond ? a : b  ·  ||  ·  &&  ·  == != < <= > >=  ·  + -  ·  * / %  ·  unary - !  ·  ^ (right)
 *   ·  postfix .field and [index]  ·  primary
 * Primaries: numbers, "text" or 'text', true/false/null, [a, b], (…), function calls by operator
 * name (min, max, round, pow, sqrt, format, map, …), data paths (/price, /items/0), template
 * values ($item, $index, $row, $rowIndex, $acc), and bare names as relative paths (done, price).
 */
import { EXPRESSION_OPS, type Expr } from "@engine/protocol";

const OPS = new Set<string>(EXPRESSION_OPS);
/** Functions that take one list: min(a, b, c) means min of [a, b, c]. */
const VARIADIC = new Set(["min", "max", "sum", "count"]);
const ALIASES: Record<string, string> = { len: "count", length: "count", avg: "avg" };
const BINARY: Record<string, string> = {
  "+": "add",
  "-": "sub",
  "*": "mul",
  "/": "div",
  "%": "mod",
  "==": "eq",
  "!=": "ne",
  "<": "lt",
  "<=": "lte",
  ">": "gt",
  ">=": "gte",
  "&&": "and",
  "||": "or",
};

type Token = { kind: "num" | "str" | "name" | "path" | "op" | "end"; value: string; at: number };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  // Whether the next token is an operand (so "/" starts a path) or an operator (division).
  let operand = true;
  while (i < source.length) {
    const c = source[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const at = i;
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(source.slice(i))!;
      tokens.push({ kind: "num", value: m[0], at });
      i += m[0].length;
      operand = false;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let text = "";
      while (j < source.length && source[j] !== c) {
        if (source[j] === "\\" && j + 1 < source.length) j++;
        text += source[j];
        j++;
      }
      if (j >= source.length) throw new Error(`FORMULA_SYNTAX: unclosed text at ${at}`);
      tokens.push({ kind: "str", value: text, at });
      i = j + 1;
      operand = false;
    } else if (c === "/" && operand && /[A-Za-z0-9_$~-]/.test(source[i + 1] ?? "")) {
      const m = /^\/[A-Za-z0-9_$~-]+(\/[A-Za-z0-9_$~-]+)*/.exec(source.slice(i))!;
      tokens.push({ kind: "path", value: m[0], at });
      i += m[0].length;
      operand = false;
    } else if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(source.slice(i))!;
      tokens.push({ kind: "name", value: m[0], at });
      i += m[0].length;
      operand = false;
    } else {
      const two = source.slice(i, i + 2);
      const op = ["==", "!=", "<=", ">=", "&&", "||"].includes(two) ? two : c;
      if (op.length === 1 && !"+-*/%^<>!?:()[],.".includes(op))
        throw new Error(`FORMULA_SYNTAX: unexpected "${c}" at ${at}`);
      tokens.push({ kind: "op", value: op, at });
      i += op.length;
      operand = op !== ")" && op !== "]";
    }
  }
  tokens.push({ kind: "end", value: "", at: source.length });
  return tokens;
}

export function compileFormula(source: string): Expr {
  if (source.length > 2000) throw new Error("FORMULA_LIMIT");
  const tokens = tokenize(source);
  let pos = 0;
  let depth = 0;
  const peek = () => tokens[pos] as Token;
  const take = () => tokens[pos++] as Token;
  const isOp = (value: string) => peek().kind === "op" && peek().value === value;
  const expect = (value: string) => {
    if (!isOp(value)) throw new Error(`FORMULA_SYNTAX: expected "${value}" at ${peek().at}`);
    pos++;
  };
  const node = (op: string, args: Expr[]): Expr => ({ op, args }) as Expr;
  const guard = <T>(fn: () => T): T => {
    if (++depth > 48) throw new Error("FORMULA_LIMIT");
    try {
      return fn();
    } finally {
      depth--;
    }
  };

  const expression = (): Expr =>
    guard(() => {
      const condition = binary(0);
      if (!isOp("?")) return condition;
      pos++;
      const yes = expression();
      expect(":");
      return node("if", [condition, yes, expression()]);
    });
  const LEVELS = [["||"], ["&&"], ["==", "!=", "<", "<=", ">", ">="], ["+", "-"], ["*", "/", "%"]];
  const binary = (level: number): Expr => {
    if (level === LEVELS.length) return unary();
    let left = binary(level + 1);
    while (peek().kind === "op" && LEVELS[level]!.includes(peek().value)) {
      const op = BINARY[take().value] as string;
      const right = binary(level + 1);
      left =
        (op === "add" || op === "mul") && isNode(left, op)
          ? node(op, [...(left as { args: Expr[] }).args, right])
          : node(op, [left, right]);
    }
    return left;
  };
  const unary = (): Expr =>
    guard(() => {
      if (isOp("-")) {
        pos++;
        const value = unary();
        return typeof value === "number" ? -value : node("sub", [0, value]);
      }
      if (isOp("+")) {
        pos++;
        return unary();
      }
      if (isOp("!")) {
        pos++;
        return node("not", [unary()]);
      }
      return power();
    });
  const power = (): Expr => {
    const base = postfix();
    if (!isOp("^")) return base;
    pos++;
    return node("pow", [base, unary()]);
  };
  const postfix = (): Expr => {
    let value = primary();
    for (;;) {
      if (isOp(".")) {
        pos++;
        const field = take();
        if (field.kind !== "name")
          throw new Error(`FORMULA_SYNTAX: expected a field name at ${field.at}`);
        value = node("get", [value, field.value]);
      } else if (isOp("[")) {
        pos++;
        const key = expression();
        expect("]");
        value = node("get", [value, key]);
      } else return value;
    }
  };
  const list = (close: string): Expr[] => {
    const items: Expr[] = [];
    if (isOp(close)) {
      pos++;
      return items;
    }
    for (;;) {
      items.push(expression());
      if (isOp(",")) {
        pos++;
        continue;
      }
      expect(close);
      return items;
    }
  };
  const primary = (): Expr => {
    const token = take();
    switch (token.kind) {
      case "num":
        return Number(token.value);
      case "str":
        return token.value;
      case "path":
        return { ref: token.value } as Expr;
      case "name": {
        if (token.value === "true") return true;
        if (token.value === "false") return false;
        if (token.value === "null") return null;
        if (isOp("(")) {
          pos++;
          const args = list(")");
          const name = ALIASES[token.value] ?? token.value;
          if (name === "avg")
            return node("div", [
              node("sum", [node("array", args)]),
              node("count", [node("array", args)]),
            ]);
          if (!OPS.has(name))
            throw new Error(`FORMULA_SYNTAX: unknown function ${token.value} at ${token.at}`);
          if (VARIADIC.has(name) && args.length > 1) return node(name, [node("array", args)]);
          if (name === "round" && args.length === 1) return node("round", [args[0] as Expr, 0]);
          return node(name, args);
        }
        // $item / $index / … and bare names (a field of the template row, or a top-level path).
        return { ref: token.value } as Expr;
      }
      case "op":
        if (token.value === "(") {
          const inner = expression();
          expect(")");
          return inner;
        }
        if (token.value === "[") return node("array", list("]"));
        throw new Error(`FORMULA_SYNTAX: unexpected "${token.value}" at ${token.at}`);
      default:
        throw new Error("FORMULA_SYNTAX: unexpected end");
    }
  };
  const result = expression();
  if (peek().kind !== "end")
    throw new Error(`FORMULA_SYNTAX: unexpected "${peek().value}" at ${peek().at}`);
  return result;
}

function isNode(value: Expr, op: string): boolean {
  return (
    !!value && typeof value === "object" && "op" in value && (value as { op: string }).op === op
  );
}
