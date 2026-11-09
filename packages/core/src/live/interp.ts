/**
 * Evaluates Meld Live expressions and statements. Safe by construction: only the values the
 * language makes (numbers, text, lists, plain objects, its own functions, dates and patterns) exist,
 * methods are a fixed list per type, prototypes are unreachable, and every evaluation has a step
 * budget, so a runaway loop ends with an error instead of freezing the app.
 */
import { type Expr, type Pattern, parseExpr, type Spread, type Stmt } from "./syntax.js";

export class LiveError extends Error {}
/** The step budget ran out (an endless loop, a huge list). */
export class LiveLimit extends LiveError {}

const MAX_LIST = 20_000;
const MAX_TEXT = 100_000;
const BLOCKED = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
]);

/** A function written in Live (arrow or function expression) and the scope it closes over. */
export class LiveFn {
  constructor(
    readonly params: Pattern[],
    readonly body: Expr | Stmt[],
    readonly block: boolean,
    readonly env: Env,
  ) {}
}
/** A built-in function: receives evaluated arguments and the interpreter (to call back into Live). */
export class Native {
  constructor(
    readonly name: string,
    readonly fn: (args: unknown[], it: Interp) => unknown,
  ) {}
}

export class Env {
  readonly vars = new Map<string, unknown>();
  constructor(readonly parent: Env | null = null) {}
  find(name: string): Env | null {
    for (let e: Env | null = this; e; e = e.parent) if (e.vars.has(name)) return e;
    return null;
  }
  child(vars?: Record<string, unknown>): Env {
    const e = new Env(this);
    if (vars) for (const k in vars) e.vars.set(k, vars[k]);
    return e;
  }
}

/** Names that are not local: states, derived values, setters and actions of the program. */
export interface Host {
  /** The value of a program name, or MISSING. */
  get(name: string): unknown;
  /** Writes a state; false when `name` is not a state. Throws while drawing. */
  set(name: string, value: unknown): boolean;
  /** Whether `name` is a state (assignable). */
  isState(name: string): boolean;
}
export const MISSING = Symbol("missing");

type Ref =
  | { k: "local"; env: Env; name: string }
  | { k: "state"; name: string; path: PropertyKey[] }
  | { k: "obj"; obj: any; key: PropertyKey };

const BREAK = Symbol("break");
const CONTINUE = Symbol("continue");
type Completion = undefined | typeof BREAK | typeof CONTINUE | { ret: unknown };

const ownProperty = Object.prototype.hasOwnProperty;
export const own = (o: object, k: PropertyKey) => ownProperty.call(o, k);

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function safeKey(key: unknown): PropertyKey {
  const k = typeof key === "number" ? key : String(key);
  if (typeof k === "string" && BLOCKED.has(k)) throw new LiveError(`"${k}" is not allowed`);
  return k;
}

function checkList(n: number) {
  if (!(n >= 0) || n > MAX_LIST) throw new LiveLimit(`list too long (${n})`);
}

/** A copy of `root` with `value` at `path` (copies only along the path). */
export function setIn(root: unknown, path: PropertyKey[], value: unknown): unknown {
  if (!path.length) return value;
  const [head, ...rest] = path as [PropertyKey, ...PropertyKey[]];
  const base: any = Array.isArray(root)
    ? root.slice()
    : isPlainObject(root)
      ? { ...root }
      : typeof head === "number"
        ? []
        : {};
  base[safeKey(head)] = setIn(base[head as any], rest, value);
  return base;
}
export function getIn(root: unknown, path: PropertyKey[]): unknown {
  let v: any = root;
  for (const k of path) v = v == null ? undefined : v[k as any];
  return v;
}

export function show(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "number")
    return Number.isFinite(v) ? String(Math.round(v * 1e10) / 1e10) : String(v);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return String(v);
  if (v instanceof LiveFn || v instanceof Native) return "";
  if (Array.isArray(v))
    return v.map((x) => (x === null || x === undefined ? "" : show(x))).join(",");
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "Invalid Date" : v.toISOString();
  if (v instanceof RegExp) return String(v);
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return "";
  }
}

/** Thousands separators: 1234567.5 → "1,234,567.5". */
export function groupNumber(n: number, digits?: number, minDigits = 0): string {
  if (!Number.isFinite(n)) return String(n);
  let text =
    digits === undefined
      ? String(Math.round(n * 1e10) / 1e10)
      : n.toFixed(Math.max(0, Math.min(20, digits)));
  if (digits !== undefined && minDigits < digits && text.includes(".")) {
    text = text.replace(/0+$/, "");
    const [, frac = ""] = text.split(".");
    if (frac.length < minDigits) text += "0".repeat(minDigits - frac.length);
    text = text.replace(/\.$/, "");
  }
  const [int = "", frac] = text.split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const digitsOnly = sign ? int.slice(1) : int;
  return `${sign}${digitsOnly.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? `.${frac}` : ""}`;
}

export class Interp {
  steps = 0;
  constructor(
    readonly host: Host,
    readonly limit = 50_000,
  ) {}
  tick(n = 1) {
    this.steps += n;
    if (this.steps > this.limit) throw new LiveLimit("too much work");
  }

  // ── names ─────────────────────────────────────────────────────────────────────────────────
  lookup(name: string, env: Env): unknown {
    const local = env.find(name);
    if (local) return local.vars.get(name);
    const v = this.host.get(name);
    if (v !== MISSING) return v;
    if (name in GLOBALS) return GLOBALS[name];
    throw new LiveError(`${name} is not defined`);
  }

