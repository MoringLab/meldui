/**
 * The expression and statement language of Meld Live: the part of JavaScript a model writes in
 * UI code (arrow functions, template strings, spread, optional chaining, destructuring, if/for in
 * handlers). Parsed into a small tree that `interp.ts` evaluates; nothing is ever run as code.
 */

export type Expr =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "lit"; v: boolean | null | undefined }
  | { t: "tpl"; q: string[]; e: Expr[] }
  | { t: "re"; src: string; flags: string }
  | { t: "id"; n: string }
  | { t: "arr"; items: (Expr | Spread | null)[] }
  | { t: "obj"; props: ObjProp[] }
  | { t: "mem"; o: Expr; p: Expr; opt: boolean }
  | { t: "call"; f: Expr; args: (Expr | Spread)[]; opt: boolean }
  | { t: "new"; f: Expr; args: (Expr | Spread)[] }
  | { t: "un"; op: string; e: Expr }
  | { t: "bin"; op: string; l: Expr; r: Expr }
  | { t: "log"; op: "&&" | "||" | "??"; l: Expr; r: Expr }
  | { t: "cond"; c: Expr; a: Expr; b: Expr }
  | { t: "fn"; params: Pattern[]; body: Expr | Stmt[]; block: boolean }
  | { t: "assign"; op: string; target: Expr | Pattern; v: Expr }
  | { t: "upd"; op: "++" | "--"; prefix: boolean; e: Expr }
  | { t: "seq"; list: Expr[] };
export type Spread = { t: "spread"; e: Expr };
export type ObjProp = { k: Expr; v: Expr } | Spread;
export type Pattern =
  | { t: "id"; n: string }
  | { t: "arrp"; items: (Pattern | null)[]; rest?: Pattern }
  | { t: "objp"; props: { k: Expr; v: Pattern }[]; rest?: Pattern }
  | { t: "def"; p: Pattern; d: Expr }
  | { t: "rest"; p: Pattern };
export type Stmt =
  | { t: "expr"; e: Expr }
  | { t: "decl"; kind: string; list: { p: Pattern; init?: Expr }[] }
  | { t: "if"; c: Expr; a: Stmt; b?: Stmt }
  | { t: "block"; body: Stmt[] }
  | { t: "ret"; e?: Expr }
  | { t: "forof"; p: Pattern; kind: string; iter: Expr; body: Stmt; of: boolean }
  | { t: "for"; init?: Stmt; test?: Expr; upd?: Expr; body: Stmt }
  | { t: "while"; c: Expr; body: Stmt }
  | { t: "brk" }
  | { t: "cont" }
  | { t: "empty" };

type Tok = {
  k: "num" | "str" | "id" | "p" | "tpl" | "re" | "eof";
  v: string;
  n?: number;
  pos: number;
  nl: boolean;
};

const PUNCT = [
  ">>>=",
  "...",
  "===",
  "!==",
  "**=",
  "<<=",
  ">>=",
  ">>>",
  "&&=",
  "||=",
  "??=",
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "?.",
  "**",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "<<",
  ">>",
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
  "!",
  "=",
  "?",
  ":",
  ".",
  ",",
  ";",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "&",
  "|",
  "^",
  "~",
];
const REGEX_AFTER = new Set([
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "&&",
  "||",
  "??",
  "=>",
  "return",
  "typeof",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "==",
  "===",
  "!=",
  "!==",
]);

