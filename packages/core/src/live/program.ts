/**
 * A Live program: the declarations of one markup region (states, derived values, timers) and the
 * reactive bookkeeping that lets each drawn node re-render only when a state it read changes.
 *
 *   {@state seats = 8}                       {@body const [seats, setSeats] = useState(8)}
 *   {@let price = seats * 29000}             {@body const price = seats * 29000}
 *   {@let fmt = s => `${s}원`}               {@body function fmt(s) { return `${s}원` }}
 *   {@body useInterval(() => t += 1, playing ? 50 : null)}
 */
import { Env, type Host, Interp, LiveError, LiveFn, MISSING, Native } from "./interp.js";
import { type Expr, parseExpr, parseStatements, type Stmt } from "./syntax.js";

export type LiveDecl =
  | { kind: "state"; name: string; init: Expr; setter?: string }
  | { kind: "let"; name: string; expr: Expr }
  | { kind: "timer"; fn: Expr; delay: Expr };

/** State values of one surface. Kept by the runtime, so they outlive the drawing (scrolling away and back). */
export class LiveState {
  readonly values = new Map<string, unknown>();
  private listeners = new Map<string, Set<() => void>>();
  get(name: string): unknown {
    return this.values.get(name);
  }
  has(name: string): boolean {
    return this.values.has(name);
  }
  /** Sets values without telling anyone (first values). */
  seed(name: string, value: unknown) {
    if (!this.values.has(name)) this.values.set(name, value);
  }
  /** Writes several values, then tells the readers of the ones that changed. */
  write(updates: Map<string, unknown>) {
    const changed: string[] = [];
    for (const [k, v] of updates) {
      if (this.values.has(k) && Object.is(this.values.get(k), v)) continue;
      this.values.set(k, v);
      changed.push(k);
    }
    for (const k of changed) for (const fn of [...(this.listeners.get(k) ?? [])]) fn();
  }
  subscribe(name: string, fn: () => void): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(fn);
    return () => set?.delete(fn);
  }
}

export interface LiveActions {
  /** send('…'): a new message from the person, sent now. */
  send?(text: string): void;
  /** ask('…'): text put in the person's input to edit. */
  ask?(text: string): void;
  open?(url: string): void;
  copy?(text: string): void;
}

const HOOK =
  /^(?:(?:DIL|React|GenUI)\.)?(useState|useMemo|useCallback|useRef|useInterval|useEffect)$/;
const calleeName = (e: Expr): string | null =>
  e.t === "id"
    ? e.n
    : e.t === "mem" && e.o.t === "id" && e.p.t === "str"
      ? `${e.o.n}.${e.p.v}`
      : null;