  // ── expressions ───────────────────────────────────────────────────────────────────────────
  eval(e: Expr, env: Env): unknown {
    this.tick();
    switch (e.t) {
      case "num":
      case "str":
      case "lit":
        return e.v;
      case "tpl": {
        let s = e.q[0] ?? "";
        for (let i = 0; i < e.e.length; i++)
          s += show(this.eval(e.e[i] as Expr, env)) + (e.q[i + 1] ?? "");
        return s;
      }
      case "re":
        return new RegExp(e.src, e.flags.replace(/[^gimsuy]/g, ""));
      case "id":
        return this.lookup(e.n, env);
      case "arr": {
        const out: unknown[] = [];
        for (const item of e.items) {
          if (item === null) out.push(undefined);
          else if (item.t === "spread") out.push(...this.iterate(this.eval(item.e, env)));
          else out.push(this.eval(item, env));
        }
        checkList(out.length);
        return out;
      }
      case "obj": {
        const out: Record<string, unknown> = {};
        for (const p of e.props) {
          if ("t" in p && p.t === "spread") {
            const v = this.eval(p.e, env);
            if (Array.isArray(v)) for (const [i, x] of v.entries()) out[i] = x;
            else if (isPlainObject(v)) Object.assign(out, v);
          } else {
            const { k, v } = p as { k: Expr; v: Expr };
            out[safeKey(this.eval(k, env)) as string] = this.eval(v, env);
          }
        }
        return out;
      }
      case "mem": {
        const o = this.eval(e.o, env);
        if (o === null || o === undefined) {
          if (e.opt) return undefined;
          throw new LiveError(`cannot read ${keyName(e.p)} of ${o}`);
        }
        return this.prop(o, this.eval(e.p, env));
      }
      case "call":
        return this.callExpr(e, env);
      case "new":
        return this.construct(e, env);
      case "un": {
        if (e.op === "typeof") {
          if (
            e.e.t === "id" &&
            !env.find(e.e.n) &&
            this.host.get(e.e.n) === MISSING &&
            !(e.e.n in GLOBALS)
          )
            return "undefined";
          const v = this.eval(e.e, env);
          return v instanceof LiveFn || v instanceof Native
            ? "function"
            : v === null
              ? "object"
              : typeof v;
        }
        if (e.op === "delete") {
          const r = this.ref(e.e, env);
          if (r.k === "obj") delete r.obj[r.key as any];
          return true;
        }
        const v = this.eval(e.e, env) as any;
        switch (e.op) {
          case "!":
            return !v;
          case "-":
            return -v;
          case "+":
            return +v;
          case "~":
            return ~v;
          case "void":
            return undefined;
        }
        throw new LiveError(`unknown operator ${e.op}`);
      }
      case "bin":
        return this.binary(e.op, this.eval(e.l, env), this.eval(e.r, env));
      case "log": {
        const l = this.eval(e.l, env);
        if (e.op === "&&") return l ? this.eval(e.r, env) : l;
        if (e.op === "||") return l ? l : this.eval(e.r, env);
        return l === null || l === undefined ? this.eval(e.r, env) : l;
      }
      case "cond":
        return this.eval(e.c, env) ? this.eval(e.a, env) : this.eval(e.b, env);
      case "fn":
        return new LiveFn(e.params, e.body, e.block, env);
      case "assign":
        return this.assign(e, env);
      case "upd": {
        const r = this.ref(e.e, env);
        const old = Number(this.readRef(r));
        const next = e.op === "++" ? old + 1 : old - 1;
        this.writeRef(r, next);
        return e.prefix ? next : old;
      }
      case "seq": {
        let v: unknown;
        for (const x of e.list) v = this.eval(x, env);
        return v;
      }
    }
  }

  binary(op: string, l: any, r: any): unknown {
    switch (op) {
      case "+":
        if (typeof l === "string" || typeof r === "string") {
          const s = show(l) + show(r);
          if (s.length > MAX_TEXT) throw new LiveLimit("text too long");
          return s;
        }
        return l + r;
      case "-":
        return l - r;
      case "*":
        return l * r;
      case "/":
        return l / r;
      case "%":
        return l % r;
      case "**":
        return l ** r;
      case "==":
        // biome-ignore lint/suspicious/noDoubleEquals: the language has loose equality
        return l == r;
      case "!=":
        // biome-ignore lint/suspicious/noDoubleEquals: the language has loose equality
        return l != r;
      case "===":
        return l === r;
      case "!==":
        return l !== r;
      case "<":
        return l < r;
      case ">":
        return l > r;
      case "<=":
        return l <= r;
      case ">=":
        return l >= r;
      case "&":
        return l & r;
      case "|":
        return l | r;
      case "^":
        return l ^ r;
      case "<<":
        return l << r;
      case ">>":
        return l >> r;
      case ">>>":
        return l >>> r;
      case "in":
        return r !== null && typeof r === "object" && own(r, safeKey(l));
      case "instanceof":
        return false;
    }
    throw new LiveError(`unknown operator ${op}`);
  }

  iterate(v: unknown): unknown[] {
    if (Array.isArray(v)) return v;
    if (typeof v === "string") return [...v];
    if (v instanceof Map || v instanceof Set) return [...v];
    if (v === null || v === undefined) throw new LiveError(`${v} is not iterable`);
    throw new LiveError("not iterable");
  }

  prop(o: any, key: unknown): unknown {
    if (typeof key === "string" && BLOCKED.has(key)) throw new LiveError(`"${key}" is not allowed`);
    if (o instanceof Native) {
      // Built-ins used as namespaces: Number.isInteger, Array.from, Date.now.
      const k = String(key);
      return own(o, k) && k !== "fn" && k !== "name" ? (o as any)[k] : undefined;
    }
    if (Array.isArray(o) || typeof o === "string") {
      if (key === "length") return o.length;
      const i =
        typeof key === "number"
          ? key
          : typeof key === "string" && /^\d+$/.test(key)
            ? Number(key)
            : Number.NaN;
      if (Number.isInteger(i)) return o[i];
      return method(o, String(key)) ?? undefined;
    }
    if (o instanceof LiveFn || o instanceof Native) return undefined;
    if (isPlainObject(o)) {
      const k = String(key);
      return own(o, k) ? o[k] : undefined;
    }
    if (o instanceof Map && key === "size") return o.size;
    if (o instanceof Set && key === "size") return o.size;
    if (o instanceof RegExp) {
      if (key === "source" || key === "flags" || key === "global") return o[key];
      return undefined;
    }
    // numbers, booleans, dates: only methods
    return method(o, String(key)) ?? undefined;
  }

