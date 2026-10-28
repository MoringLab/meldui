import {
  ANSWER_WIRE_VERSION,
  type AnswerBlock,
  type AnswerEvent,
  type AnswerSnapshot,
  AnswerSnapshotSchema,
  CATALOG_ID,
  ControlLineSchema,
  type Diagnostic,
  defaultHostPolicy,
  type HostPolicy,
  type MediaDeclaration,
  parseComponent,
  redactContent,
  SNAPSHOT_SCHEMA,
  type SurfaceDeclaration,
  type UIMessage,
} from "@engine/protocol";
import { assertSafeJson, resolvePath } from "./expression.js";
import { createUIRuntime, type UIModelEvent, type UIRuntime } from "./index.js";
import { compileMarkup, isMarkupStart, markupOpen } from "./markup.js";

export type AnswerItem =
  | { kind: "text"; text: string }
  | { kind: "json"; value: Record<string, unknown> }
  | { kind: "invalid"; line: string }
  /** A markup region (tags + statements) so far; `final` once a non-markup line ends it. */
  | { kind: "markup"; region: number; source: string; final: boolean };

/** Whether a line that has only started could still turn out to open markup. */
const MAYBE_MARKUP = /^(<[A-Za-z]?[\w.-]*|\{[@#]?[a-z]*)$/;

/**
 * Splits a mixed stream into Markdown text and one-line JSON control objects.
 * A line is control only if it is a complete JSON object carrying `version` (A2UI) or `engine`.
 * Text streams immediately (partial lines included) unless the line starts with `{`; JSON lines
 * wait for their newline so a half-received envelope is never shown as text. Fenced code is text.
 */
export class AnswerDecoder {
  private buffer = "";
  private mode: "unknown" | "text" | "json" | "markup" = "unknown";
  private fence = false;
  private lineText = "";
  private utf8 = new TextDecoder("utf-8", { fatal: false });
  private region?: { id: number; source: string };
  private regions = 0;
  constructor(private maxLineBytes = 256 * 1024) {}
  /** The markup region still streaming, with its unfinished last line. */
  pendingMarkup(): { region: number; source: string } | null {
    return this.region && this.mode === "markup"
      ? { region: this.region.id, source: this.region.source + this.buffer }
      : null;
  }
  private endRegion(out: AnswerItem[]) {
    if (!this.region) return;
    out.push({ kind: "markup", region: this.region.id, source: this.region.source, final: true });
    this.region = undefined;
  }

  /** Control lines completed so far (identifies the line `pending()` belongs to). */
  lines = 0;
  push(chunk: string | Uint8Array): AnswerItem[] {
    this.buffer += typeof chunk === "string" ? chunk : this.utf8.decode(chunk, { stream: true });
    return this.drain(false);
  }
  /** The control line still streaming (its newline not here yet), or "". */
  pending(): string {
    return this.mode === "json" ? this.buffer : "";
  }
  finish(): AnswerItem[] {
    this.buffer += this.utf8.decode();
    return this.drain(true);
  }
  private emitText(out: AnswerItem[], text: string) {
    if (!text) return;
    const last = out.at(-1);
    if (last?.kind === "text") last.text += text;
    else out.push({ kind: "text", text });
  }
  private endLine(line: string) {
    if (/^\s{0,3}(```|~~~)/.test(line)) this.fence = !this.fence;
    this.lineText = "";
  }
  private drain(final: boolean): AnswerItem[] {
    const out: AnswerItem[] = [];
    while (this.buffer.length) {
      if (this.mode === "unknown" && this.region && !this.fence) {
        // In a markup region: an open element takes every line; at depth 0 the next line decides.
        if (markupOpen(this.region.source)) this.mode = "markup";
        else {
          const first = this.buffer.search(/\S/);
          const newline = this.buffer.indexOf("\n");
          if (first === -1 || (newline !== -1 && newline < first)) {
            if (newline === -1 && !final) break;
            const end = newline === -1 ? this.buffer.length : newline + 1;
            this.region.source += this.buffer.slice(0, end);
            this.buffer = this.buffer.slice(end);
            continue;
          }
          const rest = this.buffer.slice(first, newline === -1 ? undefined : newline);
          if (isMarkupStart(rest)) this.mode = "markup";
          else if (newline === -1 && !final && MAYBE_MARKUP.test(rest)) break;
          else this.endRegion(out);
        }
      }
      if (this.mode === "unknown" && !this.region && !this.fence) {
        const first = this.buffer.search(/\S/);
        if (first !== -1 && this.buffer[first] === "<") {
          const newline = this.buffer.indexOf("\n");
          const rest = this.buffer.slice(first, newline === -1 ? undefined : newline);
          if (newline === -1 || newline > first) {
            if (isMarkupStart(rest)) {
              this.region = { id: ++this.regions, source: "" };
              this.mode = "markup";
            } else if (newline === -1 && !final && MAYBE_MARKUP.test(rest)) break;
          }
        }
      }
      if (this.mode === "markup") {
        const newline = this.buffer.indexOf("\n");
        if (newline === -1 && !final) break; // the unfinished line is in pendingMarkup()
        const end = newline === -1 ? this.buffer.length : newline + 1;
        const region = this.region as { id: number; source: string };
        region.source += this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end);
        this.mode = "unknown";
        out.push({ kind: "markup", region: region.id, source: region.source, final: false });
        continue;
      }
      if (this.mode === "unknown") {
        const first = this.buffer.search(/\S/);
        const newline = this.buffer.indexOf("\n");
        if (first === -1 || (newline !== -1 && newline < first)) {
          // Whitespace only so far: hold it until the line type is known, so output never depends on chunking.
          if (newline === -1 && !final) break;
          const end = newline === -1 ? this.buffer.length : newline + 1;
          this.emitText(out, this.buffer.slice(0, end));
          this.buffer = this.buffer.slice(end);
          this.lineText = "";
          continue;
        }
        this.mode = this.buffer[first] === "{" && !this.fence ? "json" : "text";
      }
      const newline = this.buffer.indexOf("\n");
      if (this.mode === "text") {
        const end = newline === -1 ? this.buffer.length : newline + 1;
        const piece = this.buffer.slice(0, end);
        this.emitText(out, piece);
        this.lineText += piece.replace(/\n$/, "");
        this.buffer = this.buffer.slice(end);
        if (newline !== -1) {
          this.endLine(this.lineText);
          this.mode = "unknown";
        }
        continue;
      }
      // json mode: only whole lines
      if (newline === -1 && !final) {
        if (new TextEncoder().encode(this.buffer).length > this.maxLineBytes) {
          out.push({ kind: "invalid", line: this.buffer.slice(0, 80) });
          this.buffer = "";
          this.mode = "unknown";
        }
        break;
      }
      const end = newline === -1 ? this.buffer.length : newline;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + (newline === -1 ? 0 : 1));
      this.mode = "unknown";
      this.lineText = "";
      this.classify(line, newline !== -1, out);
    }
    if (final) this.endRegion(out);
    return out;
  }
  private classify(line: string, hadNewline: boolean, out: AnswerItem[]) {
    this.lines++;
    if (isMarkupStart(line)) {
      // {@state …} / {#each …}: a statement line opens a markup region.
      this.region = { id: ++this.regions, source: hadNewline ? `${line}\n` : line };
      out.push({
        kind: "markup",
        region: this.region.id,
        source: this.region.source,
        final: false,
      });
      return;
    }
    const raw = hadNewline ? `${line}\n` : line;
    try {
      const value = JSON.parse(line);
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        ("version" in value || "engine" in value)
      ) {
        out.push({ kind: "json", value });
        return;
      }
    } catch {
      if (/^\s*\{\s*"(version|engine)"/.test(line)) {
        const fixed = repairJsonSyntax(line);
        try {
          const value = JSON.parse(fixed);
          if (value && typeof value === "object" && ("version" in value || "engine" in value)) {
            out.push({ kind: "json", value });
            return;
          }
        } catch {
          /* not a key slip: try a cut line next */
        }
        const repaired = closeTruncated(fixed);
        if (repaired) {
          out.push({ kind: "json", value: repaired });
          return;
        }
        out.push({ kind: "invalid", line: line.slice(0, 120) });
        // One broken component must not lose the others in a long batch.
        const salvaged = salvageComponents(fixed);
        if (salvaged) {
          out.push({ kind: "json", value: salvaged });
          return;
        }
        // Rather than a silent gap, say what the block was going to show when that survives.
        const fallback = /"fallbackText"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(line)?.[1];
        if (fallback) {
          try {
            this.emitText(out, `${JSON.parse(`"${fallback}"`)}\n`);
          } catch {
            /* an unreadable fallback stays a diagnostic only */
          }
        }
        return;
      }
    }
    // Any other brace-led line is ordinary Markdown text.
    this.emitText(out, raw);
    this.endLine(line);
  }
}

/**
 * The components of an updateComponents line that cannot be parsed as a whole (a bracket
 * miscounted deep inside one of them): every `{"id":…,"component":…}` object that parses on its
 * own is kept; the broken one is dropped. Null when nothing can be recovered.
 */
export function salvageComponents(line: string): Record<string, unknown> | null {
  if (!line.includes('"updateComponents"')) return null;
  const surfaceId = /"surfaceId"\s*:\s*"([^"\\]{1,128})"/.exec(line)?.[1];
  const version = /"version"\s*:\s*"(v[0-9.]{1,8})"/.exec(line)?.[1] ?? "v0.9";
  const start = line.indexOf('"components"');
  if (!surfaceId || start < 0) return null;
  const components: Record<string, unknown>[] = [];
  const opener = /\{\s*"id"\s*:/g;
  opener.lastIndex = start;
  for (let match = opener.exec(line); match; match = opener.exec(line)) {
    const end = closingBrace(line, match.index);
    if (end < 0 && /\{\s*"id"\s*:/.test(line.slice(match.index + 1))) continue; // broken, others follow
    if (end < 0) {
      // The last component never closes (a brace dropped before the batch's closers): strip the
      // closers at the line's end and write the ones its open brackets need.
      const value = closeOpen(line.slice(match.index).replace(/[\]}\s]+$/, ""));
      if (value && typeof value.id === "string" && typeof value.component === "string")
        components.push(value);
      break;
    }
    try {
      const value = JSON.parse(repairJsonSyntax(line.slice(match.index, end + 1)));
      if (value && typeof value.id === "string" && typeof value.component === "string") {
        components.push(value);
        opener.lastIndex = end + 1;
      }
    } catch {
      /* this one is broken: look for the next component inside or after it */
    }
  }
  return components.length ? { version, updateComponents: { surfaceId, components } } : null;
}

/**
 * The components of an updateComponents line that is still streaming, each as soon as its own
 * object has closed (a later, still-open one is left for the next chunk).
 */
export function streamedComponents(
  line: string,
): { version: string; surfaceId: string; components: Record<string, unknown>[] } | null {
  if (!line.includes('"updateComponents"')) return null;
  const surfaceId = /"surfaceId"\s*:\s*"([^"\\]{1,128})"/.exec(line)?.[1];
  const version = /"version"\s*:\s*"(v[0-9.]{1,8})"/.exec(line)?.[1] ?? "v0.9";
  const start = line.indexOf('"components"');
  if (!surfaceId || start < 0) return null;
  const components: Record<string, unknown>[] = [];
  const opener = /\{\s*"id"\s*:/g;
  opener.lastIndex = start;
  for (let match = opener.exec(line); match; match = opener.exec(line)) {
    const end = closingBrace(line, match.index);
    if (end < 0) break; // still streaming
    try {
      const value = JSON.parse(repairJsonSyntax(line.slice(match.index, end + 1)));
      if (value && typeof value.id === "string" && typeof value.component === "string") {
        components.push(value);
        opener.lastIndex = end + 1;
      }
    } catch {
      /* a broken one: the whole line's salvage handles it when it ends */
    }
  }
  return { version, surfaceId, components };
}

/** How far a streaming sandbox source has got: styles, then the layout, then scripts. */
function sandboxProgress(line: string): "layout" | "style" | "script" {
  const at = line.indexOf('"source"');
  const source = at < 0 ? "" : line.slice(at);
  if (/<script/i.test(source)) return "script";
  if (/<style/i.test(source) && !/<\/style/i.test(source)) return "style";
  return "layout";
}

/** `text` with the closers its open brackets need, parsed; null if that does not parse. */
function closeOpen(text: string): Record<string, any> | null {
  const stack: string[] = [];
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if ((c === "}" || c === "]") && stack.pop() !== c) return null;
  }
  if (inString || !stack.length) return null;
  try {
    const value = JSON.parse(repairJsonSyntax(text + stack.reverse().join("")));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** Index of the brace closing the object that opens at `from` (outside strings), or -1. */
function closingBrace(text: string, from: number): number {
  const stack: string[] = [];
  let inString = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") {
      // A closer that does not match: the object never closed (it ran into the batch's closers).
      if (stack.pop() !== c) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

/**
 * The JSON slips models make deep inside long lines: a key missing its opening quote
 * (`{"op":"add",args":[…]` ), an unquoted key (`{op:"add"}`), a trailing comma. Only text outside
 * strings changes, so a value is never rewritten.
 */
export function repairJsonSyntax(line: string): string {
  let out = "";
  let inString = false;
  let expectKey = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (inString) {
      out += c;
      if (c === "\\") {
        out += line[i + 1] ?? "";
        i++;
      } else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      expectKey = false;
      out += c;
      continue;
    }
    if (c === "{" || c === ",") {
      // A comma right before } or ] is dropped.
      if (c === ",") {
        const rest = line.slice(i + 1).trimStart();
        if (rest.startsWith("}") || rest.startsWith("]")) continue;
      }
      expectKey = c === "{" || /[{,]\s*$/.test(out) || isObjectContext(out);
      out += c;
      continue;
    }
    if (expectKey && /[A-Za-z_$]/.test(c)) {
      const ident = /^[A-Za-z_$][\w$-]*/.exec(line.slice(i))?.[0] ?? c;
      const after = line.slice(i + ident.length);
      const stray = /^"\s*:/.test(after);
      if (stray || /^\s*:/.test(after)) {
        out += `"${ident}"`;
        i += ident.length - 1 + (stray ? 1 : 0);
        expectKey = false;
        continue;
      }
    }
    if (!/\s/.test(c)) expectKey = false;
    out += c;
  }
  return out;
}

/** Whether the innermost open bracket of `prefix` (outside strings) is an object. */
function isObjectContext(prefix: string): boolean {
  const stack: string[] = [];
  let inString = false;
  for (let i = 0; i < prefix.length; i++) {
    const c = prefix[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }
  return stack.at(-1) === "{";
}

/**
 * A control line cut short after its last complete value (a model that stops before the closing
 * braces): close the open objects and arrays it left, outside strings. Only a line whose strings
 * are all closed is repaired, so a cut inside a value never becomes a different value.
 */
export function closeTruncated(line: string): Record<string, unknown> | null {
  const stack: string[] = [];
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") {
      if (stack.pop() !== c) return null;
    }
  }
  if (inString || !stack.length || stack.length > 4) return null;
  // Only after a complete value: a line ending in { [ , or : was cut before its content.
  if (!/["\d\]}el]\s*$/.test(line)) return null;
  try {
    const value = JSON.parse(line.trimEnd() + stack.reverse().join(""));
    return value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      ("version" in value || "engine" in value)
      ? value
      : null;
  } catch {
    return null;
  }
}

/** Plain-text equivalent of a surface, used when the model's own fallbackText is absent. */
export function describeSurface(runtime: UIRuntime, surfaceId: string, limit = 600): string {
  const surface = runtime.getSurface(surfaceId);
  if (!surface) return "";
  const lines: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || lines.join("\n").length > limit) return;
    seen.add(id);
    const node = runtime.getNodeSnapshot(surfaceId, id);
    const p = node.props ?? {};
    const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
    switch (node.component) {
      case "Heading":
      case "Text":
      case "Badge":
        if (text(p.text)) lines.push(text(p.text));
        break;
      case "Callout":
        lines.push(`${text(p.title)}: ${text(p.text)}`.trim());
        break;
      case "Chart":
        lines.push(`Chart: ${text(p.title)}`);
        break;
      case "Table":
        lines.push(`Table: ${text(p.caption)}`);
        break;
      case "Button":
        lines.push(`[${text(p.label)}]`);
        break;
      case "TextField":
        lines.push(`${text(p.label)}: ${p.secure ? "•••" : text(p.value)}`.trim());
        break;
      case "Slider":
      case "Select":
      case "Checkbox":
      case "DatePicker":
        lines.push(`${text(p.label)}: ${text(p.value)}`.trim());
        break;
      case "Progress":
        lines.push(`${text(p.label)}: ${text(p.value)}`);
        break;
      default:
        if (text(p.title)) lines.push(text(p.title));
    }
    const children = p.children;
    if (Array.isArray(children))
      for (const child of children) visit(typeof child === "string" ? child : child?.id);
    for (const tab of Array.isArray(p.tabs) ? p.tabs : Array.isArray(p.items) ? p.items : [])
      visit(tab.child);
  };
  visit("root");
  const out = lines.filter(Boolean).join("\n");
  return out.length > limit
    ? `${out.slice(0, limit - 1)}…`
    : out || `Interactive content (${surfaceId})`;
}

/**
 * A surface as the model can read it back next turn: the component tree with the words and the
 * current values on screen, then the data model. Without it a follow-up ("make the second slider
 * finer", "what did I score?") has only the one-line fallback to go on.
 */
export function outlineSurface(runtime: UIRuntime, surfaceId: string, limit = 1600): string {
  const surface = runtime.getSurface(surfaceId);
  if (!surface) return "";
  const lines: string[] = [];
  const seen = new Set<string>();
  const short = (v: unknown, max = 60) => {
    const s =
      typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  };
  const KEYS = [
    "title",
    "label",
    "text",
    "prompt",
    "caption",
    "kind",
    "variant",
    "value",
    "min",
    "max",
  ];
  const visit = (id: string, depth: number, scope = "/") => {
    if (seen.has(`${id}\0${scope}`) || lines.length > 60) return;
    seen.add(`${id}\0${scope}`);
    const node = runtime.getNodeSnapshot(surfaceId, id, scope);
    const p = (node.props ?? {}) as Record<string, any>;
    const fields = KEYS.filter((k) => short(p[k]) !== "").map(
      (k) => `${k}=${JSON.stringify(short(p[k]))}`,
    );
    if (Array.isArray(p.tabs))
      fields.push(
        `tabs=${p.tabs.map((t: any) => short(runtime.resolve(surfaceId, t.label, scope), 20)).join("|")}`,
      );
    if (Array.isArray(p.values)) fields.push(`rows=${p.values.length}`);
    if (Array.isArray(p.choices)) fields.push(`choices=${p.choices.length}`);
    lines.push(
      `${"  ".repeat(depth)}${node.component ?? "?"}#${id}${fields.length ? ` ${fields.join(" ")}` : ""}`,
    );
    const children = p.children;
    if (Array.isArray(children))
      for (const child of children) visit(String(child), depth + 1, scope);
    else if (children && typeof children === "object" && typeof children.componentId === "string") {
      const rows = runtime.read(surfaceId, children.path, scope);
      lines.push(
        `${"  ".repeat(depth + 1)}(each of ${children.path}, ${Array.isArray(rows) ? rows.length : 0} rows:)`,
      );
      visit(children.componentId, depth + 2, `${resolvePath(children.path, scope)}/0`);
    }
    for (const entry of Array.isArray(p.tabs) ? p.tabs : Array.isArray(p.items) ? p.items : [])
      if (entry && typeof entry.child === "string") visit(entry.child, depth + 1, scope);
    for (const key of ["front", "back"])
      if (typeof p[key] === "string") visit(p[key], depth + 1, scope);
  };
  visit("root", 0);
  let data = "";
  try {
    data = JSON.stringify(runtime.read(surfaceId, "/")) ?? "";
  } catch {
    data = "";
  }
  const tree = lines.join("\n");
  const room = Math.max(200, limit - tree.length);
  return `${tree}\ndata: ${data.length > room ? `${data.slice(0, room - 1)}…` : data}`;
}

/** Visible words of a sandbox document (no tags, scripts or styles), for the model's context. */
function sandboxWords(source: string | undefined, limit = 400): string {
  if (!source) return "";
  const text = source
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export type AnswerState = {
  blocks: readonly AnswerBlock[];
  revision: number;
  ended: boolean;
};
export type AnswerSessionOptions = {
  policy?: Partial<HostPolicy>;
  sdkVersion?: string;
  transformMessage?: (message: unknown) => unknown;
  /** Called for every emitted wire event (transport, logging). */
  onEvent?: (event: AnswerEvent) => void;
  /** When set, media blocks may only reference registered ids; unknown ids are reported for repair. */
  attachments?: { unknownIds(ids: string[]): string[] };
};

/**
 * Ordered hybrid answer: Markdown, surface and media blocks around one UIRuntime.
 * Single-channel hosts call push(); hosts with separate text and UI channels use the
 * pushMarkdown/declareSurface/pushMessage/declareMedia methods (the "composer" surface).
 */
export class AnswerSession {
  private _blocks: AnswerBlock[] = [];
  private revision = 0;
  private seq = 0;
  private ended = false;
  private listeners = new Set<() => void>();
  private decoder = new AnswerDecoder();
  private openMarkdown?: number;
  private surfaceBlock = new Map<string, string>();
  private pendingDecl = new Map<string, SurfaceDeclaration>();
  private surfaceLog = new Map<string, { catalogId: string; messages: unknown[] }>();
  private nextBlock = 1;
  private warned = new Set<string>();
  /** The streaming control line: which one, and how many of its components are applied. */
  private draft?: { line: number; applied: number };
  /** The placeholder block of a sandbox whose declaration is still streaming. */
  private draftSandbox?: string;
  /** The markup region being built: its surface, the state already set, components sent. */
  private markup?: {
    region: number;
    surfaceId: string;
    data: Set<string>;
    sent: Map<string, string>;
  };
  private markupCount = 0;
  readonly policy: HostPolicy;
  private snapshotCache?: AnswerState;
  constructor(
    readonly runtime: UIRuntime,
    private options: AnswerSessionOptions = {},
  ) {
    this.policy = defaultHostPolicy(options.policy);
  }

  // ── subscription (useSyncExternalStore-compatible) ───────────────────────────────────────
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = (): AnswerState => {
    if (this.snapshotCache?.revision !== this.revision)
      this.snapshotCache = { blocks: this._blocks, revision: this.revision, ended: this.ended };
    return this.snapshotCache;
  };
  get blocks() {
    return this._blocks;
  }
  private touch() {
    this.revision++;
    this._blocks = [...this._blocks];
    for (const fn of this.listeners) fn();
  }
  private emit(event: DistributiveOmit<AnswerEvent, "seq">): AnswerEvent {
    const full = { ...event, seq: ++this.seq } as AnswerEvent;
    this.options.onEvent?.(full);
    return full;
  }
  private report(d: Diagnostic) {
    this.runtime.report(d);
  }
  private warnOnce(code: string, message: string, severity: Diagnostic["severity"] = "warning") {
    if (this.warned.has(code)) return;
    this.warned.add(code);
    this.report({ code, message, severity });
  }
  private newId() {
    return `b${this.nextBlock++}`;
  }

  // ── single-channel input ─────────────────────────────────────────────────────────────────
  push(chunk: string | Uint8Array): AnswerEvent[] {
    const events = this.apply(this.decoder.push(chunk));
    events.push(...this.preview());
    return events;
  }
  /**
   * Builds the UI as it streams: components of an updateComponents line are applied as each one
   * closes (they are upserts, so the whole line, when it ends, confirms them); a sandbox shows a
   * "building" placeholder that tracks how far its source has got.
   */
  private preview(): AnswerEvent[] {
    const markup = this.decoder.pendingMarkup();
    if (markup && !this.ended) return this.applyMarkup(markup.region, markup.source, false);
    const line = this.decoder.pending();
    if (!line || this.ended) return [];
    if (this.draft?.line !== this.decoder.lines)
      this.draft = { line: this.decoder.lines, applied: 0 };
    const draft = this.draft;
    const streamed = streamedComponents(line);
    if (streamed) {
      // Only into a surface that exists and was not refused by policy.
      if (!this.surfaceBlock.get(streamed.surfaceId) || streamed.components.length <= draft.applied)
        return [];
      const fresh = streamed.components.slice(draft.applied);
      draft.applied = streamed.components.length;
      return this.control({
        version: streamed.version,
        updateComponents: { surfaceId: streamed.surfaceId, components: fresh },
      });
    }
    const head = line.slice(0, 400);
    if (
      !this.policy.allowSandbox ||
      !/^\s*\{\s*"engine"/.test(head) ||
      !/"block"\s*:\s*"sandbox"/.test(head)
    )
      return [];
    const progress = sandboxProgress(line);
    const title = /"title"\s*:\s*"([^"\\]{1,80})"/.exec(head)?.[1];
    const events = this.closeMarkdown();
    const index = this.draftSandbox
      ? this._blocks.findIndex((b) => b.id === this.draftSandbox)
      : -1;
    if (index >= 0) {
      const current = this._blocks[index] as Extract<AnswerBlock, { kind: "sandbox" }>;
      if (current.progress === progress && current.title === title) return events;
      this._blocks[index] = { ...current, progress, title };
      this.touch();
      return events;
    }
    const block: AnswerBlock = {
      id: this.newId(),
      kind: "sandbox",
      mode: "html",
      fallbackText: "",
      status: "building",
      progress,
      title,
    };
    this.draftSandbox = block.id;
    this._blocks.push(block);
    this.touch();
    events.push(this.emit({ type: "block", block }));
    return events;
  }
  /** Start another assistant turn on the same answer: open text is closed, surfaces persist. */
  beginTurn() {
    this.closeMarkdown();
    this.markup = undefined;
    this.decoder = new AnswerDecoder();
    this.ended = false;
  }
  private apply(items: AnswerItem[]): AnswerEvent[] {
    const events: AnswerEvent[] = [];
    for (const item of items) {
      if (item.kind === "text") events.push(...this.pushMarkdown(item.text));
      else if (item.kind === "invalid")
        this.report({
          code: "INVALID_JSON",
          message: "Expected one complete JSON object per line.",
          severity: "error",
        });
      else if (item.kind === "markup")
        events.push(...this.applyMarkup(item.region, item.source, item.final));
      else events.push(...this.control(item.value));
    }
    return events;
  }
  /**
   * A markup region becomes one surface. Each time it grows it is compiled again; only the
   * components that changed are sent (upserts), and state is set once, so what the person has
   * already changed in the UI is kept.
   */
  private applyMarkup(region: number, source: string, final: boolean): AnswerEvent[] {
    if (this.policy.mode === "markdown-only") {
      this.warnOnce(
        "POLICY_SURFACES_DISABLED",
        "This host accepts Markdown only; interactive content was dropped.",
      );
      return [];
    }
    let compiled: ReturnType<typeof compileMarkup>;
    try {
      compiled = compileMarkup(source, { final });
    } catch (error) {
      this.report({
        code: "MARKUP_INVALID",
        message: String(error).slice(0, 200),
        severity: "warning",
      });
      return [];
    }
    const events: AnswerEvent[] = [];
    let m = this.markup;
    if (!m || m.region !== region) {
      if (compiled.components.length < 2) return events; // nothing to draw yet
      const surfaceId = `ui${++this.markupCount}`;
      m = { region, surfaceId, data: new Set(), sent: new Map() };
      this.markup = m;
      this.pendingDecl.set(surfaceId, {
        engine: ANSWER_WIRE_VERSION,
        block: "surface",
        surfaceId,
        fallbackText: compiled.text.slice(0, 4000) || "UI",
      } as SurfaceDeclaration);
      events.push(
        ...this.a2ui({
          version: "v0.9",
          createSurface: { surfaceId, catalogId: this.runtime.options.catalogId ?? CATALOG_ID },
        }),
      );
    }
    for (const [path, value] of Object.entries(compiled.data)) {
      if (m.data.has(path)) continue;
      m.data.add(path);
      events.push(
        ...this.a2ui({ version: "v0.9", updateDataModel: { surfaceId: m.surfaceId, path, value } }),
      );
    }
    const changed = compiled.components.filter((c) => {
      const json = JSON.stringify(c);
      if (m.sent.get(c.id) === json) return false;
      m.sent.set(c.id, json);
      return true;
    });
    if (changed.length)
      events.push(
        ...this.a2ui({
          version: "v0.9",
          updateComponents: { surfaceId: m.surfaceId, components: changed },
        }),
      );
    if (final) {
      const index = this._blocks.findIndex(
        (b) => b.kind === "surface" && b.surfaceId === m.surfaceId,
      );
      const block = this._blocks[index];
      if (block?.kind === "surface" && compiled.text) {
        this._blocks[index] = { ...block, fallbackText: compiled.text.slice(0, 4000) };
        this.touch();
      }
      for (const d of compiled.diagnostics)
        this.report({ code: "MARKUP", message: d, severity: "warning" });
    }
    return events;
  }

  // ── composer surface (separate channels) ─────────────────────────────────────────────────
  pushMarkdown(text: string): AnswerEvent[] {
    if (this.policy.mode === "engine-only") {
      if (text.trim())
        this.warnOnce(
          "POLICY_MARKDOWN_DISABLED",
          "This host accepts interactive content only; Markdown was dropped.",
        );
      return [];
    }
    const events: AnswerEvent[] = [];
    let index = this.openMarkdown;
    if (index === undefined) {
      if (!text.trim()) return events;
      const block: AnswerBlock = {
        id: this.newId(),
        kind: "markdown",
        text: "",
        status: "streaming",
      };
      this._blocks.push(block);
      index = this._blocks.length - 1;
      this.openMarkdown = index;
      text = text.replace(/^\s+/, "");
      events.push(this.emit({ type: "block", block }));
    }
    const current = this._blocks[index] as Extract<AnswerBlock, { kind: "markdown" }>;
    this._blocks[index] = { ...current, text: current.text + text };
    this.touch();
    events.push(this.emit({ type: "markdown", blockId: current.id, text }));
    return events;
  }
  private closeMarkdown(): AnswerEvent[] {
    if (this.openMarkdown === undefined) return [];
    const current = this._blocks[this.openMarkdown] as Extract<AnswerBlock, { kind: "markdown" }>;
    this._blocks[this.openMarkdown] = {
      ...current,
      text: current.text.trimEnd(),
      status: "complete",
    };
    this.openMarkdown = undefined;
    this.touch();
    return [this.emit({ type: "block-end", blockId: current.id })];
  }
  declareSurface(input: unknown): AnswerEvent[] {
    const parsed = ControlLineSchema.safeParse({
      engine: ANSWER_WIRE_VERSION,
      block: "surface",
      ...(input as object),
    });
    if (!parsed.success || parsed.data.block !== "surface") {
      this.report({
        code: "INVALID_ENVELOPE",
        message: "A surface declaration needs surfaceId and fallbackText.",
        expected: "{engine:'v1',block:'surface',surfaceId,fallbackText}",
        severity: "error",
      });
      return [];
    }
    return this.control(parsed.data as unknown as Record<string, unknown>);
  }
  declareMedia(input: Partial<MediaDeclaration>): AnswerEvent[] {
    return this.control({ engine: ANSWER_WIRE_VERSION, block: "media", ...input });
  }
  async consume(
    stream: AsyncIterable<string | Uint8Array | UIModelEvent>,
    options: { signal?: AbortSignal } = {},
  ) {
    let bytes = 0;
    for await (const item of stream) {
      if (options.signal?.aborted) return;
      bytes +=
        item instanceof Uint8Array
          ? item.byteLength
          : new TextEncoder().encode(typeof item === "string" ? item : JSON.stringify(item)).length;
      if (bytes > this.runtime.limits.streamBytes) {
        this.runtime.report({
          code: "STREAM_LIMIT",
          message: "Answer stream exceeds the host limit.",
          severity: "error",
        });
        this.end();
        return;
      }
      if (typeof item === "string" || item instanceof Uint8Array) this.push(item);
      else if (item.type === "text") this.push(item.text);
      else if (item.type === "message") this.pushMessage(item.message);
      else if (item.type === "diagnostic") this.runtime.report(item.diagnostic);
      else if (item.type === "complete") {
        if (item.status === "completed") this.end();
        return;
      }
    }
    if (!options.signal?.aborted) this.end();
  }
  setMessageTransform(transform: AnswerSessionOptions["transformMessage"]) {
    this.options.transformMessage = transform;
  }
  finishMarkdown(): AnswerEvent[] {
    return this.closeMarkdown();
  }
  pushMessage(message: unknown): AnswerEvent[] {
    return this.control(message as Record<string, unknown>);
  }

  private control(value: Record<string, unknown>): AnswerEvent[] {
    if ("engine" in value) return this.declaration(value);
    return this.a2ui((this.options.transformMessage?.(value) ?? value) as Record<string, unknown>);
  }
  private declaration(value: Record<string, unknown>): AnswerEvent[] {
    const events = this.closeMarkdown();
    const parsed = ControlLineSchema.safeParse(value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      this.report({
        code: "INVALID_ENVELOPE",
        message: `Invalid block declaration at ${issue.path.join(".") || "line"}.`,
        expected: issue.message,
        path: issue.path.join("/"),
        severity: "error",
      });
      return events;
    }
    const decl = parsed.data;
    if (decl.block === "surface") {
      if (this.policy.mode === "markdown-only") {
        this.warnOnce(
          "POLICY_SURFACES_DISABLED",
          "This host accepts Markdown only; interactive content was dropped.",
        );
        this.pendingDecl.set(decl.surfaceId, decl); // so the matching A2UI lines are dropped, not mis-reported
        this.surfaceBlock.set(decl.surfaceId, "");
        return events;
      }
      if (this.surfaceBlock.size >= this.policy.maxSurfaces) {
        this.warnOnce(
          "POLICY_MAX_SURFACES",
          `At most ${this.policy.maxSurfaces} interactive surfaces are allowed in one answer.`,
          "error",
        );
        this.surfaceBlock.set(decl.surfaceId, "");
        return events;
      }
      this.pendingDecl.set(decl.surfaceId, decl);
      return events;
    }
    if (decl.block === "media") {
      if (!this.policy.allowMedia) {
        this.warnOnce("POLICY_MEDIA_DISABLED", "This host does not allow media blocks.");
        return events;
      }
      const unknown = (this.options.attachments ?? this.runtime.attachments).unknownIds(
        decl.attachments,
      );
      for (const id of unknown)
        this.report({
          code: "UNKNOWN_ATTACHMENT",
          message: `Attachment ${id} is not registered by the host.`,
          expected: "an id from the host attachment list",
          path: id,
          severity: "error",
        });
      const block: AnswerBlock = {
        id: this.newId(),
        kind: "media",
        attachmentIds: decl.attachments,
        layout: decl.layout,
        caption: decl.caption,
        markdown: this.policy.mode === "engine-only" ? undefined : decl.markdown,
        placement: decl.placement,
        mediaFraction: decl.mediaFraction,
        alt: decl.alt,
        status: "complete",
      };
      this._blocks.push(block);
      this.touch();
      events.push(this.emit({ type: "block", block }));
      return events;
    }
    if (!this.policy.allowSandbox)
      this.warnOnce(
        "POLICY_SANDBOX_DISABLED",
        "Sandboxed content is not enabled for this host.",
        "error",
      );
    const block: AnswerBlock = {
      id: this.newId(),
      kind: "sandbox",
      mode: decl.mode,
      phase: decl.phase,
      libraries: decl.libraries,
      state: decl.state,
      source: this.policy.allowSandbox ? decl.source : undefined,
      fallbackText: decl.fallbackText,
      status: this.policy.allowSandbox ? "complete" : "blocked",
    };
    // The placeholder shown while this declaration streamed becomes the block, in its place.
    const draft = this.draftSandbox
      ? this._blocks.findIndex((b) => b.id === this.draftSandbox)
      : -1;
    this.draftSandbox = undefined;
    if (draft >= 0 && !decl.artifactId) {
      this._blocks[draft] = { ...block, id: this._blocks[draft].id };
      this.touch();
      events.push(this.emit({ type: "block", block: this._blocks[draft] }));
      return events;
    }
    if (draft >= 0) this._blocks.splice(draft, 1);
    if (decl.artifactId) {
      block.id = decl.artifactId;
      const index = this._blocks.findIndex((b) => b.id === block.id);
      if (index >= 0) {
        if (this._blocks[index].kind !== "sandbox") throw Error("ARTIFACT_KIND");
        this._blocks[index] = block;
      } else this._blocks.push(block);
    } else this._blocks.push(block);
    this.touch();
    events.push(this.emit({ type: "block", block }));
    return events;
  }
  private a2ui(value: Record<string, unknown>): AnswerEvent[] {
    const events: AnswerEvent[] = [];
    const message = value as unknown as UIMessage & Record<string, any>;
    const body = (message.createSurface ??
      message.updateComponents ??
      message.updateDataModel ??
      message.deleteSurface) as { surfaceId?: string } | undefined;
    const surfaceId = body?.surfaceId;
    if (surfaceId && this.surfaceBlock.get(surfaceId) === "") return events; // refused by policy
    if (message.createSurface && surfaceId) {
      if (this.policy.mode === "markdown-only") {
        this.warnOnce(
          "POLICY_SURFACES_DISABLED",
          "This host accepts Markdown only; interactive content was dropped.",
        );
        this.surfaceBlock.set(surfaceId, "");
        return events;
      }
      if (!this.surfaceBlock.has(surfaceId)) {
        if (this.surfaceBlock.size >= this.policy.maxSurfaces) {
          this.warnOnce(
            "POLICY_MAX_SURFACES",
            `At most ${this.policy.maxSurfaces} interactive surfaces are allowed in one answer.`,
            "error",
          );
          this.surfaceBlock.set(surfaceId, "");
          return events;
        }
        events.push(...this.closeMarkdown());
        const decl = this.pendingDecl.get(surfaceId);
        this.pendingDecl.delete(surfaceId);
        if (!decl)
          this.warnOnce(
            "FALLBACK_TEXT_MISSING",
            "Surfaces should be declared with fallbackText; a generated description is used.",
          );
        const block: AnswerBlock = {
          id: this.newId(),
          kind: "surface",
          surfaceId,
          fallbackText: decl?.fallbackText ?? "",
          fallbackSource: decl ? "model" : "generated",
          title: decl?.title,
          status: "streaming",
        };
        this._blocks.push(block);
        this.surfaceBlock.set(surfaceId, block.id);
        this.surfaceLog.set(surfaceId, {
          catalogId: String(message.createSurface.catalogId),
          messages: [],
        });
        this.touch();
        events.push(this.emit({ type: "block", block }));
      }
    }
    const blockId = surfaceId ? (this.surfaceBlock.get(surfaceId) ?? "") : "";
    const filtered = this.filterComponents(message);
    // Upstream keeps references into message values (a data model can alias them), so the
    // runtime gets its own copy and the history log keeps pristine data.
    const diagnostics = this.runtime.accept(structuredClone(filtered));
    const accepted = !diagnostics.some((d) => d.severity === "error");
    if (surfaceId && accepted)
      this.surfaceLog.get(surfaceId)?.messages.push(structuredClone(filtered));
    if (message.deleteSurface && surfaceId) {
      const id = this.surfaceBlock.get(surfaceId);
      this._blocks = this._blocks.filter((b) => b.id !== id);
      this.surfaceBlock.delete(surfaceId);
      this.surfaceLog.delete(surfaceId);
    } else this.touch();
    events.push(this.emit({ type: "message", blockId, message: filtered }));
    return events;
  }
  private filterComponents(message: any) {
    const allowed = this.policy.allowedComponents;
    if (!message.updateComponents) return message;
    const kept = message.updateComponents.components.filter(
      (c: { id: string; component: string }) => {
        const media = [
          "Image",
          "Gallery",
          "Carousel",
          "MediaGrid",
          "ImageCompare",
          "ImageAnnotations",
          "Video",
          "Audio",
          "FileCard",
          "DocumentPreview",
        ];
        if (
          (!allowed || allowed.includes(c.component)) &&
          (this.policy.allowMedia || !media.includes(c.component))
        )
          return true;
        this.report({
          code: "COMPONENT_NOT_ALLOWED",
          message: `Component ${c.component} is not allowed by the host policy.`,
          componentId: c.id,
          surfaceId: message.updateComponents.surfaceId,
          expected: allowed ? `one of ${JSON.stringify(allowed)}` : "a non-media component",
          severity: "error",
        });
        return false;
      },
    );
    return kept.length
      ? { ...message, updateComponents: { ...message.updateComponents, components: kept } }
      : { ...message, updateComponents: { ...message.updateComponents, components: [] } };
  }

  /** Close the stream: flush the decoder, resolve graph errors, fill generated fallbacks. */
  end(): AnswerEvent[] {
    if (this.ended) return [];
    const events = this.apply(this.decoder.finish());
    events.push(...this.closeMarkdown());
    this.runtime.finish();
    if (this.policy.mode === "engine-only" && !this._blocks.length)
      this.report({
        code: "MISSING_ANSWER",
        message: "The host requested an interactive answer but received no supported block.",
        expected: "At least one valid surface, media or allowed sandbox block",
        severity: "error",
      });
    let changed = false;
    // A sandbox whose declaration never completed has nothing to show.
    if (this.draftSandbox) {
      const id = this.draftSandbox;
      this.draftSandbox = undefined;
      this._blocks = this._blocks.filter(
        (b) => b.id !== id || b.kind !== "sandbox" || b.status !== "building",
      );
      changed = true;
    }
    this._blocks = this._blocks.map((block) => {
      if (block.kind !== "surface") return block;
      const failed = !this.runtime.getSurface(block.surfaceId)?.componentsModel.has("root");
      const fallbackText = block.fallbackText || describeSurface(this.runtime, block.surfaceId);
      changed = true;
      return { ...block, fallbackText, status: failed ? "error" : "complete" } as AnswerBlock;
    });
    this.ended = true;
    if (changed) this.touch();
    else {
      this.revision++;
      for (const fn of this.listeners) fn();
    }
    events.push(this.emit({ type: "end" }));
    return events;
  }

  // ── client chrome actions ────────────────────────────────────────────────────────────────
  /** Plain text of the whole answer (Markdown as written, surfaces as their fallback text). */
  asText(): string {
    return this._blocks
      .map((b) =>
        b.kind === "markdown"
          ? b.text
          : b.kind === "surface" || b.kind === "sandbox"
            ? b.fallbackText || describeSurface(this.runtime, (b as any).surfaceId ?? "")
            : b.kind === "media"
              ? `[media: ${b.attachmentIds.join(", ")}]`
              : "",
      )
      .filter(Boolean)
      .join("\n\n");
  }
  /**
   * The answer as context for the next turn: Markdown as written, each surface as an outline of
   * what it shows and holds now (<ui>…</ui>), each sandbox as its summary and visible words.
   */
  asContext(): string {
    return this._blocks
      .map((b) => {
        if (b.kind === "markdown") return b.text;
        if (b.kind === "surface")
          return `<ui surface="${b.surfaceId}"${b.title ? ` title="${b.title}"` : ""}>\n${b.fallbackText ? `summary: ${b.fallbackText}\n` : ""}${outlineSurface(this.runtime, b.surfaceId)}\n</ui>`;
        if (b.kind === "sandbox")
          return `<ui sandbox="${b.mode}">\nsummary: ${b.fallbackText}\nshows: ${sandboxWords(b.source)}\n</ui>`;
        if (b.kind === "media") return `[media: ${b.attachmentIds.join(", ")}]`;
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  /** Restore a surface to the data it had when its last model update finished. */
  reset(surfaceId: string) {
    const log = this.surfaceLog.get(surfaceId);
    if (!log) throw new Error("UNKNOWN_SURFACE");
    this.runtime.accept({ version: "v0.9", deleteSurface: { surfaceId } });
    for (const message of log.messages) this.runtime.accept(structuredClone(message));
    this.runtime.finish();
    this.touch();
  }

  saveArtifactState(id: string, state: Record<string, unknown>) {
    assertSafeJson(state);
    if (JSON.stringify(state).length > 65536) throw Error("ARTIFACT_STATE_LIMIT");
    const index = this._blocks.findIndex((b) => b.id === id);
    if (index < 0 || this._blocks[index].kind !== "sandbox") throw Error("ARTIFACT_KIND");
    this._blocks[index] = { ...this._blocks[index], state: structuredClone(state) } as AnswerBlock;
    this.touch();
  }
  /** Compare-and-set a focused artifact; validation completes before the visible state changes. */
  updateArtifact(
    id: string,
    expectedRevision: number,
    update: { text?: string; source?: string; messages?: unknown[] },
  ) {
    assertSafeJson(update);
    const index = this._blocks.findIndex((b) => b.id === id);
    const block = this._blocks[index];
    if (
      !block ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision !== ((block as any).revision ?? 0)
    )
      throw Error("ARTIFACT_REVISION");
    if (
      block.kind === "markdown" &&
      typeof update.text === "string" &&
      update.text.length <= 65536
    ) {
      this._blocks[index] = {
        ...block,
        text: update.text,
        revision: expectedRevision + 1,
      } as AnswerBlock;
    } else if (
      block.kind === "sandbox" &&
      this.policy.allowSandbox &&
      typeof update.source === "string" &&
      update.source.length <= 131072
    ) {
      this._blocks[index] = {
        ...block,
        source: update.source,
        revision: expectedRevision + 1,
      } as AnswerBlock;
    } else if (
      block.kind === "surface" &&
      Array.isArray(update.messages) &&
      update.messages.length <= 100
    ) {
      const validation = createUIRuntime(this.runtime.options);
      const log = this.surfaceLog.get(block.surfaceId)!;
      try {
        for (const message of log.messages) validation.accept(structuredClone(message));
        validation.accept({
          version: "v0.9",
          updateDataModel: {
            surfaceId: block.surfaceId,
            path: "/",
            value: structuredClone(this.runtime.read(block.surfaceId, "/")),
          },
        });
        for (const raw of update.messages) {
          const body = (raw as any)?.updateComponents ?? (raw as any)?.updateDataModel;
          if (!body || body.surfaceId !== block.surfaceId) throw Error("ARTIFACT_SCOPE");
          // A host's edit is checked strictly (the model's stream is repaired instead).
          for (const component of (raw as any)?.updateComponents?.components ?? [])
            parseComponent(component);
          if (validation.accept(raw).some((d) => d.severity === "error"))
            throw Error("ARTIFACT_INVALID");
        }
        if (validation.finish().some((d) => d.severity === "error"))
          throw Error("ARTIFACT_INVALID");
      } finally {
        validation.dispose();
      }
      for (const raw of update.messages) this.pushMessage(raw);
      this._blocks[index] = {
        ...this._blocks[index],
        revision: expectedRevision + 1,
      } as AnswerBlock;
    } else throw Error("ARTIFACT_UPDATE");
    this.touch();
  }

  // ── history ──────────────────────────────────────────────────────────────────────────────
  serialize(): AnswerSnapshot {
    const surfaces: AnswerSnapshot["surfaces"] = {};
    for (const [id, log] of this.surfaceLog) {
      surfaces[id] = {
        catalogId: log.catalogId,
        messages: log.messages,
        data: structuredClone(this.runtime.read(id, "/")),
      };
    }
    return redactContent({
      schema: SNAPSHOT_SCHEMA,
      protocol: "v0.9",
      sdk: this.options.sdkVersion,
      blocks: this._blocks as unknown as Record<string, unknown>[],
      surfaces,
    });
  }
  /** Rebuild an answer from a stored snapshot of any supported schema version. */
  static restore(
    input: unknown,
    runtime: UIRuntime,
    options: AnswerSessionOptions = {},
  ): AnswerSession {
    const snapshot = migrateSnapshot(input);
    const session = new AnswerSession(runtime, options);
    for (const raw of snapshot.blocks) {
      const block = raw as unknown as AnswerBlock;
      if (block.kind === "sandbox" && !session.policy.allowSandbox) {
        session._blocks.push({ ...block, status: "blocked", source: undefined });
        continue;
      }
      session._blocks.push(block);
      session.nextBlock = Math.max(session.nextBlock, Number(block.id.replace(/\D/g, "")) + 1 || 1);
      if (block.kind === "surface") {
        const stored = snapshot.surfaces[block.surfaceId];
        session.surfaceBlock.set(block.surfaceId, block.id);
        if (!stored) continue;
        const log: unknown[] = [];
        for (const message of stored.messages) {
          const diagnostics = runtime.accept(structuredClone(message));
          if (!diagnostics.some((d) => d.severity === "error")) log.push(message);
        }
        if (stored.data !== undefined && stored.data !== null)
          runtime.accept({
            version: "v0.9",
            updateDataModel: {
              surfaceId: block.surfaceId,
              path: "/",
              value: structuredClone(stored.data),
            },
          });
        session.surfaceLog.set(block.surfaceId, { catalogId: stored.catalogId, messages: log });
      }
    }
    runtime.finish();
    session._blocks = session._blocks.map((b) =>
      b.kind === "surface" && !b.fallbackText
        ? { ...b, fallbackText: describeSurface(runtime, b.surfaceId) }
        : b,
    );
    session.ended = true;
    session.touch();
    return session;
  }
}

/**
 * Upgrade any stored history to the current snapshot schema.
 *  - schema 2: current.
 *  - schema 1 / bare array / NDJSON string: A2UI messages only (pre-hybrid history); each surface
 *    becomes a surface block with a generated fallback and no Markdown.
 */
export function migrateSnapshot(input: unknown): AnswerSnapshot {
  let value = input;
  if (typeof value === "string")
    value = value
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  if (Array.isArray(value)) value = { schema: 1, messages: value };
  const v = value as { schema?: number; messages?: any[] };
  if (v?.schema === 1 && Array.isArray(v.messages)) {
    const surfaces: AnswerSnapshot["surfaces"] = {};
    const blocks: Record<string, unknown>[] = [];
    for (const message of v.messages) {
      const body =
        message?.createSurface ??
        message?.updateComponents ??
        message?.updateDataModel ??
        message?.deleteSurface;
      const id = body?.surfaceId;
      if (!id) continue;
      if (message.createSurface) {
        surfaces[id] = { catalogId: message.createSurface.catalogId, messages: [] };
        blocks.push({
          id: `b${blocks.length + 1}`,
          kind: "surface",
          surfaceId: id,
          fallbackText: "",
          fallbackSource: "generated",
          status: "complete",
        });
      }
      surfaces[id]?.messages.push(message);
    }
    return AnswerSnapshotSchema.parse({
      schema: SNAPSHOT_SCHEMA,
      protocol: "v0.9",
      blocks,
      surfaces,
    });
  }
  const parsed = AnswerSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new Error("UNSUPPORTED_SNAPSHOT");
  return parsed.data;
}

export { AnswerSession as AnswerComposer };