export class SyntaxErr extends Error {}

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let nl = false;
  const n = src.length;
  while (i < n) {
    const c = src[i] as string;
    if (c === "\n") {
      nl = true;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    const start = i;
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m =
        /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?)/.exec(
          src.slice(i),
        );
      const text = (m?.[0] ?? c).replace(/_/g, "");
      out.push({ k: "num", v: text, n: Number(text), pos: start, nl });
      i += m?.[0].length || 1;
      nl = false;
      continue;
    }
    if (/[A-Za-z_$À-￿]/.test(c)) {
      let e = i + 1;
      while (e < n && /[\w$À-￿]/.test(src[e] as string)) e++;
      out.push({ k: "id", v: src.slice(i, e), pos: start, nl });
      i = e;
      nl = false;
      continue;
    }
    if (c === '"' || c === "'") {
      let s = "";
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\") {
          i++;
          s += escapeChar(src, i);
          if (src[i] === "u" && src[i + 1] === "{") i = src.indexOf("}", i);
          else if (src[i] === "u") i += 4;
          else if (src[i] === "x") i += 2;
        } else s += src[i];
        i++;
      }
      if (i >= n) throw new SyntaxErr("unterminated string");
      i++;
      out.push({ k: "str", v: s, pos: start, nl });
      nl = false;
      continue;
    }
    if (c === "`") {
      // Kept raw: the parser splits it into text and ${…} parts.
      let depth = 0;
      i++;
      while (i < n) {
        const d = src[i];
        if (d === "\\") i += 2;
        else if (d === "`" && depth === 0) break;
        else if (d === "$" && src[i + 1] === "{") {
          depth++;
          i += 2;
        } else if (d === "}" && depth > 0) {
          depth--;
          i++;
        } else if ((d === '"' || d === "'") && depth > 0) {
          i++;
          while (i < n && src[i] !== d) i += src[i] === "\\" ? 2 : 1;
          i++;
        } else i++;
      }
      if (i >= n) throw new SyntaxErr("unterminated template");
      out.push({ k: "tpl", v: src.slice(start + 1, i), pos: start, nl });
      i++;
      nl = false;
      continue;
    }
    if (c === "/") {
      const prev = out[out.length - 1];
      if (
        !prev ||
        (prev.k === "p" && REGEX_AFTER.has(prev.v)) ||
        (prev.k === "id" && REGEX_AFTER.has(prev.v))
      ) {
        let e = i + 1;
        let cls = false;
        while (e < n && (cls || src[e] !== "/")) {
          if (src[e] === "\\") e++;
          else if (src[e] === "[") cls = true;
          else if (src[e] === "]") cls = false;
          else if (src[e] === "\n") throw new SyntaxErr("unterminated regex");
          e++;
        }
        if (e >= n) throw new SyntaxErr("unterminated regex");
        const body = src.slice(i + 1, e);
        let f = e + 1;
        while (f < n && /[a-z]/.test(src[f] as string)) f++;
        out.push({ k: "re", v: `${body}\u0000${src.slice(e + 1, f)}`, pos: start, nl });
        i = f;
        nl = false;
        continue;
      }
    }
    const p = PUNCT.find((q) => src.startsWith(q, i));
    if (!p) throw new SyntaxErr(`unexpected ${c}`);
    // `a?.5:b` is a conditional, not optional chaining.
    if (p === "?." && /[0-9]/.test(src[i + 2] ?? "")) {
      out.push({ k: "p", v: "?", pos: start, nl });
      i++;
    } else {
      out.push({ k: "p", v: p, pos: start, nl });
      i += p.length;
    }
    nl = false;
  }
  out.push({ k: "eof", v: "", pos: n, nl });
  return out;
}

function escapeChar(src: string, i: number): string {
  const c = src[i] as string;
  switch (c) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    case "b":
      return "\b";
    case "0":
      return "\0";
    case "u": {
      if (src[i + 1] === "{") {
        const e = src.indexOf("}", i);
        return String.fromCodePoint(Number.parseInt(src.slice(i + 2, e), 16) || 0x3f);
      }
      return String.fromCharCode(Number.parseInt(src.slice(i + 1, i + 5), 16) || 0x3f);
    }
    case "x":
      return String.fromCharCode(Number.parseInt(src.slice(i + 1, i + 3), 16) || 0x3f);
    case "\n":
      return "";
    default:
      return c;
  }
}

const PREC: Record<string, number> = {
  "??": 1,
  "||": 2,
  "&&": 3,
  "|": 4,
  "^": 5,
  "&": 6,
  "==": 7,
  "!=": 7,
  "===": 7,
  "!==": 7,
  "<": 8,
  ">": 8,
  "<=": 8,
  ">=": 8,
  instanceof: 8,
  in: 8,
  "<<": 9,
  ">>": 9,
  ">>>": 9,
  "+": 10,
  "-": 10,
  "*": 11,
  "/": 11,
  "%": 11,
  "**": 12,
};
const ASSIGN = new Set([
  "=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "**=",
  "&&=",
  "||=",
  "??=",
  "<<=",
  ">>=",
  ">>>=",
  "&=",
  "|=",
  "^=",
]);

