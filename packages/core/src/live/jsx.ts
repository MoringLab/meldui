/**
 * React habits in Live markup: JSX written inside {…} becomes the language's own blocks.
 *
 *   {items.map((item, i) => (<row>…</row>))}   →  {#each items as item, i}<row>…</row>{/each}
 *   {open && <box>…</box>}                      →  {#if open}<box>…</box>{/if}
 *   {done ? <icon name="check"/> : <text>…</text>}  →  {#if done}…{:else}…{/if}
 *
 * Works on half-written input too: an unfinished `{items.map(x => (<row>…` already opens the
 * block, so the rows draw while they stream. Anything else inside {…} is left as it is.
 */

const IDENT = "[A-Za-z_$][\\w$]*";
const PATTERN = `(?:${IDENT}|\\[[^\\]]*\\]|\\{[^}]*\\})`;
const MAP_HEAD = new RegExp(
  `^\\s*([\\s\\S]+?)\\.map\\(\\s*(?:\\(\\s*)?(${PATTERN})(?:\\s*,\\s*(${IDENT}))?\\s*\\)?\\s*=>\\s*(?:\\{\\s*return\\s*)?\\(?\\s*(?=<[A-Za-z])`,
);
const AND_HEAD = /^\s*([\s\S]+?)\s*&&\s*\(?\s*(?=<[A-Za-z])/;
const TERNARY_HEAD = /^\s*([\s\S]+?)\s*\?\s*\(?\s*(?=<[A-Za-z])/;

/** End of a JS string or template starting at `i` (index after it), or -1. */
function skipString(src: string, i: number): number {
  const q = src[i];
  for (let k = i + 1; k < src.length; k++) {
    if (src[k] === "\\") k++;
    else if (q === "`" && src[k] === "$" && src[k + 1] === "{") {
      const e = scanJs(src, k + 2, "}");
      if (e < 0) return -1;
      k = e;
    } else if (src[k] === q) return k + 1;
  }
  return -1;
}

/** Scans JavaScript from `i` up to the unmatched `stop`; returns its index, or -1 when unfinished. */
function scanJs(src: string, i: number, stop: string): number {
  const close: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  let prev = "(";
  for (let k = i; k < src.length; k++) {
    const c = src[k] as string;
    if (c === '"' || c === "'" || c === "`") {
      const e = skipString(src, k);
      if (e < 0) return -1;
      k = e - 1;
      prev = "a";
      continue;
    }
    if (c === "<" && /[A-Za-z]/.test(src[k + 1] ?? "") && /[(,?:=>&|[{!]/.test(prev)) {
      const e = scanElement(src, k);
      if (e < 0) return -1;
      k = e - 1;
      prev = ")";
      continue;
    }
    if (c in close) stack.push(close[c] as string);
    else if (c === ")" || c === "]" || c === "}") {
      if (!stack.length) return c === stop ? k : -1;
      stack.pop();
    }
    if (!/\s/.test(c)) prev = c;
  }
  return -1;
}

/** Scans one JSX element from its `<`; returns the index after it, or -1 when unfinished. */
export function scanElement(src: string, i: number): number {
  const name = /^<([A-Za-z][\w.:-]*)/.exec(src.slice(i, i + 80));
  if (!name) return -1;
  let k = i + name[0].length;
  // attributes
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === '"' || c === "'") {
      const e = src.indexOf(c, k + 1);
      if (e < 0) return -1;
      k = e;
    } else if (c === "{") {
      const e = scanJs(src, k + 1, "}");
      if (e < 0) return -1;
      k = e;
    } else if (c === "/" && src[k + 1] === ">") return k + 2;
    else if (c === ">") break;
  }
  if (k >= src.length) return -1;
  k++;
  // children
  while (k < src.length) {
    const c = src[k];
    if (c === "<" && src[k + 1] === "/") {
      const e = src.indexOf(">", k);
      return e < 0 ? -1 : e + 1;
    }
    if (c === "<" && /[A-Za-z]/.test(src[k + 1] ?? "")) {
      const e = scanElement(src, k);
      if (e < 0) return -1;
      k = e;
      continue;
    }
    if (c === "{") {
      const e = scanJs(src, k + 1, "}");
      if (e < 0) return -1;
      k = e + 1;
      continue;
    }
    k++;
  }
  return -1;
}

/** Elements one after another from `i` (a fragment's worth): the index after the last, or -1. */
function scanElements(src: string, i: number): { end: number; done: boolean } {
  let k = i;
  let last = i;
  let any = false;
  for (;;) {
    while (k < src.length && /\s/.test(src[k] as string)) k++;
    if (src[k] !== "<" || !/[A-Za-z]/.test(src[k + 1] ?? "")) return { end: last, done: any };
    const e = scanElement(src, k);
    if (e < 0) return { end: src.length, done: false };
    any = true;
    k = last = e;
  }
}

/** One {…} expression in text: its Live form, or null when it holds no JSX we understand. */
function rewrite(expr: string, complete: boolean): string | null {
  const map = MAP_HEAD.exec(expr);
  if (map) {
    const [head, list, item, index] = map as unknown as [
      string,
      string,
      string,
      string | undefined,
    ];
    const body = scanElements(expr, head.length);
    const open = `{#each ${list.trim()} as ${item}${index ? `, ${index}` : ""}}`;
    if (!body.done) return complete ? null : open + expr.slice(head.length);
    const rest = expr.slice(body.end);
    if (!/^\s*\)?\s*;?\s*\}?\s*\)\s*$/.test(rest) && complete) return null;
    return `${open}${expr.slice(head.length, body.end)}{/each}`;
  }
  const and = AND_HEAD.exec(expr);
  const tern = TERNARY_HEAD.exec(expr);
  const pick =
    and && (!tern || and[0].length <= tern[0].length)
      ? { m: and, kind: "and" }
      : tern
        ? { m: tern, kind: "tern" }
        : null;
  if (!pick) return null;
  const head = pick.m[0];
  const cond = (pick.m[1] as string).trim();
  const body = scanElements(expr, head.length);
  if (!body.done) return complete ? null : `{#if ${cond}}${expr.slice(head.length)}`;
  const yes = expr.slice(head.length, body.end);
  const rest = expr.slice(body.end);
  if (pick.kind === "and") {
    if (complete && !/^\s*\)?\s*$/.test(rest)) return null;
    return `{#if ${cond}}${yes}{/if}`;
  }
  const colon = /^\s*\)?\s*:\s*\(?\s*/.exec(rest);
  if (!colon) return complete ? null : `{#if ${cond}}${yes}`;
  const after = rest.slice(colon[0].length);
  if (/^(null|undefined|false|''|""|``)?\s*\)?\s*$/.test(after)) return `{#if ${cond}}${yes}{/if}`;
  const no = scanElements(after, 0);
  if (!no.done) return complete ? null : `{#if ${cond}}${yes}{:else}${after}`;
  if (complete && !/^\s*\)?\s*$/.test(after.slice(no.end))) return null;
  return `{#if ${cond}}${yes}{:else}${after.slice(0, no.end)}{/if}`;
}