  // ── calls ─────────────────────────────────────────────────────────────────────────────────
  args(list: (Expr | Spread)[], env: Env): unknown[] {
    const out: unknown[] = [];
    for (const a of list) {
      if (a.t === "spread") out.push(...this.iterate(this.eval(a.e, env)));
      else out.push(this.eval(a, env));
    }
    return out;
  }

  callExpr(e: Extract<Expr, { t: "call" }>, env: Env): unknown {
    const f = e.f;
    if (f.t === "id" && !env.find(f.n)) {
      const special = SPECIAL[f.n];
      if (special && this.host.get(f.n) === MISSING) {
        const r = special(this, e.args, env);
        if (r !== NOT_SPECIAL) return r;
      }
    }
    if (f.t === "mem") {
      const o = this.eval(f.o, env);
      if (o === null || o === undefined) {
        if (f.opt || e.opt) return undefined;
        throw new LiveError(`cannot call ${keyName(f.p)} of ${o}`);
      }
      const name = this.eval(f.p, env);
      if (typeof name === "string" && BLOCKED.has(name))
        throw new LiveError(`"${name}" is not allowed`);
      const args = this.args(e.args, env);
      // A list or object kept in state changes by copy: items.push(x) writes a new list.
      if (
        typeof name === "string" &&
        MUTATORS.has(name) &&
        (Array.isArray(o) || isPlainObject(o))
      ) {
        const r = this.refOrNull(f.o, env);
        if (r?.k === "state") {
          const copy = Array.isArray(o) ? o.slice() : { ...(o as object) };
          const result = this.callMethod(copy, name, args);
          this.writeRef(r, copy);
          return result;
        }
      }
      if (o instanceof Native) {
        const fn = this.prop(o, name);
        if (fn instanceof Native || fn instanceof LiveFn) return this.call(fn, args);
        throw new LiveError(`${String(name)} is not a function`);
      }
      if (isPlainObject(o) || o instanceof Map) {
        const fn = isPlainObject(o)
          ? own(o, name as string)
            ? o[name as string]
            : undefined
          : undefined;
        if (fn instanceof LiveFn || fn instanceof Native) return this.call(fn, args);
        if (o instanceof Map || fn === undefined) {
          const m = method(o, String(name));
          if (m) return this.call(m, args, o);
        }
        if (e.opt) return undefined;
        throw new LiveError(`${String(name)} is not a function`);
      }
      return this.callMethod(o, String(name), args, e.opt);
    }
    const fn = this.eval(f, env);
    if ((fn === null || fn === undefined) && e.opt) return undefined;
    return this.call(fn, this.args(e.args, env));
  }

  callMethod(o: unknown, name: string, args: unknown[], optional = false): unknown {
    const m = method(o, name);
    if (!m) {
      if (optional) return undefined;
      throw new LiveError(`${name} is not a function`);
    }
    return this.call(m, args, o);
  }

  call(fn: unknown, args: unknown[], self?: unknown): unknown {
    this.tick();
    if (fn instanceof Native) return fn.fn(self === undefined ? args : [self, ...args], this);
    if (!(fn instanceof LiveFn)) throw new LiveError("not a function");
    if (this.depth > 120) throw new LiveLimit("too deep");
    this.depth++;
    try {
      const env = fn.env.child();
      fn.params.forEach((p, i) => {
        if (p.t === "rest") this.bind(p.p, args.slice(i), env, true);
        else this.bind(p, args[i], env, true);
      });
      if (!fn.block) return this.eval(fn.body as Expr, env);
      const c = this.exec(fn.body as Stmt[], env);
      return c && typeof c === "object" ? c.ret : undefined;
    } finally {
      this.depth--;
    }
  }
  depth = 0;

  construct(e: Extract<Expr, { t: "new" }>, env: Env): unknown {
    const name = e.f.t === "id" ? e.f.n : "";
    const args = this.args(e.args, env);
    switch (name) {
      case "Date":
        return args.length ? new Date(...(args as [number])) : new Date();
      case "Array":
        return (GLOBALS.Array as Native).fn(args, this);
      case "Map":
        return new Map(Array.isArray(args[0]) ? (args[0] as [unknown, unknown][]) : []);
      case "Set":
        return new Set(Array.isArray(args[0]) ? args[0] : []);
      case "RegExp":
        return new RegExp(String(args[0] ?? ""), String(args[1] ?? "").replace(/[^gimsuy]/g, ""));
      case "Object":
        return {};
    }
    throw new LiveError(`new ${name || "?"} is not supported`);
  }