/** The declarations in one `{@…}` statement (`{@state a = 1}`, `{@let b = a * 2}`, `{@body …}`). */
export function declarations(body: string): { decls: LiveDecl[]; problems: string[] } {
  const decls: LiveDecl[] = [];
  const problems: string[] = [];
  let text = body.trim();
  const sigil = /^(state|let|body|const|var)\b\s*/.exec(text);
  const kind = sigil?.[1] === "state" ? "state" : "let";
  if (sigil && sigil[1] !== "const" && sigil[1] !== "var") text = text.slice(sigil[0].length);
  // `{@state x = 1}` and `{@let x = …}` are a name and an expression; write them as declarations.
  if (
    sigil &&
    (sigil[1] === "state" || sigil[1] === "let") &&
    /^[A-Za-z_$][\w$]*\s*=(?!=)/.test(text)
  )
    text = `let ${text}`;
  let stmts: Stmt[];
  try {
    stmts = parseStatements(text);
  } catch (error) {
    return { decls, problems: [`${error instanceof Error ? error.message : error}`] };
  }
  for (const s of stmts) {
    if (s.t === "decl") {
      for (const d of s.list) {
        const init = d.init;
        const call = init?.t === "call" ? init : null;
        const hook = call ? HOOK.exec(calleeName(call.f) ?? "")?.[1] : undefined;
        if (hook === "useState" && call) {
          const [first] = call.args;
          const initExpr: Expr =
            first && first.t !== "spread" ? unwrapLazy(first) : { t: "lit", v: undefined };
          const names =
            d.p.t === "arrp"
              ? d.p.items.map((x) => (x?.t === "id" ? x.n : undefined))
              : d.p.t === "id"
                ? [d.p.n]
                : [];
          if (names[0])
            decls.push({
              kind: "state",
              name: names[0],
              init: initExpr,
              ...(names[1] ? { setter: names[1] } : {}),
            });
          continue;
        }
        if (hook === "useRef" && call && d.p.t === "id") {
          const [first] = call.args;
          decls.push({
            kind: "state",
            name: d.p.n,
            init: {
              t: "obj",
              props: [
                {
                  k: { t: "str", v: "current" },
                  v: first && first.t !== "spread" ? first : { t: "lit", v: undefined },
                },
              ],
            },
          });
          continue;
        }
        if ((hook === "useMemo" || hook === "useCallback") && call && d.p.t === "id") {
          const [fn] = call.args;
          if (fn && fn.t !== "spread")
            decls.push({
              kind: "let",
              name: d.p.n,
              expr: hook === "useMemo" ? { t: "call", f: fn, args: [], opt: false } : fn,
            });
          continue;
        }
        if (d.p.t === "id" && init) {
          decls.push(
            kind === "state" || sigil?.[1] === "state"
              ? { kind: "state", name: d.p.n, init }
              : { kind: "let", name: d.p.n, expr: init },
          );
          continue;
        }
        if (d.p.t === "id" && !init) {
          decls.push({ kind: "state", name: d.p.n, init: { t: "lit", v: undefined } });
          continue;
        }
        // `const {a, b} = obj`: each name reads its part.
        if (init && (d.p.t === "objp" || d.p.t === "arrp")) {
          const src = init;
          if (d.p.t === "objp")
            for (const p of d.p.props)
              if (p.v.t === "id")
                decls.push({
                  kind: "let",
                  name: p.v.n,
                  expr: { t: "mem", o: src, p: p.k, opt: true },
                });
          if (d.p.t === "arrp")
            d.p.items.forEach((p, i) => {
              if (p?.t === "id")
                decls.push({
                  kind: "let",
                  name: p.n,
                  expr: { t: "mem", o: src, p: { t: "num", v: i }, opt: true },
                });
            });
          continue;
        }
        problems.push("unsupported declaration");
      }
      continue;
    }
    if (s.t === "expr" && s.e.t === "call") {
      const hook = HOOK.exec(calleeName(s.e.f) ?? "")?.[1];
      const [fn, delay] = s.e.args;
      if (hook === "useInterval" && fn && fn.t !== "spread") {
        decls.push({
          kind: "timer",
          fn,
          delay: delay && delay.t !== "spread" ? delay : { t: "num", v: 1000 },
        });
        continue;
      }
      if (hook === "useEffect") {
        problems.push("useEffect is not supported; use useInterval for timers");
        continue;
      }
    }
    if (s.t === "expr" && s.e.t === "assign" && s.e.target.t === "id" && s.e.op === "=") {
      decls.push({
        kind: kind === "state" ? "state" : "let",
        name: s.e.target.n,
        ...(kind === "state" ? { init: s.e.v } : { expr: s.e.v }),
      } as LiveDecl);
      continue;
    }
    if (s.t !== "empty") problems.push(`statement left out (${s.t})`);
  }
  return { decls, problems };
}
/** useState(() => 0) starts with 0. */
function unwrapLazy(e: Expr): Expr {
  return e.t === "fn" && !e.block && e.params.length === 0 ? (e.body as Expr) : e;
}

type LetCell = {
  expr: Expr;
  value?: unknown;
  error?: unknown;
  deps?: Set<string>;
  seen?: number[];
  busy?: boolean;
  done?: boolean;
};

/** Step budgets: drawing must stay fast; a handler or timer may do more. */
export const RENDER_BUDGET = 60_000;
export const RUN_BUDGET = 120_000;

export class LiveProgram {
  readonly states = new Map<string, Expr>();
  readonly setters = new Map<string, string>();
  readonly lets = new Map<string, LetCell>();
  readonly timers: { fn: Expr; delay: Expr }[] = [];
  readonly root = new Env();
  private versions = new Map<string, number>();
  private watchers = new Map<string, Set<() => void>>();
  private pending: Map<string, unknown> | null = null;
  private unsubscribe: (() => void)[] = [];
  private actionFns: Record<string, Native>;

  constructor(
    decls: LiveDecl[],
    readonly store: LiveState,
    private actions: LiveActions = {},
  ) {
    for (const d of decls) {
      if (d.kind === "state") {
        if (this.states.has(d.name) || this.lets.has(d.name)) continue;
        this.states.set(d.name, d.init);
        this.setters.set(d.setter ?? `set${d.name[0]?.toUpperCase()}${d.name.slice(1)}`, d.name);
      } else if (d.kind === "let") {
        if (!this.states.has(d.name)) this.lets.set(d.name, { expr: d.expr });
      } else this.timers.push({ fn: d.fn, delay: d.delay });
    }
    for (const name of this.states.keys())
      this.unsubscribe.push(store.subscribe(name, () => this.changed(name)));
    const text = (v: unknown) =>
      typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
    const act = (name: keyof LiveActions) =>
      new Native(name, ([v]) => {
        if (!this.pending) throw new LiveError(`${name}() runs only when tapped`);
        this.actions[name]?.(text(v));
      });
    this.actionFns = {
      send: act("send"),
      ask: act("ask"),
      open: act("open"),
      copy: act("copy"),
      issueNewTurn: act("send"),
      openUrl: act("open"),
      copyText: act("copy"),
      followUp: act("send"),
    };
  }

  dispose() {
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
  }

  /** The state's value; first use evaluates its starting value. */
  private stateValue(name: string): unknown {
    if (this.pending?.has(name)) return this.pending.get(name);
    if (!this.store.has(name)) {
      let v: unknown;
      try {
        v = new Interp(this.host(null), RENDER_BUDGET).eval(
          this.states.get(name) as Expr,
          this.root,
        );
      } catch {
        v = undefined;
      }
      this.store.seed(name, v);
    }
    return this.store.get(name);
  }