/** The source with JSX-in-{…} turned into {#each}/{#if}; unchanged when there is none. */
export function desugarJsx(src: string): string {
  if (!/[&?]\s*\(?\s*<[A-Za-z]|=>\s*(?:\{\s*return\s*)?\(?\s*<[A-Za-z]/.test(src)) return src;
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    // A tag: copied as is (its attribute expressions are JavaScript, not text).
    if (c === "<" && /[A-Za-z/!]/.test(src[i + 1] ?? "")) {
      let k = i + 1;
      for (; k < src.length; k++) {
        const d = src[k];
        if (d === '"' || d === "'") {
          const e = src.indexOf(d, k + 1);
          k = e < 0 ? src.length : e;
        } else if (d === "{") {
          const e = scanJs(src, k + 1, "}");
          k = e < 0 ? src.length : e;
        } else if (d === ">") break;
      }
      out += src.slice(i, k + 1);
      i = k + 1;
      continue;
    }
    if (c === "{" && !/[@#:/]/.test(src[i + 1] ?? "")) {
      const e = scanJs(src, i + 1, "}");
      const expr = src.slice(i + 1, e < 0 ? src.length : e);
      const live = /</.test(expr) ? rewrite(expr, e >= 0) : null;
      if (live !== null) {
        out += desugarJsx(live);
        i = e < 0 ? src.length : e + 1;
        continue;
      }
      out += src.slice(i, e < 0 ? src.length : e + 1);
      i = e < 0 ? src.length : e + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