  // ── writes ────────────────────────────────────────────────────────────────────────────────
  refOrNull(e: Expr, env: Env): Ref | null {
    if (e.t === "id") {
      const local = env.find(e.n);
      if (local) {
        // A loop's item stands for its row in the list it came from: writing to it writes the list.
        const alias = local.vars.get(`\u0000${e.n}`);
        if (typeof alias === "string") {
          const r = this.refOrNull(parseExpr(alias), local.parent ?? local);
          if (r && r.k === "state") return r;
        }
        return { k: "local", env: local, name: e.n };
      }
      if (this.host.isState(e.n)) return { k: "state", name: e.n, path: [] };
      return null;
    }
    if (e.t === "mem") {
      const base = this.refOrNull(e.o, env);
      const key = safeKey(this.eval(e.p, env));
      if (base?.k === "state")
        return { k: "state", name: base.name, path: [...base.path, toIndex(key)] };
      const obj = this.eval(e.o, env);
      if (obj === null || typeof obj !== "object") return null;
      return { k: "obj", obj, key: toIndex(key) };
    }
    return null;
  }
  ref(e: Expr | Pattern, env: Env): Ref {
    const r = e.t === "id" || e.t === "mem" ? this.refOrNull(e as Expr, env) : null;
    if (!r)
      throw new LiveError(
        e.t === "id" ? `${(e as { n: string }).n} is not a state` : "cannot assign here",
      );
    return r;
  }
  readRef(r: Ref): unknown {
    if (r.k === "local") return r.env.vars.get(r.name);
    if (r.k === "state") return getIn(this.host.get(r.name), r.path);
    return r.obj[r.key as any];
  }
  writeRef(r: Ref, value: unknown) {
    if (r.k === "local") r.env.vars.set(r.name, value);
    else if (r.k === "state") {
      const root = r.path.length ? setIn(this.host.get(r.name), r.path, value) : value;
      if (!this.host.set(r.name, root)) throw new LiveError(`${r.name} is not a state`);
    } else {
      if (Object.isFrozen(r.obj)) throw new LiveError("read only");
      r.obj[r.key as any] = value;
    }
  }
  assign(e: Extract<Expr, { t: "assign" }>, env: Env): unknown {
    const t = e.target;
    if (t.t === "arrp" || t.t === "objp") {
      const v = this.eval(e.v, env);
      this.bind(t, v, env, false);
      return v;
    }
    const r = this.ref(t, env);
    let v: unknown;
    if (e.op === "=") v = this.eval(e.v, env);
    else if (e.op === "&&=" || e.op === "||=" || e.op === "??=") {
      const old = this.readRef(r);
      const keep =
        e.op === "&&=" ? !old : e.op === "||=" ? !!old : old !== null && old !== undefined;
      if (keep) return old;
      v = this.eval(e.v, env);
    } else v = this.binary(e.op.slice(0, -1), this.readRef(r), this.eval(e.v, env));
    this.writeRef(r, v);
    return v;
  }
  /** Binds a pattern: declares in `env` (declare) or assigns to existing names. */
  bind(p: Pattern, v: unknown, env: Env, declare: boolean) {
    this.tick();
    switch (p.t) {
      case "id":
        if (declare) env.vars.set(p.n, v);
        else this.writeRef(this.ref(p, env), v);
        return;
      case "def":
        this.bind(p.p, v === undefined ? this.eval(p.d, env) : v, env, declare);
        return;
      case "rest":
        this.bind(p.p, v, env, declare);
        return;
      case "arrp": {
        const list = v === undefined || v === null ? [] : this.iterate(v);
        for (const [i, item] of p.items.entries()) if (item) this.bind(item, list[i], env, declare);
        if (p.rest) this.bind(p.rest, list.slice(p.items.length), env, declare);
        return;
      }
      case "objp": {
        const o: any = v ?? {};
        const used = new Set<string>();
        for (const { k, v: sub } of p.props) {
          const key = String(this.eval(k, env));
          used.add(key);
          this.bind(sub, this.prop(o, key), env, declare);
        }
        if (p.rest && isPlainObject(o)) {
          const rest: Record<string, unknown> = {};
          for (const key of Object.keys(o)) if (!used.has(key)) rest[key] = o[key];
          this.bind(p.rest, rest, env, declare);
        }
        return;
      }
    }
  }

  // ── statements ────────────────────────────────────────────────────────────────────────────
  exec(list: Stmt[], env: Env): Completion {
    for (const s of list) {
      const c = this.stmt(s, env);
      if (c !== undefined) return c;
    }
    return undefined;
  }
  stmt(s: Stmt, env: Env): Completion {
    this.tick();
    switch (s.t) {
      case "expr":
        this.eval(s.e, env);
        return undefined;
      case "decl":
        for (const d of s.list)
          this.bind(d.p, d.init ? this.eval(d.init, env) : undefined, env, true);
        return undefined;
      case "if":
        if (this.eval(s.c, env)) return this.stmt(s.a, env);
        return s.b ? this.stmt(s.b, env) : undefined;
      case "block":
        return this.exec(s.body, env.child());
      case "ret":
        return { ret: s.e ? this.eval(s.e, env) : undefined };
      case "brk":
        return BREAK;
      case "cont":
        return CONTINUE;
      case "empty":
        return undefined;
      case "forof": {
        const v = this.eval(s.iter, env);
        const items = s.of
          ? this.iterate(v)
          : isPlainObject(v)
            ? Object.keys(v)
            : Array.isArray(v)
              ? v.map((_, i) => String(i))
              : [];
        for (const item of items) {
          const inner = env.child();
          this.bind(s.p, item, inner, true);
          const c = this.stmt(s.body, inner);
          if (c === BREAK) break;
          if (c && typeof c === "object") return c;
        }
        return undefined;
      }
      case "for": {
        const inner = env.child();
        if (s.init) this.stmt(s.init, inner);
        while (!s.test || this.eval(s.test, inner)) {
          const c = this.stmt(s.body, inner.child());
          if (c === BREAK) break;
          if (c && typeof c === "object") return c;
          if (s.upd) this.eval(s.upd, inner);
        }
        return undefined;
      }
      case "while":
        while (this.eval(s.c, env)) {
          const c = this.stmt(s.body, env.child());
          if (c === BREAK) break;
          if (c && typeof c === "object") return c;
        }
        return undefined;
    }
  }
}

function keyName(p: Expr): string {
  return p.t === "str" ? p.v : "property";
}
function toIndex(k: PropertyKey): PropertyKey {
  return typeof k === "string" && /^\d+$/.test(k) ? Number(k) : k;
}

// ── built-ins ─────────────────────────────────────────────────────────────────────────────────

