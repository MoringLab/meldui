/**
 * A markup region as a Live document: the element tree (drawn by a renderer that evaluates it
 * directly) and the region's declarations. Re-parsing a longer prefix of the same source keeps
 * every finished node as the same object (`shareTree`), so a renderer redraws only what is new.
 */
import { type El, type Node, parseMarkup } from "../markup.js";
import { type Env, Interp, LiveError, MISSING, show } from "./interp.js";
import { desugarJsx } from "./jsx.js";
import { declarations, type LiveDecl, LiveProgram, LiveState } from "./program.js";
import { parseStatements } from "./syntax.js";

export type LiveDoc = {
  nodes: Node[];
  decls: LiveDecl[];
  /** Same text ⇔ same declarations (a renderer rebuilds its program when this changes). */
  signature: string;
  problems: string[];
  /** Something to draw (an element or text), not only declarations. */
  drawable: boolean;
};

const docCache = new Map<string, LiveDoc>();

/** Parses a region (cached by source; `final` once the region has ended). */
export function parseLive(source: string, final: boolean): LiveDoc {
  const key = `${final ? 1 : 0}${source}`;
  const hit = docCache.get(key);
  if (hit) return hit;
  const parsed = parseMarkup(desugarJsx(source), final);
  const decls: LiveDecl[] = [];
  const problems: string[] = [];
  const bodies: string[] = [];
  let drawable = false;
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.type === "state" || n.type === "let" || n.type === "decl") {
        const body = n.body ?? "";
        bodies.push(body);
        const d = declarations(body);
        decls.push(...d.decls);
        problems.push(...d.problems.map((p) => `${p} in {@${body.slice(0, 40)}}`));
      } else if (n.type === "el") {
        drawable = true;
        walk(n.children);
      } else if (n.type === "each") {
        // Declarations inside a loop belong to each row (withLocals); only look for drawing here.
        if (hasDrawing(n.children)) drawable = true;
      } else if (n.type === "if") {
        walk(n.yes);
        walk(n.else);
      } else if (n.type === "text" && n.text.trim()) drawable = true;
    }
  };
  walk(parsed.nodes);
  if (parsed.truncated && final) problems.push("unterminated tag");
  const doc: LiveDoc = {
    nodes: parsed.nodes,
    decls,
    signature: bodies.join("\u0000"),
    problems,
    drawable,
  };
  if (docCache.size > 200) docCache.delete(docCache.keys().next().value as string);
  docCache.set(key, doc);
  return doc;
}

function hasDrawing(nodes: Node[]): boolean {
  return nodes.some((n) =>
    n.type === "el" || (n.type === "text" && n.text.trim())
      ? true
      : n.type === "each"
        ? hasDrawing(n.children)
        : n.type === "if"
          ? hasDrawing(n.yes) || hasDrawing(n.else)
          : false,
  );
}

/**
 * `env` plus the `{@let}`s written among `nodes` (inside a loop: one value per row). Unchanged
 * values keep the previous scope (`prev`), so a renderer does not redraw rows that did not change.
 */
export function withLocals(
  nodes: Node[],
  env: Env,
  program: LiveProgram,
  deps: Set<string> | null,
  prev?: Env,
): Env {
  const locals = nodes.filter((n) => n.type === "state" || n.type === "let" || n.type === "decl");
  if (!locals.length) return env;
  const scope = env.child();
  for (const n of locals)
    for (const d of declarations((n as { body?: string }).body ?? "").decls) {
      if (d.kind === "timer") continue;
      let v: unknown;
      try {
        v = program.read(d.kind === "let" ? d.expr : d.init, scope, deps);
      } catch {
        v = undefined;
      }
      scope.vars.set(d.name, v);
    }
  if (
    prev &&
    prev.parent === env &&
    prev.vars.size === scope.vars.size &&
    [...scope.vars].every(([k, v]) => prev.vars.get(k) === v)
  )
    return prev;
  return scope;
}

const keyOf = (n: Node) => `${n.type}:${n.at}:${n.end}`;
const closed = (n: Node) => n.end !== undefined && !("open" in n && n.open);

/**
 * `next` with every finished node that also is in `prev` replaced by prev's object. Nodes are
 * compared by where they start and end: the source only grows, so the same span is the same text.
 */
export function shareTree(prev: Node[] | undefined, next: Node[]): Node[] {
  if (!prev || prev === next) return next;
  const done = new Map<string, Node>();
  const collect = (nodes: Node[]) => {
    for (const n of nodes) {
      if (closed(n)) done.set(keyOf(n), n);
      else if (n.type === "el" || n.type === "each") collect(n.children);
      else if (n.type === "if") {
        collect(n.yes);
        collect(n.else);
      }
    }
  };
  collect(prev);
  if (!done.size) return next;
  const map = (nodes: Node[]): Node[] => {
    let changed = false;
    const out = nodes.map((n) => {
      const same = closed(n) ? done.get(keyOf(n)) : undefined;
      if (same) {
        changed = true;
        return same;
      }
      if (n.type === "el" || n.type === "each") {
        const kids = map(n.children);
        if (kids !== n.children) {
          changed = true;
          return { ...n, children: kids };
        }
      } else if (n.type === "if") {
        const yes = map(n.yes);
        const no = map(n.else);
        if (yes !== n.yes || no !== n.else) {
          changed = true;
          return { ...n, yes, else: no };
        }
      }
      return n;
    });
    return changed ? out : nodes;
  };
  return map(next);
}