class Parser {
  i = 0;
  depth = 0;
  constructor(private toks: Tok[]) {}
  get tok(): Tok {
    return this.toks[this.i] as Tok;
  }
  peek(k = 1): Tok {
    return (this.toks[this.i + k] ?? this.toks[this.toks.length - 1]) as Tok;
  }
  is(v: string): boolean {
    const t = this.tok;
    return (t.k === "p" || t.k === "id") && t.v === v;
  }
  eat(v: string): boolean {
    if (this.is(v)) {
      this.i++;
      return true;
    }
    return false;
  }
  want(v: string) {
    if (!this.eat(v)) throw new SyntaxErr(`expected ${v} at ${this.tok.pos}`);
  }
  enter() {
    if (++this.depth > 200) throw new SyntaxErr("too deep");
  }

  // ── statements ────────────────────────────────────────────────────────────────────────────
  program(): Stmt[] {
    const out: Stmt[] = [];
    while (this.tok.k !== "eof") out.push(this.statement());
    return out;
  }
  semi() {
    if (this.eat(";")) return;
    if (this.is("}") || this.tok.k === "eof" || this.tok.nl) return;
    throw new SyntaxErr(`expected ; at ${this.tok.pos}`);
  }
  statement(): Stmt {
    this.enter();
    try {
      const t = this.tok;
      if (t.k === "p" && t.v === "{") {
        this.i++;
        const body: Stmt[] = [];
        while (!this.is("}")) {
          if (this.tok.k === "eof") throw new SyntaxErr("unclosed block");
          body.push(this.statement());
        }
        this.i++;
        return { t: "block", body };
      }
      if (t.k === "p" && t.v === ";") {
        this.i++;
        return { t: "empty" };
      }
      if (t.k === "id") {
        switch (t.v) {
          case "const":
          case "let":
          case "var": {
            const s = this.declaration();
            this.semi();
            return s;
          }
          case "if": {
            this.i++;
            this.want("(");
            const c = this.expression();
            this.want(")");
            const a = this.statement();
            const b = this.eat("else") ? this.statement() : undefined;
            return b ? { t: "if", c, a, b } : { t: "if", c, a };
          }
          case "return": {
            this.i++;
            if (this.is(";") || this.is("}") || this.tok.k === "eof" || this.tok.nl) {
              this.eat(";");
              return { t: "ret" };
            }
            const e = this.expression();
            this.semi();
            return { t: "ret", e };
          }
          case "for": {
            this.i++;
            this.want("(");
            if ((this.is("const") || this.is("let") || this.is("var")) && this.forOf()) {
              const kind = this.tok.v;
              this.i++;
              const p = this.pattern();
              const of = this.tok.v === "of";
              this.i++;
              const iter = this.expression();
              this.want(")");
              return { t: "forof", kind, p, iter, of, body: this.statement() };
            }
            const init = this.is(";")
              ? undefined
              : this.is("const") || this.is("let") || this.is("var")
                ? this.declaration()
                : { t: "expr" as const, e: this.expression() };
            this.want(";");
            const test = this.is(";") ? undefined : this.expression();
            this.want(";");
            const upd = this.is(")") ? undefined : this.expression();
            this.want(")");
            const body = this.statement();
            return {
              t: "for",
              ...(init ? { init } : {}),
              ...(test ? { test } : {}),
              ...(upd ? { upd } : {}),
              body,
            };
          }
          case "while": {
            this.i++;
            this.want("(");
            const c = this.expression();
            this.want(")");
            return { t: "while", c, body: this.statement() };
          }
          case "function": {
            if (this.peek().k !== "id") break;
            this.i++;
            const name = this.tok.v;
            this.i++;
            const params = this.paramList();
            const block = this.statement() as { t: "block"; body: Stmt[] };
            return {
              t: "decl",
              kind: "const",
              list: [
                {
                  p: { t: "id", n: name },
                  init: { t: "fn", params, body: block.body, block: true },
                },
              ],
            };
          }
          case "break":
            this.i++;
            this.semi();
            return { t: "brk" };
          case "continue":
            this.i++;
            this.semi();
            return { t: "cont" };
        }
      }
      const e = this.expression();
      this.semi();
      return { t: "expr", e };
    } finally {
      this.depth--;
    }
  }
  /** After `for (const`: whether this is `for (const x of …)`. */
  forOf(): boolean {
    let d = 0;
    for (let k = this.i + 1; k < this.toks.length; k++) {
      const t = this.toks[k] as Tok;
      if (t.k === "p" && "([{".includes(t.v)) d++;
      else if (t.k === "p" && ")]}".includes(t.v)) {
        if (d === 0) return false;
        d--;
      } else if (d === 0 && t.k === "id" && (t.v === "of" || t.v === "in")) return true;
      else if (d === 0 && t.k === "p" && (t.v === ";" || t.v === "=")) return false;
    }
    return false;
  }
  declaration(): Stmt {
    const kind = this.tok.v;
    this.i++;
    const list: { p: Pattern; init?: Expr }[] = [];
    do {
      const p = this.pattern();
      const init = this.eat("=") ? this.assignment() : undefined;
      list.push(init ? { p, init } : { p });
    } while (this.eat(","));
    return { t: "decl", kind, list };
  }
  pattern(): Pattern {
    const t = this.tok;
    let p: Pattern;
    if (t.k === "p" && t.v === "[") {
      this.i++;
      const items: (Pattern | null)[] = [];
      let rest: Pattern | undefined;
      while (!this.is("]")) {
        if (this.eat(",")) {
          items.push(null);
          continue;
        }
        if (this.eat("...")) rest = this.pattern();
        else {
          const item = this.pattern();
          items.push(this.eat("=") ? { t: "def", p: item, d: this.assignment() } : item);
        }
        if (!this.is("]")) this.want(",");
      }
      this.i++;
      p = rest ? { t: "arrp", items, rest } : { t: "arrp", items };
    } else if (t.k === "p" && t.v === "{") {
      this.i++;
      const props: { k: Expr; v: Pattern }[] = [];
      let rest: Pattern | undefined;
      while (!this.is("}")) {
        if (this.eat("...")) rest = this.pattern();
        else {
          const key = this.propKey();
          const v: Pattern = this.eat(":")
            ? this.pattern()
            : { t: "id", n: key.t === "str" ? key.v : "" };
          props.push({
            k: key,
            v: this.eat("=") ? { t: "def", p: v, d: this.assignment() } : v,
          });
        }
        if (!this.is("}")) this.want(",");
      }
      this.i++;
      p = rest ? { t: "objp", props, rest } : { t: "objp", props };
    } else if (t.k === "id") {
      this.i++;
      p = { t: "id", n: t.v };
    } else throw new SyntaxErr(`bad pattern at ${t.pos}`);
    return p;
  }
  propKey(): Expr {
    const t = this.tok;
    if (t.k === "id" || t.k === "str") {
      this.i++;
      return { t: "str", v: t.v };
    }
    if (t.k === "num") {
      this.i++;
      return { t: "str", v: String(t.n) };
    }
    if (t.k === "p" && t.v === "[") {
      this.i++;
      const e = this.assignment();
      this.want("]");
      return e;
    }
    throw new SyntaxErr(`bad key at ${t.pos}`);
  }