const N = (name: string, fn: (args: any[], it: Interp) => unknown) => new Native(name, fn);
const num = (v: unknown) => Number(v);
function cmpDefault(a: unknown, b: unknown) {
  if (a === undefined) return b === undefined ? 0 : 1;
  if (b === undefined) return -1;
  const x = show(a);
  const y = show(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
function sortWith(it: Interp, list: unknown[], f: unknown) {
  it.tick(list.length * 4);
  const cmp =
    f === undefined ? cmpDefault : (a: unknown, b: unknown) => Number(it.call(f, [a, b])) || 0;
  return list.sort(cmp);
}
function regexInput(s: string) {
  if (s.length > 5000) throw new LiveLimit("text too long for a pattern");
  return s;
}

const ARRAY: Record<string, (a: any[], args: any[], it: Interp) => unknown> = {
  map: (a, [f], it) => {
    it.tick(a.length);
    return a.map((x, i) => it.call(f, [x, i, a]));
  },
  filter: (a, [f], it) => {
    it.tick(a.length);
    return a.filter((x, i) => it.call(f, [x, i, a]));
  },
  forEach: (a, [f], it) => {
    it.tick(a.length);
    for (const [i, x] of a.entries()) it.call(f, [x, i, a]);
  },
  reduce: (a, args, it) => {
    it.tick(a.length);
    const [f] = args;
    if (args.length > 1) return a.reduce((acc, x, i) => it.call(f, [acc, x, i, a]), args[1]);
    if (!a.length) throw new LiveError("reduce of empty list");
    return a.reduce((acc, x, i) => it.call(f, [acc, x, i, a]));
  },
  reduceRight: (a, args, it) => ARRAY.reduce!(a.slice().reverse(), args, it),
  find: (a, [f], it) => a.find((x, i) => it.call(f, [x, i, a])),
  findIndex: (a, [f], it) => a.findIndex((x, i) => it.call(f, [x, i, a])),
  findLast: (a, [f], it) =>
    a
      .slice()
      .reverse()
      .find((x, i) => it.call(f, [x, a.length - 1 - i, a])),
  findLastIndex: (a, [f], it) => {
    for (let i = a.length - 1; i >= 0; i--) if (it.call(f, [a[i], i, a])) return i;
    return -1;
  },
  some: (a, [f], it) => a.some((x, i) => it.call(f, [x, i, a])),
  every: (a, [f], it) => a.every((x, i) => it.call(f, [x, i, a])),
  flatMap: (a, [f], it) => {
    const out = a.flatMap((x, i) => it.call(f, [x, i, a]) as any);
    checkList(out.length);
    return out;
  },
  includes: (a, [v]) => a.includes(v),
  indexOf: (a, [v, from]) => a.indexOf(v, from),
  lastIndexOf: (a, [v]) => a.lastIndexOf(v),
  join: (a, [sep]) => {
    const s = a.map((x) => show(x)).join(sep === undefined ? "," : String(sep));
    if (s.length > MAX_TEXT) throw new LiveLimit("text too long");
    return s;
  },
  slice: (a, [s, e]) => a.slice(s, e),
  concat: (a, args) => {
    const out = a.concat(...args);
    checkList(out.length);
    return out;
  },
  flat: (a, [d]) => {
    const out = a.flat(Math.min(Number(d ?? 1), 5));
    checkList(out.length);
    return out;
  },
  reverse: (a) => a.reverse(),
  toReversed: (a) => a.slice().reverse(),
  sort: (a, [f], it) => sortWith(it, a, f),
  toSorted: (a, [f], it) => sortWith(it, a.slice(), f),
  at: (a, [i]) => a[(Number(i) || 0) < 0 ? a.length + (Number(i) || 0) : Number(i) || 0],
  fill: (a, [v, s, e]) => a.fill(v, s, e),
  keys: (a) => a.map((_, i) => i),
  entries: (a) => a.map((x, i) => [i, x]),
  values: (a) => a.slice(),
  with: (a, [i, v]) => {
    const c = a.slice();
    c[Number(i) < 0 ? c.length + Number(i) : Number(i)] = v;
    return c;
  },
  push: (a, args) => {
    checkList(a.length + args.length);
    return a.push(...args);
  },
  pop: (a) => a.pop(),
  shift: (a) => a.shift(),
  unshift: (a, args) => {
    checkList(a.length + args.length);
    return a.unshift(...args);
  },
  splice: (a, args) => a.splice(...(args as [number, number])),
  toSpliced: (a, args) => {
    const c = a.slice();
    c.splice(...(args as [number, number]));
    return c;
  },
  toString: (a: any[]) => show(a),
};
const STRING: Record<string, (s: string, args: any[], it: Interp) => unknown> = {
  padStart: (s, [n, p]) => {
    checkText(n);
    return s.padStart(Number(n), p === undefined ? " " : String(p));
  },
  padEnd: (s, [n, p]) => {
    checkText(n);
    return s.padEnd(Number(n), p === undefined ? " " : String(p));
  },
  toUpperCase: (s) => s.toUpperCase(),
  toLowerCase: (s) => s.toLowerCase(),
  toLocaleUpperCase: (s) => s.toUpperCase(),
  toLocaleLowerCase: (s) => s.toLowerCase(),
  trim: (s) => s.trim(),
  trimStart: (s) => s.trimStart(),
  trimEnd: (s) => s.trimEnd(),
  slice: (s, [a, b]) => s.slice(a, b),
  substring: (s, [a, b]) => s.substring(a, b),
  substr: (s, [a, b]) => s.substr(a, b),
  split: (s, [sep, lim]) => {
    const out = s.split(
      sep instanceof RegExp
        ? new RegExp(sep.source, sep.flags)
        : sep === undefined
          ? (undefined as never)
          : String(sep),
      lim,
    );
    checkList(out.length);
    return out;
  },
  includes: (s, [x]) => s.includes(String(x)),
  startsWith: (s, [x]) => s.startsWith(String(x)),
  endsWith: (s, [x]) => s.endsWith(String(x)),
  indexOf: (s, [x, f]) => s.indexOf(String(x), f),
  lastIndexOf: (s, [x]) => s.lastIndexOf(String(x)),
  charAt: (s, [i]) => s.charAt(i),
  charCodeAt: (s, [i]) => s.charCodeAt(i),
  codePointAt: (s, [i]) => s.codePointAt(i),
  at: (s, [i]) => s.charAt((Number(i) || 0) < 0 ? s.length + (Number(i) || 0) : Number(i) || 0),
  repeat: (s, [n]) => {
    if (s.length * Number(n) > MAX_TEXT) throw new LiveLimit("text too long");
    return s.repeat(Math.max(0, Number(n) || 0));
  },
  concat: (s, args) => s + args.map(show).join(""),
  replace: (s, [a, b], it) => replaceText(s, a, b, it, false),
  replaceAll: (s, [a, b], it) => replaceText(s, a, b, it, true),
  match: (s, [re]) => (re instanceof RegExp ? regexInput(s).match(re) : s.match(String(re))),
  search: (s, [re]) => regexInput(s).search(re instanceof RegExp ? re : String(re)),
  normalize: (s) => s.normalize(),
  localeCompare: (s, [x]) => s.localeCompare(String(x)),
  toString: (s: string) => s,
};
function checkText(n: unknown) {
  if (Number(n) > MAX_TEXT) throw new LiveLimit("text too long");
}
function replaceText(s: string, a: unknown, b: unknown, it: Interp, all: boolean): string {
  const by =
    b instanceof LiveFn || b instanceof Native
      ? (...m: unknown[]) => show(it.call(b, m.slice(0, -2)))
      : show(b);
  if (a instanceof RegExp) {
    regexInput(s);
    const re = all && !a.global ? new RegExp(a.source, `${a.flags}g`) : a;
    return s.replace(re, by as never);
  }
  return all ? s.replaceAll(String(a), by as never) : s.replace(String(a), by as never);
}
const NUMBER: Record<string, (n: number, args: any[]) => unknown> = {
  toFixed: (n, [d]) => n.toFixed(Math.max(0, Math.min(20, Number(d) || 0))),
  toPrecision: (n, [d]) =>
    d === undefined ? String(n) : n.toPrecision(Math.max(1, Math.min(21, Number(d)))),
  toString: (n: number, [r]: any[]) =>
    n.toString(r === undefined ? 10 : Math.max(2, Math.min(36, Number(r)))),
  toLocaleString: (n: number, [, o]: any[]) => {
    const opts = isPlainObject(o) ? o : {};
    const max = opts.maximumFractionDigits as number | undefined;
    const min = (opts.minimumFractionDigits as number | undefined) ?? 0;
    if (opts.style === "percent") return `${groupNumber(n * 100, max ?? 0, min)}%`;
    return groupNumber(n, max ?? (min ? Math.max(min, 3) : 3), min);
  },
  valueOf: (n: number) => n,
};
const DATE: Record<string, (d: Date, args: any[]) => unknown> = Object.fromEntries(
  [
    "getFullYear",
    "getMonth",
    "getDate",
    "getDay",
    "getHours",
    "getMinutes",
    "getSeconds",
    "getMilliseconds",
    "getTime",
    "getTimezoneOffset",
    "toISOString",
    "toDateString",
    "toTimeString",
    "valueOf",
    "getUTCFullYear",
    "getUTCMonth",
    "getUTCDate",
    "getUTCDay",
    "getUTCHours",
    "getUTCMinutes",
  ].map((m) => [m, (d: Date) => (d as any)[m]()]),
);
(DATE as any).toLocaleDateString = (d: Date) =>
  `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
(DATE as any).toLocaleTimeString = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
(DATE as any).toLocaleString = (d: Date) =>
  `${(DATE as any).toLocaleDateString(d)} ${(DATE as any).toLocaleTimeString(d)}`;
(DATE as any).toString = (d: Date) => d.toString();
for (const m of [
  "setFullYear",
  "setMonth",
  "setDate",
  "setHours",
  "setMinutes",
  "setSeconds",
  "setTime",
])
  DATE[m] = (d, args) => (d as any)[m](...args);

const MAP: Record<string, (m: Map<any, any> | Set<any>, args: any[]) => unknown> = {
  get: (m, [k]) => (m as Map<any, any>).get(k),
  has: (m, [k]) => m.has(k),
  set: (m, [k, v]) => (m as Map<any, any>).set(k, v),
  add: (m, [v]) => (m as Set<any>).add(v),
  delete: (m, [k]) => m.delete(k),
  keys: (m) => [...m.keys()],
  values: (m) => [...m.values()],
  entries: (m) => [...m.entries()],
  clear: (m) => m.clear(),
};

/** The built-in method `name` of `o`, or null. */
function method(o: unknown, name: string): Native | null {
  if (BLOCKED.has(name)) return null;
  let table: Record<string, (...a: any[]) => unknown> | undefined;
  if (Array.isArray(o)) table = ARRAY;
  else if (typeof o === "string") table = STRING;
  else if (typeof o === "number") table = NUMBER;
  else if (typeof o === "boolean") return name === "toString" ? N(name, ([b]) => String(b)) : null;
  else if (o instanceof Date) table = DATE;
  else if (o instanceof Map || o instanceof Set) table = MAP;
  else if (o instanceof RegExp) {
    if (name === "test") return N(name, ([re, s]) => (re as RegExp).test(regexInput(show(s))));
    if (name === "exec") return N(name, ([re, s]) => (re as RegExp).exec(regexInput(show(s))));
    return null;
  } else if (isPlainObject(o)) {
    if (name === "hasOwnProperty") return N(name, ([obj, k]) => own(obj as object, String(k)));
    if (name === "toString") return N(name, () => "[object Object]");
    return null;
  }
  const f = table && own(table, name) ? table[name] : undefined;
  if (!f) return null;
  return N(name, (args, it) => (f as any)(args[0], args.slice(1), it));
}

const MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill"]);

function range(args: number[]): number[] {
  let [a, b, step] = args.map(Number) as [number, number | undefined, number | undefined];
  if (b === undefined) {
    b = a;
    a = 0;
  }
  step = step || (b >= a ? 1 : -1);
  const n = Math.max(0, Math.ceil((b - a) / step));
  checkList(n);
  return Array.from({ length: n }, (_, i) => a + i * step!);
}
/** Deterministic random in [0,1) for a seed and a draw index (stable across redraws). */
export function rng(seed: number, i = 0): number {
  let x =
    (Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^
      Math.imul((i | 0) + 0x632be5ab, 0xc2b2ae35)) >>>
    0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
function nums(args: unknown[]): number[] {
  return (args.length === 1 && Array.isArray(args[0]) ? args[0] : args).map(Number);
}
function arrayFrom(args: unknown[], it: Interp) {
  const [src, f] = args;
  let list: unknown[];
  if (Array.isArray(src) || typeof src === "string") list = [...src];
  else if (src instanceof Map || src instanceof Set) list = [...src];
  else if (isPlainObject(src) && typeof src.length === "number") {
    checkList(src.length);
    list = Array.from({ length: src.length });
  } else list = [];
  checkList(list.length);
  it.tick(list.length);
  return f === undefined ? list : list.map((x, i) => it.call(f, [x, i]));
}
const ns = (entries: Record<string, unknown>) =>
  Object.freeze(Object.assign(Object.create(null), entries));
const mathFns = [
  "abs",
  "ceil",
  "floor",
  "round",
  "trunc",
  "sign",
  "sqrt",
  "cbrt",
  "exp",
  "expm1",
  "log",
  "log2",
  "log10",
  "log1p",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "asinh",
  "acosh",
  "atanh",
  "pow",
  "hypot",
  "min",
  "max",
  "fround",
  "clz32",
] as const;
const MathNS = ns({
  ...Object.fromEntries(
    mathFns.map((n) => [n, N(n, (args) => (Math as any)[n](...args.map(num)))]),
  ),
  random: N("random", () => Math.random()),
  PI: Math.PI,
  E: Math.E,
  LN2: Math.LN2,
  LN10: Math.LN10,
  LOG2E: Math.LOG2E,
  LOG10E: Math.LOG10E,
  SQRT2: Math.SQRT2,
  SQRT1_2: Math.SQRT1_2,
});
const fmt = (args: unknown[]) => {
  const [tpl, ...rest] = args;
  return String(tpl ?? "").replace(/\{(\d+)\}/g, (_, i) => show(rest[Number(i)]));
};

export const GLOBALS: Record<string, unknown> = Object.assign(Object.create(null), {
  Math: MathNS,
  Infinity,
  NaN,
  String: N("String", ([v]) => (v === undefined ? "" : show(v))),
  Boolean: N("Boolean", ([v]) => Boolean(v)),
  parseInt: N("parseInt", ([v, r]) => Number.parseInt(show(v), r)),
  parseFloat: N("parseFloat", ([v]) => Number.parseFloat(show(v))),
  isNaN: N("isNaN", ([v]) => Number.isNaN(Number(v))),
  isFinite: N("isFinite", ([v]) => Number.isFinite(Number(v))),
  Array: N("Array", (args) => {
    if (args.length === 1 && typeof args[0] === "number") {
      checkList(args[0]);
      return Array.from({ length: args[0] });
    }
    return args;
  }),
  JSON: ns({
    stringify: N("stringify", ([v, , sp]) => {
      const s =
        JSON.stringify(
          v,
          (_k, x) => (x instanceof LiveFn || x instanceof Native ? undefined : x),
          typeof sp === "number" ? Math.min(sp, 8) : undefined,
        ) ?? "";
      if (s.length > MAX_TEXT) throw new LiveLimit("text too long");
      return s;
    }),
    parse: N("parse", ([v]) => JSON.parse(show(v))),
  }),
  Object: ns({
    keys: N("keys", ([o]) => (o && typeof o === "object" ? Object.keys(o) : [])),
    values: N("values", ([o]) => (o && typeof o === "object" ? Object.values(o) : [])),
    entries: N("entries", ([o]) => (o && typeof o === "object" ? Object.entries(o) : [])),
    fromEntries: N("fromEntries", ([l]) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of (Array.isArray(l) ? l : []) as [unknown, unknown][])
        out[safeKey(k) as string] = v;
      return out;
    }),
    assign: N("assign", ([t, ...rest]) => {
      for (const r of rest)
        if (isPlainObject(r)) for (const k of Object.keys(r)) (t as any)[safeKey(k)] = r[k];
      return t;
    }),
    freeze: N("freeze", ([o]) => o),
  }),
  Date: N("Date", () => new Date().toString()),
  // Helpers from the formula language, kept for older answers and as short forms.
  range: N("range", (args) => range(args as number[])),
  clamp: N("clamp", ([x, a, b]) => Math.min(Math.max(num(x), num(a)), num(b))),
  lerp: N("lerp", ([a, b, t]) => num(a) + (num(b) - num(a)) * num(t)),
  sum: N("sum", (args) => nums(args).reduce((a, b) => a + b, 0)),
  avg: N("avg", (args) => {
    const l = nums(args);
    return l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0;
  }),
  count: N("count", ([l]) => (Array.isArray(l) || typeof l === "string" ? l.length : 0)),
  round: N("round", ([x, d]) => {
    const p = 10 ** (Number(d) || 0);
    return Math.round(num(x) * p) / p;
  }),
  numberFormat: N("numberFormat", ([x, d, g]) =>
    g === false
      ? num(x).toFixed(Number(d) || 0)
      : groupNumber(num(x), d === undefined ? undefined : Number(d)),
  ),
  format: N("format", fmt),
  rng: N("rng", ([s, i]) => rng(num(s), num(i ?? 0))),
  abs: N("abs", ([x]) => Math.abs(num(x))),
  min: N("min", (args) => Math.min(...nums(args))),
  max: N("max", (args) => Math.max(...nums(args))),
  floor: N("floor", ([x]) => Math.floor(num(x))),
  ceil: N("ceil", ([x]) => Math.ceil(num(x))),
  sqrt: N("sqrt", ([x]) => Math.sqrt(num(x))),
  pow: N("pow", ([x, y]) => num(x) ** num(y)),
  sin: N("sin", ([x]) => Math.sin(num(x))),
  cos: N("cos", ([x]) => Math.cos(num(x))),
  exp: N("exp", ([x]) => Math.exp(num(x))),
  log: N("log", ([x]) => Math.log(num(x))),
  concat: N("concat", (args) => {
    if (args.every((a) => typeof a === "string" || typeof a === "number"))
      return args.map(show).join("");
    const out = ([] as unknown[]).concat(...args);
    checkList(out.length);
    return out;
  }),
  join: N("join", ([l, sep]) =>
    Array.isArray(l) ? l.map(show).join(sep === undefined ? "," : String(sep)) : show(l),
  ),
  slice: N("slice", ([l, a, b]) => (Array.isArray(l) || typeof l === "string" ? l.slice(a, b) : l)),
  includes: N("includes", ([l, v]) =>
    Array.isArray(l) ? l.includes(v) : typeof l === "string" ? l.includes(show(v)) : false,
  ),
  get: N("get", ([o, k]) => (o && typeof o === "object" ? (o as any)[safeKey(k)] : undefined)),
  object: N("object", (args) => {
    const out: Record<string, unknown> = {};
    for (let i = 0; i + 1 < args.length; i += 2) out[safeKey(args[i]) as string] = args[i + 1];
    return out;
  }),
  console: ns({ log: N("log", () => undefined) }),
});
// Number is both a function and a namespace.
const NumberFn = N("Number", ([v]) => Number(v));
Object.assign(NumberFn, {
  isFinite: N("isFinite", ([v]) => Number.isFinite(v)),
  isInteger: N("isInteger", ([v]) => Number.isInteger(v)),
  isNaN: N("isNaN", ([v]) => Number.isNaN(v)),
  parseFloat: N("parseFloat", ([v]) => Number.parseFloat(show(v))),
  parseInt: N("parseInt", ([v, r]) => Number.parseInt(show(v), r)),
  MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
  MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
  EPSILON: Number.EPSILON,
  MAX_VALUE: Number.MAX_VALUE,
});
GLOBALS.Number = NumberFn;
Object.assign(GLOBALS.Array as Native, {
  isArray: N("isArray", ([v]) => Array.isArray(v)),
  from: N("from", arrayFrom),
  of: N("of", (args) => args),
});
Object.assign(GLOBALS.Date as Native, { now: N("now", () => Date.now()) });

const NOT_SPECIAL = Symbol("not-special");
/**
 * Calls that see their arguments unevaluated: the formula language's map(list, $item.x) family,
 * and toggle(x) which needs to know what x names.
 */
const SPECIAL: Record<string, (it: Interp, args: (Expr | Spread)[], env: Env) => unknown> = {
  toggle: (it, args, env) => {
    const target = args[0];
    if (!target || target.t === "spread") return NOT_SPECIAL;
    const r = it.ref(target, env);
    const v = !it.readRef(r);
    it.writeRef(r, v);
    return v;
  },
  map: (it, args, env) => formulaLoop(it, args, env, "map"),
  filter: (it, args, env) => formulaLoop(it, args, env, "filter"),
  sort: (it, args, env) => formulaLoop(it, args, env, "sort"),
  reduce: (it, args, env) => formulaLoop(it, args, env, "reduce"),
  scan: (it, args, env) => formulaLoop(it, args, env, "scan"),
  series: (it, args, env) => {
    const [n, body] = args as Expr[];
    if (!n || !body) return NOT_SPECIAL;
    const count = Number(it.eval(n, env));
    checkList(count);
    return Array.from({ length: count }, (_, i) =>
      it.eval(body, env.child({ $index: i, $item: i })),
    );
  },
};
function formulaLoop(it: Interp, args: (Expr | Spread)[], env: Env, kind: string): unknown {
  const [listE, body, init] = args as Expr[];
  if (!listE || !body) return NOT_SPECIAL;
  const list = it.eval(listE, env);
  if (!Array.isArray(list))
    return kind === "reduce" ? it.eval(init ?? { t: "lit", v: undefined }, env) : [];
  if (body.t === "fn") {
    // map(list, x => …): a plain function
    const f = it.eval(body, env);
    if (kind === "map") return list.map((x, i) => it.call(f, [x, i]));
    if (kind === "filter") return list.filter((x, i) => it.call(f, [x, i]));
    if (kind === "sort") return sortWith(it, list.slice(), f);
    if (kind === "reduce")
      return list.reduce((a, x, i) => it.call(f, [a, x, i]), init ? it.eval(init, env) : 0);
  }
  it.tick(list.length);
  if (kind === "map") return list.map((x, i) => it.eval(body, env.child({ $item: x, $index: i })));
  if (kind === "filter")
    return list.filter((x, i) => it.eval(body, env.child({ $item: x, $index: i })));
  if (kind === "sort")
    return list.slice().sort((a, b) => {
      const x = it.eval(body, env.child({ $item: a })) as any;
      const y = it.eval(body, env.child({ $item: b })) as any;
      return x < y ? -1 : x > y ? 1 : 0;
    });
  let acc = init ? it.eval(init, env) : 0;
  if (kind === "reduce") {
    for (const [i, x] of list.entries())
      acc = it.eval(body, env.child({ $item: x, $index: i, $acc: acc }));
    return acc;
  }
  return list.map((x, i) => (acc = it.eval(body, env.child({ $item: x, $index: i, $acc: acc }))));
}
