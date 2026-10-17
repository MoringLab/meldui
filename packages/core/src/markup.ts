/**
 * Meld markup: UI written as tags, the way a model writes prose. Compiles to catalog components,
 * data model state and formulas, so nothing the model writes is ever run as code.
 *
 *   {@state seats = 8}
 *   {@let price = seats * 29000}
 *   <Box tone="subtle" padding="md" gap="sm">
 *     <Slider label="좌석" min={1} max={50} value={seats}/>
 *     <Text size="xl" weight="bold">{numberFormat(price, 0, true)}원</Text>
 *   </Box>
 *
 * - Tags are catalog components (case-insensitive). Text inside Text, Heading, Badge, Button,
 *   Callout or Markdown is their text; `{expr}` interpolates. Markdown and CodeBlock are raw.
 * - Attributes: name="text", name=3, name={expr}, bare name (= true). `{expr}` is a JSON-ish
 *   literal, a state reference (a two-way binding on inputs) or a formula.
 * - State: {@state name = literal}; derived: {@let name = formula}; also DIL's
 *   `const [x, setX] = useState(v)` and `const y = …` inside {@body …}.
 * - {#each list as item, i} … {/each} repeats its body per row; {#if cond} … {:else} … {/if}.
 * - on* attributes: `x = expr; y += 1`, `toggle(x)`, `setX(v)`, `ask("…")`, `open("url")`,
 *   `copy("…")`.
 * - Array props of objects take child tags named after the prop (Tabs → <Tab label>, Table →
 *   <Column key label/> and <Row …/>, Diagram → <Node/> <Edge/>); child-id props (Flip front/back)
 *   take <Front>/<Back>.
 *
 * Half-written input compiles too (the answer streams): an unfinished tag or statement is left
 * out, an open element that has content is closed, an open element without content is left out,
 * a half-typed `{…` in text is held back. Ids follow document order, so recompiling a longer
 * prefix of the same source keeps every id.
 */

import type { Component } from "@engine/protocol";
import { componentSchemas } from "@engine/protocol";

type Attr = { name: string; value: string | true; kind: "str" | "expr" | "bare" | "flag" };
type El = {
  type: "el";
  name: string;
  attrs: Attr[];
  children: Node[];
  open: boolean;
  raw?: boolean;
};
type TextNode = { type: "text"; text: string };
type Stmt = { type: "state" | "let"; name: string; expr: string };
type Each = {
  type: "each";
  list: string;
  item: string;
  index?: string;
  children: Node[];
  open: boolean;
};
type If = {
  type: "if";
  cond: string;
  yes: Node[];
  else: Node[];
  open: boolean;
  inElse: boolean;
  chained?: boolean;
};
type Node = El | TextNode | Stmt | Each | If;
type Frame = { node: El | Each | If | null; list: Node[] };

const RAW = new Set(["markdown", "codeblock"]);
const NAMES = new Map(Object.keys(componentSchemas).map((n) => [n.toLowerCase(), n]));
const ALIASES: Record<string, string> = {
  title: "Heading",
  caption: "Text",
  bold: "Text",
  label: "Text",
  view: "Box",
  stack: "Column",
  hstack: "Row",
  vstack: "Column",
  img: "Image",
  chip: "Badge",
  switch: "Checkbox",
  input: "TextField",
};
/** The prop a component's text content fills. */
const TEXT_PROP: Record<string, string> = {
  Text: "text",
  Heading: "text",
  Markdown: "text",
  Badge: "text",
  Callout: "text",
  Button: "label",
  CodeBlock: "code",
  Formula: "latex",
  Annotation: "text",
};
const EVENT = /^(on[A-Z]\w*|action)$/;