  // ── expressions ───────────────────────────────────────────────────────────────────────────
  expression(): Expr {
    const first = this.assignment();
    if (!this.is(",")) return first;
    const list = [first];
    while (this.eat(",")) list.push(this.assignment());
    return { t: "seq", list };
  }
  assignment(): Expr {
    this.enter();
    try {
      const arrow = this.arrow();
      if (arrow) return arrow;
      const left = this.conditional();
      const t = this.tok;
      if (t.k === "p" && ASSIGN.has(t.v)) {
        this.i++;
        const v = this.assignment();
        const target = left.t === "arr" || left.t === "obj" ? toPattern(left) : left;
        if (target.t !== "id" && target.t !== "mem" && target.t !== "arrp" && target.t !== "objp")
          throw new SyntaxErr("bad assignment");
        return { t: "assign", op: t.v, target, v };
      }
      return left;
    } finally {
      this.depth--;
    }
  }
  /** `x => …`, `(a, b) => …`, `({a}) => …`, or null when this is not an arrow function. */
  arrow(): Expr | null {
    const t = this.tok;
    if (t.k === "id" && this.peek().v === "=>" && t.v !== "async") {
      this.i += 2;
      return this.arrowBody([{ t: "id", n: t.v }]);
    }
    if (t.k === "id" && t.v === "async" && (this.peek().v === "(" || this.peek().k === "id")) {
      this.i++;
      const r = this.arrow();
      if (r) return r;
      this.i--;
      return null;
    }
    if (!(t.k === "p" && t.v === "(")) return null;
    // Find the matching ")" and see whether "=>" follows.
    let d = 0;
    let k = this.i;
    for (; k < this.toks.length; k++) {
      const u = this.toks[k] as Tok;
      if (u.k === "p" && "([{".includes(u.v)) d++;
      else if (u.k === "p" && ")]}".includes(u.v) && --d === 0) break;
    }
    if ((this.toks[k + 1] as Tok | undefined)?.v !== "=>") return null;
    this.i++;
    const params: Pattern[] = [];
    while (!this.is(")")) {
      if (this.eat("...")) params.push({ t: "rest", p: this.pattern() });
      else {
        let p = this.pattern();
        if (this.eat("=")) p = { t: "def", p, d: this.assignment() };
        params.push(p);
      }
      if (!this.is(")")) this.want(",");
    }
    this.i++;
    this.want("=>");
    return this.arrowBody(params);
  }
  arrowBody(params: Pattern[]): Expr {
    if (this.is("{")) {
      const block = this.statement() as { t: "block"; body: Stmt[] };
      return { t: "fn", params, body: block.body, block: true };
    }
    return { t: "fn", params, body: this.assignment(), block: false };
  }
  conditional(): Expr {
    const c = this.binary(0);
    if (!this.eat("?")) return c;
    const a = this.assignment();
    this.want(":");
    const b = this.assignment();
    return { t: "cond", c, a, b };
  }
  binary(min: number): Expr {
    let left = this.unary();
    for (;;) {
      const t = this.tok;
      if (t.k !== "p" && t.k !== "id") break;
      const op = t.v;
      const prec = PREC[op];
      if (prec === undefined || prec < min) break;
      this.i++;
      const right = this.binary(op === "**" ? prec : prec + 1);
      left =
        op === "&&" || op === "||" || op === "??"
          ? { t: "log", op, l: left, r: right }
          : { t: "bin", op, l: left, r: right };
    }
    return left;
  }
  unary(): Expr {
    this.enter();
    try {
      const t = this.tok;
      if (t.k === "p" && (t.v === "!" || t.v === "-" || t.v === "+" || t.v === "~")) {
        this.i++;
        return { t: "un", op: t.v, e: this.unary() };
      }
      if (t.k === "p" && (t.v === "++" || t.v === "--")) {
        this.i++;
        return { t: "upd", op: t.v as "++", prefix: true, e: this.unary() };
      }
      if (
        t.k === "id" &&
        (t.v === "typeof" || t.v === "void" || t.v === "await" || t.v === "delete")
      ) {
        this.i++;
        const e = this.unary();
        return t.v === "await" ? e : { t: "un", op: t.v, e };
      }
      const e = this.postfix();
      const u = this.tok;
      if (u.k === "p" && (u.v === "++" || u.v === "--") && !u.nl) {
        this.i++;
        return { t: "upd", op: u.v as "++", prefix: false, e };
      }
      return e;
    } finally {
      this.depth--;
    }
  }
  args(): (Expr | Spread)[] {
    const out: (Expr | Spread)[] = [];
    while (!this.is(")")) {
      if (this.tok.k === "eof") throw new SyntaxErr("unclosed call");
      out.push(this.eat("...") ? { t: "spread", e: this.assignment() } : this.assignment());
      if (!this.is(")")) this.want(",");
    }
    this.i++;
    return out;
  }
  postfix(): Expr {
    let e: Expr;
    if (this.is("new")) {
      this.i++;
      const f = this.primary();
      const args = this.eat("(") ? this.args() : [];
      e = { t: "new", f, args };
    } else e = this.primary();
    for (;;) {
      const t = this.tok;
      if (t.k === "p" && t.v === ".") {
        this.i++;
        const name = this.tok;
        if (name.k !== "id") throw new SyntaxErr(`expected name at ${name.pos}`);
        this.i++;
        e = { t: "mem", o: e, p: { t: "str", v: name.v }, opt: false };
      } else if (t.k === "p" && t.v === "?.") {
        this.i++;
        if (this.eat("(")) e = { t: "call", f: e, args: this.args(), opt: true };
        else if (this.eat("[")) {
          const p = this.expression();
          this.want("]");
          e = { t: "mem", o: e, p, opt: true };
        } else {
          const name = this.tok;
          if (name.k !== "id") throw new SyntaxErr(`expected name at ${name.pos}`);
          this.i++;
          e = { t: "mem", o: e, p: { t: "str", v: name.v }, opt: true };
        }
      } else if (t.k === "p" && t.v === "[") {
        this.i++;
        const p = this.expression();
        this.want("]");
        e = { t: "mem", o: e, p, opt: false };
      } else if (t.k === "p" && t.v === "(") {
        this.i++;
        e = { t: "call", f: e, args: this.args(), opt: false };
      } else if (t.k === "tpl") {
        // tagged template: treated as a call with the joined text
        this.i++;
        e = { t: "call", f: e, args: [template(t.v)], opt: false };
      } else break;
    }
    return e;
  }
  primary(): Expr {
    const t = this.tok;
    this.i++;
    switch (t.k) {
      case "num":
        return { t: "num", v: t.n ?? Number.NaN };
      case "str":
        return { t: "str", v: t.v };
      case "tpl":
        return template(t.v);
      case "re": {
        const [src, flags] = t.v.split("\u0000");
        return { t: "re", src: src ?? "", flags: flags ?? "" };
      }
      case "id":
        if (t.v === "true" || t.v === "false") return { t: "lit", v: t.v === "true" };
        if (t.v === "null") return { t: "lit", v: null };
        if (t.v === "undefined") return { t: "lit", v: undefined };
        if (t.v === "function") return this.functionExpr();
        return { t: "id", n: t.v };
      case "p":
        if (t.v === "(") {
          const e = this.expression();
          this.want(")");
          return e;
        }
        if (t.v === "[") {
          const items: (Expr | Spread | null)[] = [];
          while (!this.is("]")) {
            if (this.tok.k === "eof") throw new SyntaxErr("unclosed array");
            if (this.is(",")) {
              this.i++;
              items.push(null);
              continue;
            }
            items.push(this.eat("...") ? { t: "spread", e: this.assignment() } : this.assignment());
            if (!this.is("]")) this.want(",");
          }
          this.i++;
          return { t: "arr", items };
        }
        if (t.v === "{") {
          const props: ObjProp[] = [];
          while (!this.is("}")) {
            if (this.tok.k === "eof") throw new SyntaxErr("unclosed object");
            if (this.eat("...")) props.push({ t: "spread", e: this.assignment() });
            else {
              const keyTok = this.tok;
              const k = this.propKey();
              if (this.eat(":")) props.push({ k, v: this.assignment() });
              else if (this.is("(")) {
                // method shorthand: f(a) { … }
                const params = this.paramList();
                const block = this.statement() as { t: "block"; body: Stmt[] };
                props.push({ k, v: { t: "fn", params, body: block.body, block: true } });
              } else if (keyTok.k === "id") {
                // shorthand {a} or {a = 1} (the latter only in patterns)
                if (this.is("=")) {
                  this.i++;
                  props.push({
                    k,
                    v: {
                      t: "assign",
                      op: "=",
                      target: { t: "id", n: keyTok.v },
                      v: this.assignment(),
                    },
                  });
                } else props.push({ k, v: { t: "id", n: keyTok.v } });
              } else throw new SyntaxErr(`expected : at ${this.tok.pos}`);
            }
            if (!this.is("}")) this.want(",");
          }
          this.i++;
          return { t: "obj", props };
        }
    }
    throw new SyntaxErr(`unexpected ${t.v || t.k} at ${t.pos}`);
  }
  paramList(): Pattern[] {
    this.want("(");
    const params: Pattern[] = [];
    while (!this.is(")")) {
      if (this.eat("...")) params.push({ t: "rest", p: this.pattern() });
      else {
        let p = this.pattern();
        if (this.eat("=")) p = { t: "def", p, d: this.assignment() };
        params.push(p);
      }
      if (!this.is(")")) this.want(",");
    }
    this.i++;
    return params;
  }
  functionExpr(): Expr {
    if (this.tok.k === "id") this.i++; // a name is ignored
    const params = this.paramList();
    const block = this.statement() as { t: "block"; body: Stmt[] };
    return { t: "fn", params, body: block.body, block: true };
  }
}