/** A loop's scope for one row; writing to the item writes that row of the list (when the list is a state). */
export function rowScope(
  env: Env,
  each: { list: string; item: string; index?: string },
  item: unknown,
  i: number,
): Env {
  const scope = env.child(each.index ? { [each.index]: i } : undefined);
  scope.vars.set("\u0000row", item);
  scope.vars.set("\u0000i", i);
  if (/^[[{]/.test(each.item)) {
    // {#each pairs as [label, value]}
    try {
      const decl = parseStatements(`let ${each.item} = 0`)[0];
      if (decl?.t === "decl" && decl.list[0])
        new Interp(NO_HOST, 2_000).bind(decl.list[0].p, item, scope, true);
    } catch {}
    return scope;
  }
  scope.vars.set(each.item, item);
  if (/^[A-Za-z_$][\w$]*(\s*(\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\]))*$/.test(each.list.trim()))
    scope.vars.set(`\u0000${each.item}`, `(${each.list})[${i}]`);
  return scope;
}
const NO_HOST = { get: () => MISSING, set: () => false, isState: () => false };

/** Text with `{expr}` parts: literal strings and expression sources, in order. */
export function splitText(text: string): (string | { expr: string })[] {
  const out: (string | { expr: string })[] = [];
  let i = 0;
  let lit = "";
  while (i < text.length) {
    const c = text[i];
    if (c === "{") {
      let depth = 0;
      let k = i;
      for (; k < text.length; k++) {
        const d = text[k];
        if (d === '"' || d === "'" || d === "`") {
          for (k++; k < text.length && text[k] !== d; k++) if (text[k] === "\\") k++;
        } else if (d === "{") depth++;
        else if (d === "}" && --depth === 0) break;
      }
      if (k >= text.length) break; // a half-typed {… waits for its }
      const expr = text.slice(i + 1, k).trim();
      if (lit) out.push(lit);
      lit = "";
      if (expr && !expr.startsWith("/*")) out.push({ expr });
      i = k + 1;
      continue;
    }
    lit += c;
    i++;
  }
  if (lit) out.push(lit);
  return out;
}

const INLINE_TEXT =
  /^(text|title|h[1-6]|heading|caption|label|subtitle|p|span|b|i|u|s|strong|em|code|mark|small|button|badge|chip|tag|a|link|checkbox|switch|option)$/;
const TEXT_ATTRS = new Set([
  "label",
  "title",
  "subtitle",
  "text",
  "caption",
  "placeholder",
  "alt",
  "prompt",
]);
const SKIP_TEXT = new Set(["svg"]);

/**
 * The words of a UI at its starting state: the text form used for copy, previews and screen
 * readers that cannot see the drawing. Computed values are filled in.
 */
export function liveText(doc: LiveDoc, max = 4000): string {
  const program = new LiveProgram(doc.decls, new LiveState());
  const out: string[] = [];
  let size = 0;
  const value = (expr: string, env = program.root) => {
    try {
      return show(program.read(expr, env));
    } catch (error) {
      return error instanceof LiveError ? "" : "";
    }
  };
  const words = (text: string, env = program.root) =>
    splitText(text)
      .map((p) => (typeof p === "string" ? p : value(p.expr, env)))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  const push = (s: string) => {
    if (!s || size > max) return;
    out.push(s);
    size += s.length;
  };
  const walk = (nodes: Node[], env = program.root, inline: string[] | null = null) => {
    for (const n of nodes) {
      if (size > max) return;
      if (n.type === "text") {
        const w = words(n.text, env);
        if (inline) inline.push(w);
        else push(w.replace(/\*\*|~~/g, ""));
      } else if (n.type === "el") {
        const lower = n.name.toLowerCase();
        if (SKIP_TEXT.has(lower)) continue;
        const own: string[] = [];
        for (const a of n.attrs as El["attrs"])
          if (TEXT_ATTRS.has(a.name) && a.kind === "str") own.push(String(a.value));
          else if (TEXT_ATTRS.has(a.name) && a.kind === "expr")
            own.push(value(String(a.value), env));
        if (!inline && !INLINE_TEXT.test(lower)) {
          // A layout: its parts are lines of their own.
          if (own.length) push(own.join(" "));
          walk(n.children, env, null);
          continue;
        }
        const kids: string[] = [];
        walk(n.children, env, kids);
        const line = [...own, ...kids]
          .filter(Boolean)
          .join(" ")
          .replace(/\*\*|~~/g, "")
          .trim();
        if (inline) inline.push(line);
        else push(line);
      } else if (n.type === "each") {
        let list: unknown;
        try {
          list = program.read(n.list, env);
        } catch {
          list = [];
        }
        const items = Array.isArray(list) ? list.slice(0, 30) : [];
        items.forEach((item, i) => {
          const row = rowScope(env, n, item, i);
          walk(n.children, withLocals(n.children, row, program, null), inline);
        });
      } else if (n.type === "if") {
        let yes = false;
        try {
          yes = Boolean(program.read(n.cond, env));
        } catch {}
        walk(yes ? n.yes : n.else, env, inline);
      }
    }
  };
  walk(doc.nodes);
  program.dispose();
  return out.join("\n").slice(0, max);
}

/** The `{@…}` declarations of a source, as text (carried to the regions after it). */
export function declarationText(source: string): string {
  const parsed = parseMarkup(source, true);
  return parsed.nodes
    .filter((n) => n.type === "state" || n.type === "let" || n.type === "decl")
    .map((n) => source.slice(n.at ?? 0, n.end ?? 0))
    .join("\n");
}