export function isMarkupStart(line: string): boolean {
  return (
    /^\s*(<[A-Za-z][\w.-]*(\s|\/?>|$)|\{@(state|let|body)\b|\{#(each|if)\b)/.test(line) &&
    !/^\s*<(https?|mailto):/i.test(line)
  );
}

/** Index of the "}" closing the "{" at `from`, or -1 (quotes respected). */
function closeBrace(src: string, from: number): number {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      for (i++; i < src.length && src[i] !== q; i++) if (src[i] === "\\") i++;
      if (i >= src.length) return -1;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

function parseTag(src: string, at: number): { el: El; end: number; self: boolean } | null {
  const m = /^<([A-Za-z][\w.:-]*)/.exec(src.slice(at, at + 80));
  if (!m) return null;
  const el: El = { type: "el", name: m[1] as string, attrs: [], children: [], open: true };
  let j = at + m[0].length;
  while (j < src.length) {
    while (j < src.length && /\s/.test(src[j] as string)) j++;
    if (src.startsWith("/>", j)) return { el, end: j + 2, self: true };
    if (src[j] === ">") return { el, end: j + 1, self: false };
    const name = /^[A-Za-z_@:][\w:.-]*/.exec(src.slice(j, j + 64));
    if (!name) {
      j++;
      continue;
    }
    j += name[0].length;
    let k = j;
    while (k < src.length && /\s/.test(src[k] as string)) k++;
    if (src[k] !== "=") {
      if (k >= src.length) return null;
      el.attrs.push({ name: name[0], value: true, kind: "flag" });
      continue;
    }
    k++;
    while (k < src.length && /\s/.test(src[k] as string)) k++;
    const c = src[k];
    if (c === '"' || c === "'") {
      let e = k + 1;
      let value = "";
      for (; e < src.length && src[e] !== c; e++) {
        if (src[e] === "\\" && e + 1 < src.length) e++;
        value += src[e];
      }
      if (e >= src.length) return null;
      el.attrs.push({ name: name[0], value, kind: "str" });
      j = e + 1;
    } else if (c === "{") {
      const e = closeBrace(src, k);
      if (e < 0) return null;
      el.attrs.push({ name: name[0], value: src.slice(k + 1, e).trim(), kind: "expr" });
      j = e + 1;
    } else {
      const bare = /^[^\s>]+?(?=\/>|>|\s|$)/.exec(src.slice(k));
      if (!bare || k + bare[0].length >= src.length) return null;
      el.attrs.push({ name: name[0], value: bare[0], kind: "bare" });
      j = k + bare[0].length;
    }
  }
  return null;
}

function statement(body: string): Stmt[] {
  let text = body.trim().replace(/^body\s+/, "");
  const kind = /^(state|let)\s+/.exec(text);
  if (kind) text = text.slice(kind[0].length);
  text = text.replace(/;\s*$/, "");
  const dil =
    /^(?:const|let|var)\s*\[\s*([A-Za-z_]\w*)\s*,\s*\w+\s*\]\s*=\s*(?:\w+\.)?useState\(([\s\S]*)\)$/.exec(
      text,
    );
  if (dil)
    return [
      {
        type: "state",
        name: dil[1] as string,
        expr: (dil[2] as string).replace(/,\s*\{[^}]*\}\s*$/, "").trim() || "null",
      },
    ];
  const plain = /^(?:const|let|var)?\s*([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(text);
  if (!plain) return [];
  return [
    {
      type: kind?.[1] === "state" ? "state" : "let",
      name: plain[1] as string,
      expr: (plain[2] as string).trim(),
    },
  ];
}

/** Parses as much of `src` as is complete. `open` counts elements and blocks left open. */
export function parseMarkup(
  src: string,
  final = true,
): { nodes: Node[]; open: number; truncated: boolean } {
  const root: Frame = { node: null, list: [] };
  const stack: Frame[] = [root];
  const top = () => stack[stack.length - 1] as Frame;
  let truncated = false;
  let i = 0;
  const pop = (test: (f: Frame) => boolean) => {
    for (let d = stack.length - 1; d > 0; d--)
      if (test(stack[d] as Frame)) {
        for (const f of stack.splice(d)) if (f.node) f.node.open = false;
        return;
      }
  };
  while (i < src.length) {
    if (src.startsWith("</", i)) {
      const e = src.indexOf(">", i);
      if (e < 0) {
        truncated = true;
        break;
      }
      const name = src
        .slice(i + 2, e)
        .trim()
        .toLowerCase();
      pop((f) => f.node?.type === "el" && f.node.name.toLowerCase() === name);
      i = e + 1;
      continue;
    }
    if (src[i] === "<" && /[A-Za-z]/.test(src[i + 1] ?? "")) {
      const tag = parseTag(src, i);
      if (!tag) {
        truncated = true;
        break;
      }
      top().list.push(tag.el);
      i = tag.end;
      if (tag.self) {
        tag.el.open = false;
        continue;
      }
      if (RAW.has(tag.el.name.toLowerCase())) {
        tag.el.raw = true;
        const close = new RegExp(`</${tag.el.name}\\s*>`, "i").exec(src.slice(i));
        const body = close ? src.slice(i, i + close.index) : src.slice(i);
        tag.el.children.push({ type: "text", text: body });
        tag.el.open = !close;
        i = close ? i + close.index + close[0].length : src.length;
        continue;
      }
      stack.push({ node: tag.el, list: tag.el.children });
      continue;
    }
    if (src[i] === "{" && /[@#:/]/.test(src[i + 1] ?? "")) {
      const e = closeBrace(src, i);
      if (e < 0) {
        truncated = true;
        break;
      }
      const body = src.slice(i + 2, e).trim();
      const sigil = src[i + 1];
      i = e + 1;
      if (sigil === "@") top().list.push(...statement(body));
      else if (sigil === "#") {
        const each = /^each\s+([\s\S]+?)\s+as\s+([A-Za-z_]\w*)(?:\s*,\s*([A-Za-z_]\w*))?$/.exec(
          body,
        );
        const cond = /^if\s+([\s\S]+)$/.exec(body);
        if (each) {
          const node: Each = {
            type: "each",
            list: (each[1] as string).trim(),
            item: each[2] as string,
            index: each[3],
            children: [],
            open: true,
          };
          top().list.push(node);
          stack.push({ node, list: node.children });
        } else if (cond) {
          const node: If = {
            type: "if",
            cond: cond[1] as string,
            yes: [],
            else: [],
            open: true,
            inElse: false,
          };
          top().list.push(node);
          stack.push({ node, list: node.yes });
        }
      } else if (sigil === ":") {
        const frame = top();
        if (frame.node?.type === "if") {
          const node = frame.node;
          node.inElse = true;
          frame.list = node.else;
          const elseIf = /^else\s+if\s+([\s\S]+)$/.exec(body);
          if (elseIf) {
            const chained: If = {
              type: "if",
              cond: elseIf[1] as string,
              yes: [],
              else: [],
              open: true,
              inElse: false,
              chained: true,
            };
            node.else.push(chained);
            stack.push({ node: chained, list: chained.yes });
          }
        }
      } else if (/^each\b/.test(body)) pop((f) => f.node?.type === "each");
      else if (/^if\b/.test(body)) pop((f) => f.node?.type === "if" && !f.node.chained);
      continue;
    }
    const next = src.slice(i).search(/<\/?[A-Za-z]|\{[@#:/]/);
    const end = next < 0 ? src.length : i + Math.max(next, 1);
    let text = src.slice(i, end);
    // Still streaming: the start of a tag or block at the very end is not text yet.
    if (end === src.length && !final) text = text.replace(/(<\/?|\{[@#:/]?)$/, "");
    if (text) top().list.push({ type: "text", text });
    i = end;
  }
  return { nodes: root.list, open: stack.length - 1, truncated };
}

// ── expressions ─────────────────────────────────────────────────────────────────────────────

type Scope = { item?: string; index?: string; nested: boolean };
type Ctx = {
  states: Map<string, unknown>;
  lets: Map<string, string>;
  components: Component[];
  next: number;
  prefix: string;
  final: boolean;
  diagnostics: string[];
  text: string[];
};

function literal(expr: string): { ok: true; value: unknown } | { ok: false } {
  const t = expr.trim();
  if (!t) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch {}
  // JS-ish literal: single quotes, bare keys, trailing commas, but no identifiers left.
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const c = t[i] as string;
    if (c === "'" || c === '"') {
      let s = "";
      for (i++; i < t.length && t[i] !== c; i++) {
        if (t[i] === "\\") s += t[++i] ?? "";
        else s += t[i];
      }
      if (i >= t.length) return { ok: false };
      out += JSON.stringify(s);
    } else out += c;
  }
  out = out.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":').replace(/,\s*([}\]])/g, "$1");
  if (/(^|[^"\w])(?!true\b|false\b|null\b)[A-Za-z_$]/.test(out.replace(/"(?:[^"\\]|\\.)*"/g, '""')))
    return { ok: false };
  try {
    return { ok: true, value: JSON.parse(out) };
  } catch {
    return { ok: false };
  }
}

/** Model JavaScript → a Meld formula: state names become paths, the row becomes $row. */
function formula(expr: string, ctx: Ctx, scope: Scope, depth = 0): string {
  let src = expr
    .replace(/===/g, "==")
    .replace(/!==/g, "!=")
    .replace(/\bMath\./g, "")
    .replace(/\.length\b/g, ".__count")
    .replace(/\bString\(([^()]*)\)/g, "format('{0}', $1)");
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (c === "'" || c === '"' || c === "`") {
      const start = i;
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      const body = src.slice(start + 1, i);
      out += c === "`" ? templateLiteral(body, ctx, scope) : `${c}${body}${c}`;
      continue;
    }
    const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
    if (!id) {
      out += c;
      continue;
    }
    const name = id[0];
    const prev = out.trimEnd().slice(-1);
    const call = /^\s*\(/.test(src.slice(i + name.length));
    i += name.length - 1;
    if (
      prev === "." ||
      prev === "/" ||
      call ||
      name.startsWith("$") ||
      /^(true|false|null)$/.test(name)
    )
      out += name;
    else if (scope.item === name) out += "$row";
    else if (scope.index === name) out += "$rowIndex";
    else if (ctx.lets.has(name) && depth < 8)
      out += `(${formula(ctx.lets.get(name) as string, ctx, scope, depth + 1)})`;
    else if (ctx.states.has(name)) out += `/${name}`;
    else out += name;
  }
  // x.__count (from .length) → count(x) for a simple operand.
  src = out.replace(/([$/\w.]+)\.__count\b/g, "count($1)");
  return src;
}

function templateLiteral(body: string, ctx: Ctx, scope: Scope): string {
  const parts: string[] = [];
  const args: string[] = [];
  const re = /\$\{([^}]*)\}/g;
  let last = 0;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    parts.push(body.slice(last, m.index), `{${args.length}}`);
    args.push(formula(m[1] as string, ctx, scope));
    last = m.index + m[0].length;
  }
  parts.push(body.slice(last));
  const template = `'${parts.join("").replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  return args.length ? `format(${[template, ...args].join(", ")})` : template;
}

/** A plain reference (state name, row field) → a data path for a binding, else null. */
function reference(expr: string, ctx: Ctx, scope: Scope): string | null {
  const t = expr.trim();
  const m = /^([A-Za-z_]\w*)((?:\.[A-Za-z_]\w*)*)$/.exec(t);
  if (!m) return null;
  const head = m[1] as string;
  const rest = (m[2] as string).split(".").filter(Boolean);
  if (scope.item === head) return rest.length ? rest.join("/") : null;
  if (ctx.states.has(head)) return `/${[head, ...rest].join("/")}`;
  return null;
}

function unwrap(schema: any): any {
  let s = schema;
  for (let n = 0; s && n < 8; n++) {
    const t = s._def?.typeName;
    if (t === "ZodOptional" || t === "ZodNullable" || t === "ZodDefault") s = s._def.innerType;
    else if (t === "ZodEffects") s = s._def.schema;
    else break;
  }
  return s;
}
function shapeOf(component: string): Record<string, any> {
  const schema = unwrap((componentSchemas as Record<string, any>)[component]);
  return schema?.shape ?? schema?._def?.shape?.() ?? {};
}
function baseKind(
  schema: any,
): "String" | "Number" | "Boolean" | "Array" | "Object" | "Enum" | null {
  const s = unwrap(schema);
  const t = s?._def?.typeName;
  if (t === "ZodUnion") {
    for (const o of s._def.options) {
      const k = baseKind(o);
      if (k && k !== "Object") return k;
    }
    return null;
  }
  return (
    (
      {
        ZodString: "String",
        ZodNumber: "Number",
        ZodBoolean: "Boolean",
        ZodArray: "Array",
        ZodObject: "Object",
        ZodEnum: "Enum",
        ZodTuple: "Array",
      } as Record<string, any>
    )[t] ?? null
  );
}
function dynamic(schema: any): boolean {
  const s = unwrap(schema);
  // A union of unions (Stat.value is text | number) is dynamic when any branch is.
  if (s?._def?.typeName === "ZodUnion")
    return s._def.options.some(
      (o: any) =>
        (unwrap(o)?._def?.typeName === "ZodObject" && "path" in (unwrap(o).shape ?? {})) ||
        (unwrap(o)?._def?.typeName === "ZodUnion" && dynamic(o)),
    );
  return String(s?.description ?? "").includes("DynamicValue");
}

/** The value an attribute becomes on `component.prop`. */
function attrValue(attr: Attr, component: string, prop: string, ctx: Ctx, scope: Scope): unknown {
  if (attr.kind === "flag") return true;
  if (attr.kind === "str") return attr.value;
  const raw = attr.value as string;
  if (attr.kind === "bare") {
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    if (raw === "true" || raw === "false") return raw === "true";
    if (ctx.states.has(raw)) return { path: `/${raw}` };
    return raw;
  }
  const lit = literal(raw);
  if (lit.ok) return lit.value;
  const schema = shapeOf(component)[prop];
  const ref = reference(raw, ctx, scope);
  if (ref && (!schema || dynamic(schema))) return { path: ref };
  if (schema && !dynamic(schema)) {
    // A static prop (enum, id list…) cannot be computed: keep a literal-looking value.
    return raw.replace(/^['"]|['"]$/g, "");
  }
  const kind = baseKind(schema) ?? "String";
  const call =
    kind === "Number"
      ? "computeNumber"
      : kind === "Boolean"
        ? "computeBoolean"
        : kind === "Array"
          ? "computeArray"
          : "computeString";
  return { call, args: { formula: formula(raw, ctx, scope) } };
}

function splitTop(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
    } else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === sep && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** An on* handler → an action (local state first; ask/open/copy for the rest). */
function action(raw: string, ctx: Ctx, scope: Scope): unknown {
  let body = raw
    .trim()
    .replace(/^\(\s*\)\s*=>\s*/, "")
    .replace(/^function\s*\(\)\s*/, "");
  if (body.startsWith("{") && body.endsWith("}")) body = body.slice(1, -1);
  const updates: { path: string; formula?: string; value?: unknown }[] = [];
  for (const stmt of splitTop(body, ";")) {
    const call = /^(?:GenUI\.)?(\w+)\(([\s\S]*)\)$/.exec(stmt);
    if (call) {
      const [, fn, args = ""] = call;
      const parts = splitTop(args, ",");
      const text = (index = 0) => {
        const lit = literal(parts[index] ?? "");
        return lit.ok
          ? lit.value
          : { call: "computeString", args: { formula: formula(parts[index] ?? "''", ctx, scope) } };
      };
      if (/^(ask|send|issueNewTurn|followUp|prompt)$/.test(fn as string)) {
        const value = text();
        return {
          event: {
            name: "ask",
            context: { text: typeof value === "string" ? value : String(parts[0] ?? "") },
          },
        };
      }
      if (/^(open|openUrl|link)$/.test(fn as string))
        return { functionCall: { call: "openUrl", args: { url: text() } } };
      if (/^(copy|copyText)$/.test(fn as string))
        return { functionCall: { call: "copyText", args: { text: text() } } };
      if (fn === "toggle") {
        const path = reference(parts[0] ?? "", ctx, scope);
        if (path) updates.push({ path, formula: `!${formula(parts[0] as string, ctx, scope)}` });
        continue;
      }
      if (fn === "set" && parts.length >= 2) {
        const path = reference(parts[0] as string, ctx, scope);
        if (path) updates.push({ path, formula: formula(parts.slice(1).join(","), ctx, scope) });
        continue;
      }
      const setter = /^set([A-Z]\w*)$/.exec(fn as string);
      if (setter) {
        const name = [...ctx.states.keys()].find(
          (k) => k.toLowerCase() === (setter[1] as string).toLowerCase(),
        );
        if (name) updates.push({ path: `/${name}`, formula: formula(args, ctx, scope) });
        continue;
      }
      ctx.diagnostics.push(`unknown_action:${fn}`);
      continue;
    }
    const step = /^([A-Za-z_][\w.]*)\s*(\+\+|--)$/.exec(stmt);
    if (step) {
      const path = reference(step[1] as string, ctx, scope);
      if (path)
        updates.push({
          path,
          formula: `${formula(step[1] as string, ctx, scope)} ${step[2] === "++" ? "+" : "-"} 1`,
        });
      continue;
    }
    const assign = /^([A-Za-z_][\w.]*)\s*([+\-*/]?)=(?!=)\s*([\s\S]+)$/.exec(stmt);
    if (assign) {
      const path = reference(assign[1] as string, ctx, scope);
      if (!path) continue;
      const rhs = formula(assign[3] as string, ctx, scope);
      const lit = literal(assign[3] as string);
      if (!assign[2] && lit.ok) updates.push({ path, value: lit.value });
      else
        updates.push({
          path,
          formula: assign[2]
            ? `${formula(assign[1] as string, ctx, scope)} ${assign[2]} (${rhs})`
            : rhs,
        });
    }
  }
  if (!updates.length) return undefined;
  if (updates.length === 1) return { functionCall: { call: "setValue", args: updates[0] } };
  return { functionCall: { call: "setValues", args: { updates } } };
}

/** Text with {expr} parts → a string, a binding or a computed string. */
function interpolate(text: string, ctx: Ctx, scope: Scope): unknown {
  let source = text;
  if (!ctx.final) {
    // A half-typed "{…" at the end waits for its "}".
    const open = source.lastIndexOf("{");
    if (open >= 0 && closeBrace(source, open) < 0) source = source.slice(0, open);
  }
  const parts: string[] = [];
  const args: string[] = [];
  let only: string | null = null;
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf("{", i);
    if (open < 0) break;
    const close = closeBrace(source, open);
    if (close < 0) break;
    parts.push(source.slice(i, open));
    const expr = source.slice(open + 1, close).trim();
    if (expr) {
      parts.push(`{${args.length}}`);
      args.push(formula(expr, ctx, scope));
      only = expr;
    }
    i = close + 1;
  }
  parts.push(source.slice(i));
  if (!args.length) return source;
  const literalText = parts.join("");
  if (args.length === 1 && literalText === "{0}") {
    const ref = reference(only as string, ctx, scope);
    if (ref) return { path: ref };
    return { call: "computeString", args: { formula: `format('{0}', ${args[0]})` } };
  }
  const template = `'${literalText.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  return { call: "computeString", args: { formula: `format(${[template, ...args].join(", ")})` } };
}

// ── components ──────────────────────────────────────────────────────────────────────────────

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
function dedent(s: string): string {
  const lines = s.replace(/^\n+/, "").replace(/\s+$/, "").split("\n");
  const indent = Math.min(
    ...lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)?.[0].length ?? 0),
  );
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join("\n");
}
function resolveName(name: string): string | null {
  const lower = name.toLowerCase();
  return NAMES.get(lower) ?? ALIASES[lower] ?? null;
}
function hasContent(nodes: Node[]): boolean {
  return nodes.some((n) =>
    n.type === "text"
      ? !!n.text.trim()
      : n.type === "el"
        ? !n.open || hasContent(n.children)
        : n.type === "each"
          ? hasContent(n.children)
          : n.type === "if"
            ? hasContent(n.yes) || hasContent(n.else)
            : false,
  );
}

function newId(ctx: Ctx, el?: El): string {
  const own = el?.attrs.find((a) => a.name === "id" && a.kind !== "flag");
  if (
    own &&
    typeof own.value === "string" &&
    /^[A-Za-z][\w-]{0,60}$/.test(own.value) &&
    own.value !== "root"
  )
    return own.value;
  return `${ctx.prefix}${ctx.next++}`;
}

/** Element nodes (and text) in a child position, with {#if} folded into `visible`. */
function flatten(
  nodes: Node[],
  visible: string | null,
): { node: El | TextNode | Each; visible: string | null }[] {
  const out: { node: El | TextNode | Each; visible: string | null }[] = [];
  for (const n of nodes) {
    if (n.type === "if") {
      const yes = visible ? `(${visible}) && (${n.cond})` : `(${n.cond})`;
      const no = visible ? `(${visible}) && !(${n.cond})` : `!(${n.cond})`;
      out.push(...flatten(n.yes, yes), ...flatten(n.else, no));
    } else if (n.type === "el" || n.type === "each" || (n.type === "text" && n.text.trim()))
      out.push({ node: n, visible });
  }
  return out;
}

function singular(prop: string): string {
  return prop.endsWith("ies")
    ? `${prop.slice(0, -3)}y`
    : prop.endsWith("s")
      ? prop.slice(0, -1)
      : prop;
}

/** A child tag that fills an array-of-objects or child-id prop of `component`, if it is one. */
function slotFor(
  component: string,
  tag: string,
): { prop: string; kind: "objects" | "child" } | null {
  const shape = shapeOf(component);
  const lower = tag.toLowerCase();
  for (const [prop, schema] of Object.entries(shape)) {
    const s = unwrap(schema);
    const t = s?._def?.typeName;
    if (
      (prop.toLowerCase() === lower || singular(prop).toLowerCase() === lower) &&
      t === "ZodString" &&
      /ComponentId/.test(String(s.description ?? ""))
    )
      return { prop, kind: "child" };
    if (singular(prop).toLowerCase() !== lower) continue;
    const element =
      t === "ZodArray"
        ? unwrap(s._def.type)
        : t === "ZodUnion"
          ? unwrap(
              s._def.options.map(unwrap).find((o: any) => o?._def?.typeName === "ZodArray")?._def
                .type,
            )
          : null;
    if (
      element?._def?.typeName === "ZodObject" ||
      prop === "rows" ||
      prop === "values" ||
      prop === "data"
    )
      return { prop, kind: "objects" };
  }
  return null;
}

function objectShape(component: string, prop: string): Record<string, any> {
  const s = unwrap(shapeOf(component)[prop]);
  const arr =
    s?._def?.typeName === "ZodArray"
      ? s
      : s?._def?.typeName === "ZodUnion"
        ? s._def.options.map(unwrap).find((o: any) => o?._def?.typeName === "ZodArray")
        : null;
  return unwrap(arr?._def?.type)?.shape ?? {};
}

/** Children of `parent` compiled into ids; template children become {componentId, path}. */
function compileChildren(
  parentName: string,
  nodes: Node[],
  ctx: Ctx,
  scope: Scope,
  props: Record<string, unknown>,
): string[] | { componentId: string; path: string } {
  const ids: string[] = [];
  const items = flatten(nodes, null);
  const eachOnly = items.length === 1 && items[0]?.node.type === "each";
  for (const { node, visible } of items) {
    if (node.type === "text") {
      const value = interpolate(collapse(node.text), ctx, scope);
      if (value === "") continue;
      if (typeof value === "string") ctx.text.push(value);
      const id = newId(ctx);
      ctx.components.push({
        id,
        component: "Text",
        text: value,
        ...(visible ? { visible: cond(visible, ctx, scope) } : {}),
      });
      ids.push(id);
      continue;
    }
    if (node.type === "each") {
      const template = compileEach(node, ctx, scope);
      if (!template) continue;
      if (eachOnly) return template;
      const id = newId(ctx);
      ctx.components.push({ id, component: "Column", gap: "sm", children: template });
      ids.push(id);
      continue;
    }
    const slot = slotFor(parentName, node.name);
    if (slot && !resolveNameIsLayout(node.name, parentName)) {
      fillSlot(parentName, slot, node, ctx, scope, props);
      continue;
    }
    const slotAttr = node.attrs.find((a) => a.name === "slot" && a.kind === "str");
    const id = compileElement(node, ctx, scope, visible);
    if (!id) continue;
    if (slotAttr && typeof slotAttr.value === "string") props[slotAttr.value] = id;
    else ids.push(id);
  }
  return ids;
}

/** <Column> inside a Table is a column spec, but inside a Box it is a layout. */
function resolveNameIsLayout(tag: string, parent: string): boolean {
  const name = resolveName(tag);
  return !!name && "children" in shapeOf(name) && !slotFor(parent, tag);
}

function fillSlot(
  parent: string,
  slot: { prop: string; kind: "objects" | "child" },
  node: El,
  ctx: Ctx,
  scope: Scope,
  props: Record<string, unknown>,
) {
  if (slot.kind === "child") {
    const id = wrap(node.children, ctx, scope);
    if (id) props[slot.prop] = id;
    return;
  }
  const shape = objectShape(parent, slot.prop);
  const object: Record<string, unknown> = {};
  for (const attr of node.attrs) {
    if (attr.kind === "flag") object[attr.name] = true;
    else if (EVENT.test(attr.name)) {
      const a = action(String(attr.value), ctx, scope);
      if (a) object.action = a;
    } else if (attr.kind === "expr") {
      const lit = literal(attr.value as string);
      object[attr.name] = lit.ok
        ? lit.value
        : reference(attr.value as string, ctx, scope)
          ? { path: reference(attr.value as string, ctx, scope) }
          : attr.value;
    } else if (attr.kind === "bare" && /^-?\d+(\.\d+)?$/.test(attr.value as string))
      object[attr.name] = Number(attr.value);
    else object[attr.name] = attr.value;
  }
  const elements = node.children.filter((c) => c.type !== "text");
  const text = collapse(
    node.children
      .filter((c): c is TextNode => c.type === "text")
      .map((c) => c.text)
      .join(" "),
  );
  if ("child" in shape && hasContent(node.children)) {
    const id = wrap(node.children, ctx, scope);
    if (id) object.child = id;
  } else if (text) {
    const key =
      ["label", "text", "prompt", "title", "detail", "value"].find((k) => k in shape) ?? "label";
    if (!(key in object)) object[key] = text;
    ctx.text.push(text);
  }
  if (!elements.length && !Object.keys(object).length) return;
  if ("id" in shape && !("id" in object))
    object.id = `${slot.prop}${Array.isArray(props[slot.prop]) ? (props[slot.prop] as unknown[]).length + 1 : 1}`;
  const list = Array.isArray(props[slot.prop]) ? (props[slot.prop] as unknown[]) : [];
  list.push(object);
  props[slot.prop] = list;
}

/** Nodes as one component id (a Column when there are several). */
function wrap(nodes: Node[], ctx: Ctx, scope: Scope): string | null {
  const items = flatten(nodes, null);
  if (items.length === 1 && items[0]?.node.type === "el" && !items[0].visible)
    return compileElement(items[0].node, ctx, scope, null);
  if (!items.length) return null;
  const id = newId(ctx);
  const props: Record<string, unknown> = {};
  const children = compileChildren("Column", nodes, ctx, scope, props);
  ctx.components.push({ id, component: "Column", gap: "sm", ...props, children });
  return id;
}

function compileEach(
  node: Each,
  ctx: Ctx,
  scope: Scope,
): { componentId: string; path: string } | null {
  if (!hasContent(node.children) && !ctx.final) return null;
  const path = reference(node.list, ctx, scope);
  if (!path) {
    ctx.diagnostics.push(`each_needs_state:${node.list}`);
    return null;
  }
  const inner: Scope = { item: node.item, index: node.index, nested: true };
  const id = wrap(node.children, ctx, inner);
  return id ? { componentId: id, path } : null;
}

function cond(expr: string, ctx: Ctx, scope: Scope) {
  return { call: "computeBoolean", args: { formula: formula(expr, ctx, scope) } };
}

function compileElement(el: El, ctx: Ctx, scope: Scope, visible: string | null): string | null {
  if (el.open && !ctx.final && !hasContent(el.children)) return null;
  let name = resolveName(el.name);
  if (!name) {
    ctx.diagnostics.push(`unknown_component:${el.name}`);
    name = "Box";
  }
  const id = newId(ctx, el);
  const shape = shapeOf(name);
  const props: Record<string, unknown> = {};
  const lower = el.name.toLowerCase();
  if (lower === "caption") Object.assign(props, { size: "sm", tone: "muted" });
  if (lower === "bold") props.weight = "bold";
  for (const attr of el.attrs) {
    if (attr.name === "id" || attr.name === "slot") continue;
    if (EVENT.test(attr.name)) {
      if (attr.name === "onChange" && el.attrs.some((a) => a.name === "value" || a.name === "bind"))
        continue;
      const setter =
        attr.kind === "expr" ? /^set([A-Z]\w*)$/.exec(String(attr.value).trim()) : null;
      if (setter) {
        const state = [...ctx.states.keys()].find(
          (k) => k.toLowerCase() === (setter[1] as string).toLowerCase(),
        );
        if (state && !("value" in props)) props.value = { path: `/${state}` };
        continue;
      }
      const a = action(String(attr.value), ctx, scope);
      if (a) props.action = a;
      continue;
    }
    if (attr.name === "bind") {
      const ref = reference(String(attr.value), ctx, scope);
      if (ref) props.value = { path: ref };
      continue;
    }
    if (attr.name === "size" && name === "Heading" && typeof attr.value === "string") {
      props.level = ({ xl: 2, lg: 3, md: 4, sm: 5 } as Record<string, number>)[attr.value] ?? 3;
      continue;
    }
    props[attr.name] = attrValue(attr, name, attr.name, ctx, scope);
  }
  const textProp = TEXT_PROP[name];
  if (el.raw) {
    const body = dedent((el.children[0] as TextNode | undefined)?.text ?? "");
    if (textProp) props[textProp] = name === "Markdown" ? body : body;
    ctx.text.push(body);
  } else if (textProp && !("children" in shape)) {
    const texts = el.children.filter((c): c is TextNode => c.type === "text").map((c) => c.text);
    const joined = collapse(texts.join(" "));
    if (joined && !(textProp in props)) {
      const value = interpolate(joined, ctx, scope);
      props[textProp] = value;
      if (typeof value === "string") ctx.text.push(value);
    }
    // Pseudo children still fill slots (e.g. <Callout><Title>…</Title>…</Callout> is rare; slots matter for Flip/Tabs).
    for (const child of el.children)
      if (child.type === "el") {
        const slot = slotFor(name, child.name);
        if (slot) fillSlot(name, slot, child, ctx, scope, props);
      }
  } else if ("children" in shape) {
    const children = compileChildren(name, el.children, ctx, scope, props);
    if (!("children" in props)) props.children = children;
  } else {
    for (const child of el.children) {
      if (child.type === "el") {
        const slot = slotFor(name, child.name);
        if (slot) fillSlot(name, slot, child, ctx, scope, props);
        else if (child.attrs.some((a) => a.name === "slot")) {
          const slotName = child.attrs.find((a) => a.name === "slot")?.value;
          const cid = compileElement(child, ctx, scope, null);
          if (cid && typeof slotName === "string") props[slotName] = cid;
        }
      } else if (child.type === "text" && child.text.trim() && !textProp) {
        const key = ["label", "title", "caption", "text"].find((k) => k in shape);
        if (key && !(key in props)) props[key] = interpolate(collapse(child.text), ctx, scope);
      }
    }
  }
  if (visible) {
    const own = props.visible;
    props.visible =
      own && typeof own === "object" && "args" in (own as any)
        ? {
            call: "computeBoolean",
            args: {
              formula: `(${formula(visible, ctx, scope)}) && (${(own as any).args.formula})`,
            },
          }
        : cond(visible, ctx, scope);
  }
  ctx.components.push({ id, component: name, ...props });
  return id;
}

export type CompiledMarkup = {
  components: Component[];
  /** Initial state: path → value (apply once; the person's changes win afterwards). */
  data: Record<string, unknown>;
  /** The words in the UI, for copy, search and the text fallback. */
  text: string;
  diagnostics: string[];
};

/** Compiles a markup region (complete, or the part streamed so far). The root is "root". */
export function compileMarkup(
  source: string,
  options: { final?: boolean; prefix?: string } = {},
): CompiledMarkup {
  const parsed = parseMarkup(source, options.final ?? false);
  const ctx: Ctx = {
    states: new Map(),
    lets: new Map(),
    components: [],
    next: 1,
    prefix: options.prefix ?? "m",
    final: options.final ?? false,
    diagnostics: parsed.truncated && options.final ? ["unterminated_tag"] : [],
    text: [],
  };
  const collect = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.type === "state") {
        const lit = literal(n.expr);
        ctx.states.set(n.name, lit.ok ? lit.value : n.expr.replace(/^['"]|['"]$/g, ""));
      } else if (n.type === "let") ctx.lets.set(n.name, n.expr);
      else if (n.type === "el") collect(n.children);
      else if (n.type === "each") collect(n.children);
      else if (n.type === "if") collect([...n.yes, ...n.else]);
    }
  };
  collect(parsed.nodes);
  const root: Record<string, unknown> = {};
  const children = compileChildren("Column", parsed.nodes, ctx, { nested: false }, root);
  const data = Object.fromEntries([...ctx.states].map(([k, v]) => [`/${k}`, v]));
  return {
    components: [
      { id: "root", component: "Column", gap: "md", ...root, children },
      ...ctx.components,
    ],
    data,
    text: ctx.text.filter(Boolean).join("\n"),
    diagnostics: ctx.diagnostics,
  };
}

/** Whether a region is still inside an element or block (more lines belong to it). */
export function markupOpen(source: string): boolean {
  const parsed = parseMarkup(source);
  return parsed.open > 0 || parsed.truncated;
}