/** `{a, b: [c]}` written as an expression, as an assignment target. */
function toPattern(e: Expr): Pattern {
  if (e.t === "id") return e;
  if (e.t === "assign" && e.op === "=") return { t: "def", p: toPattern(e.target as Expr), d: e.v };
  if (e.t === "arr")
    return {
      t: "arrp",
      items: e.items
        .filter((x): x is Expr | null => !x || x.t !== "spread")
        .map((x) => (x ? toPattern(x) : null)),
    };
  if (e.t === "obj")
    return {
      t: "objp",
      props: e.props
        .filter((p): p is { k: Expr; v: Expr } => !("t" in p))
        .map((p) => ({ k: p.k, v: toPattern(p.v) })),
    };
  throw new SyntaxErr("bad pattern");
}

function template(raw: string): Expr {
  const q: string[] = [];
  const e: Expr[] = [];
  let text = "";
  let i = 0;
  while (i < raw.length) {
    const c = raw[i] as string;
    if (c === "\\") {
      text += escapeChar(raw, i + 1);
      i += 2;
      continue;
    }
    if (c === "$" && raw[i + 1] === "{") {
      let d = 1;
      let k = i + 2;
      for (; k < raw.length && d > 0; k++) {
        const ch = raw[k];
        if (ch === "{") d++;
        else if (ch === "}") d--;
        else if (ch === '"' || ch === "'" || ch === "`") {
          const qch = ch;
          for (k++; k < raw.length && raw[k] !== qch; k++) if (raw[k] === "\\") k++;
        }
      }
      q.push(text);
      text = "";
      e.push(parseExpr(raw.slice(i + 2, k - 1)));
      i = k;
      continue;
    }
    text += c;
    i++;
  }
  q.push(text);
  return { t: "tpl", q, e };
}

