import {
  ANSWER_WIRE_VERSION,
  type AnswerBlock,
  type AnswerEvent,
  type AnswerSnapshot,
  AnswerSnapshotSchema,
  ControlLineSchema,
  type Diagnostic,
  defaultHostPolicy,
  type HostPolicy,
  type MediaDeclaration,
  redactContent,
  SNAPSHOT_SCHEMA,
  type SurfaceDeclaration,
  type UIMessage,
} from "@engine/protocol";
import type { UIRuntime } from "./index.js";

export type AnswerItem =
  | { kind: "text"; text: string }
  | { kind: "json"; value: Record<string, unknown> }
  | { kind: "invalid"; line: string };

/**
 * Splits a mixed stream into Markdown text and one-line JSON control objects.
 * A line is control only if it is a complete JSON object carrying `version` (A2UI) or `engine`.
 * Text streams immediately (partial lines included) unless the line starts with `{`; JSON lines
 * wait for their newline so a half-received envelope is never shown as text. Fenced code is text.
 */
export class AnswerDecoder {
  private buffer = "";
  private mode: "unknown" | "text" | "json" = "unknown";
  private fence = false;
  private lineText = "";
  private utf8 = new TextDecoder("utf-8", { fatal: false });
  constructor(private maxLineBytes = 256 * 1024) {}

  push(chunk: string | Uint8Array): AnswerItem[] {
    this.buffer += typeof chunk === "string" ? chunk : this.utf8.decode(chunk, { stream: true });
    return this.drain(false);
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
    return out;
  }
  private classify(line: string, hadNewline: boolean, out: AnswerItem[]) {
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
        out.push({ kind: "invalid", line: line.slice(0, 120) });
        return;
      }
    }
    // Any other brace-led line is ordinary Markdown text.
    this.emitText(out, raw);
    this.endLine(line);
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
      case "Slider":
      case "TextField":
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

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export type AnswerState = {
  blocks: readonly AnswerBlock[];
  revision: number;
  ended: boolean;
};
export type AnswerSessionOptions = {
  policy?: Partial<HostPolicy>;
  sdkVersion?: string;
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
    return this.apply(this.decoder.push(chunk));
  }
  /** Start another assistant turn on the same answer: open text is closed, surfaces persist. */
  beginTurn() {
    this.closeMarkdown();
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
      else events.push(...this.control(item.value));
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
  pushMessage(message: unknown): AnswerEvent[] {
    return this.control(message as Record<string, unknown>);
  }

  private control(value: Record<string, unknown>): AnswerEvent[] {
    if ("engine" in value) return this.declaration(value);
    return this.a2ui(value);
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
        alt: decl.alt,
        status: "complete",
      };
      this._blocks.push(block);
      this.touch();
      events.push(this.emit({ type: "block", block }));
      return events;
    }
    // sandbox
    this.warnOnce(
      "POLICY_SANDBOX_DISABLED",
      "Sandboxed content is not enabled for this host.",
      "error",
    );
    if (!this.policy.allowSandbox) {
      const block: AnswerBlock = {
        id: this.newId(),
        kind: "sandbox",
        mode: decl.mode,
        fallbackText: decl.fallbackText,
        status: "blocked",
      };
      this._blocks.push(block);
      this.touch();
      events.push(this.emit({ type: "block", block }));
    }
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
    if (!allowed || !message.updateComponents) return message;
    const kept = message.updateComponents.components.filter(
      (c: { id: string; component: string }) => {
        if (allowed.includes(c.component)) return true;
        this.report({
          code: "COMPONENT_NOT_ALLOWED",
          message: `Component ${c.component} is not allowed by the host policy.`,
          componentId: c.id,
          surfaceId: message.updateComponents.surfaceId,
          expected: `one of ${JSON.stringify(allowed)}`,
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
    const events = this.apply(this.decoder.finish());
    events.push(...this.closeMarkdown());
    this.runtime.finish();
    let changed = false;
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
  /** Restore a surface to the data it had when its last model update finished. */
  reset(surfaceId: string) {
    const log = this.surfaceLog.get(surfaceId);
    if (!log) throw new Error("UNKNOWN_SURFACE");
    this.runtime.accept({ version: "v0.9", deleteSurface: { surfaceId } });
    for (const message of log.messages) this.runtime.accept(structuredClone(message));
    this.runtime.finish();
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