  private changed(name: string) {
    this.versions.set(name, (this.versions.get(name) ?? 0) + 1);
    for (const fn of [...(this.watchers.get(name) ?? [])]) fn();
  }

  /** Calls `fn` whenever one of `deps` changes. */
  watch(deps: Iterable<string>, fn: () => void): () => void {
    const names = [...deps];
    for (const n of names) {
      let set = this.watchers.get(n);
      if (!set) {
        set = new Set();
        this.watchers.set(n, set);
      }
      set.add(fn);
    }
    return () => {
      for (const n of names) this.watchers.get(n)?.delete(fn);
    };
  }
  /** A number that changes whenever one of `deps` changes. */
  stamp(deps: Iterable<string>): number {
    let s = 0;
    for (const n of deps) s += (this.versions.get(n) ?? 0) * 31 + n.length;
    return s;
  }

  host(deps: Set<string> | null): Host {
    return {
      get: (name) => {
        if (this.states.has(name)) {
          deps?.add(name);
          return this.stateValue(name);
        }
        if (this.lets.has(name)) return this.letValue(name, deps);
        const setter = this.setters.get(name);
        if (setter) return this.setterFn(setter);
        const action = this.actionFns[name];
        if (action) return action;
        return MISSING;
      },
      set: (name, value) => {
        if (!this.states.has(name)) return false;
        if (!this.pending)
          throw new LiveError(`${name} changes only when tapped (drawing cannot change state)`);
        this.pending.set(name, value);
        return true;
      },
      isState: (name) => this.states.has(name),
    };
  }

  private setterFn(name: string): Native {
    return new Native(`set${name}`, ([v], it) => {
      const next =
        v instanceof LiveFn || v instanceof Native ? it.call(v, [this.stateValue(name)]) : v;
      if (!this.pending) throw new LiveError(`set${name}() runs only when tapped`);
      this.pending.set(name, next);
    });
  }

  private letValue(name: string, deps: Set<string> | null): unknown {
    const cell = this.lets.get(name) as LetCell;
    if (cell.done && cell.deps && !this.pending) {
      const seen = cell.seen as number[];
      let i = 0;
      let fresh = true;
      for (const d of cell.deps) if ((this.versions.get(d) ?? 0) !== seen[i++]) fresh = false;
      if (fresh) {
        if (deps) for (const d of cell.deps) deps.add(d);
        if (cell.error) throw cell.error;
        return cell.value;
      }
    }
    if (cell.busy) throw new LiveError(`${name} refers to itself`);
    cell.busy = true;
    const own = new Set<string>();
    try {
      cell.value = new Interp(this.host(own), RENDER_BUDGET).eval(cell.expr, this.root);
      cell.error = undefined;
    } catch (error) {
      cell.value = undefined;
      cell.error = error;
    } finally {
      cell.busy = false;
    }
    // While a handler runs, values read mid-way are not kept (they may see half-done writes).
    if (!this.pending) {
      cell.deps = own;
      cell.seen = [...own].map((d) => this.versions.get(d) ?? 0);
      cell.done = true;
    }
    if (deps) for (const d of own) deps.add(d);
    if (cell.error) throw cell.error;
    return cell.value;
  }

  /** Evaluates an expression for drawing; the states it read are added to `deps`. */
  read(expr: Expr | string, env: Env = this.root, deps: Set<string> | null = null): unknown {
    const e = typeof expr === "string" ? parseExpr(expr) : expr;
    return new Interp(this.host(deps), RENDER_BUDGET).eval(e, env);
  }

  /**
   * Runs a handler (a tap, a change, a timer tick). `code` is a function value, an expression that
   * gives one (`() => …`, `setX`), or statements (`x = 1; y++`). Writes land together at the end.
   */
  run(code: Expr | Stmt[] | LiveFn | Native, env: Env = this.root, args: unknown[] = []): void {
    const outer = this.pending;
    const pending = outer ?? new Map<string, unknown>();
    this.pending = pending;
    let ok = false;
    try {
      const it = new Interp(this.host(null), RUN_BUDGET);
      if (code instanceof LiveFn || code instanceof Native) it.call(code, args);
      else if (Array.isArray(code)) it.exec(code, env.child());
      else {
        const v = it.eval(code, env);
        if (v instanceof LiveFn || v instanceof Native) it.call(v, args);
      }
      ok = true;
    } finally {
      // All or nothing: a handler that fails half-way changes nothing.
      if (!outer) {
        this.pending = null;
        if (ok && pending.size) this.store.write(pending);
      }
    }
  }

  /** Starting values of every state, in order (for the text form of a UI). */
  initialValues(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const name of this.states.keys()) out[name] = this.stateValue(name);
    return out;
  }
}

/** A handler attribute's code: an expression (`() => …`, `setX`) or statements (`x = 1; y++`). */
export function handlerCode(src: string): Expr | Stmt[] {
  const text = src.trim();
  try {
    const e = parseExpr(text);
    return e;
  } catch {
    return parseStatements(text.startsWith("{") && text.endsWith("}") ? text.slice(1, -1) : text);
  }
}