const exprCache = new Map<string, Expr | SyntaxErr>();
const stmtCache = new Map<string, Stmt[] | SyntaxErr>();
function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  if (cache.size > 4000) cache.delete(cache.keys().next().value as string);
  cache.set(key, value);
  return value;
}

/** One expression (cached by its source). Throws SyntaxErr. */
export function parseExpr(src: string): Expr {
  let hit = exprCache.get(src);
  if (hit === undefined) {
    try {
      const p = new Parser(lex(src));
      const e = p.expression();
      if (p.tok.k !== "eof") throw new SyntaxErr(`unexpected ${p.tok.v} at ${p.tok.pos}`);
      hit = remember<Expr | SyntaxErr>(exprCache, src, e);
    } catch (error) {
      hit = remember<Expr | SyntaxErr>(
        exprCache,
        src,
        error instanceof SyntaxErr ? error : new SyntaxErr(String(error)),
      );
    }
  }
  if (hit instanceof SyntaxErr) throw hit;
  return hit;
}

/** Statements (a handler body, a `{@body …}` block). Throws SyntaxErr. */
export function parseStatements(src: string): Stmt[] {
  let hit = stmtCache.get(src);
  if (hit === undefined) {
    try {
      hit = remember<Stmt[] | SyntaxErr>(stmtCache, src, new Parser(lex(src)).program());
    } catch (error) {
      hit = remember<Stmt[] | SyntaxErr>(
        stmtCache,
        src,
        error instanceof SyntaxErr ? error : new SyntaxErr(String(error)),
      );
    }
  }
  if (hit instanceof SyntaxErr) throw hit;
  return hit;
}
