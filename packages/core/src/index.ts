import { Catalog, type ComponentApi } from "@a2ui/web_core/catalog";
import { MessageProcessor } from "@a2ui/web_core/processing";
import { batchWrite, getValue } from "@a2ui/web_core/reactivity";
import { DataModel } from "@a2ui/web_core/state";
import {
  type Action,
  ActionSchema,
  CATALOG_ID,
  type Capabilities,
  type Component,
  capabilitiesFor,
  componentSchemas,
  type Diagnostic,
  type Expr,
  functionDefinitions,
  MessageSchema,
  PROTOCOL_VERSION,
  repairComponent,
  type UIMessage,
  type UserAction,
} from "@engine/protocol";
import { assertSafeJson, evaluateExpression, resolvePath } from "./expression.js";
import { compileFormula } from "./formula.js";
import { NDJSONDecoder } from "./stream.js";

export * from "./answer.js";
export * from "./attachments.js";
export * from "./citations.js";
export * from "./expression.js";
export * from "./formula.js";
export * from "./stream.js";

export type UIModelEvent =
  | { type: "message"; message: UIMessage }
  | { type: "tool-delta"; id: string; name: string; arguments: string }
  | { type: "tool-call"; id: string; name: string; args: Record<string, unknown> }
  /** Raw model text in hybrid format; feed an AnswerSession. */
  | { type: "text"; text: string }
  | { type: "diagnostic"; diagnostic: Diagnostic }
  | { type: "usage"; inputTokens?: number; outputTokens?: number; model?: string }
  | { type: "complete"; status: "completed" | "cancelled" | "failed" };
export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  tool_call_id?: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  content:
    | string
    | (
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string; detail: "low" | "high" | "auto" } }
      )[];
};
export type ModelRequest = {
  messages: ModelMessage[];
  model: string;
  tools?: {
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  maxTokens?: number;
  latencyBudgetMs?: number;
  responseFormat?: Record<string, unknown>;
  normalization?: "off" | "safe";
  /** "a2ui" (default): adapter decodes NDJSON envelopes. "hybrid": adapter forwards raw text. */
  format?: "a2ui" | "hybrid";
};
export interface UIModelAdapter {
  stream(request: ModelRequest, options?: { signal?: AbortSignal }): AsyncIterable<UIModelEvent>;
}
export type NodeSnapshot = {
  id: string;
  component?: string;
  raw?: Component;
  props: Record<string, any>;
  scope: string;
  error?: string;
  /** Props left out because they could not be evaluated (the node still renders). */
  issues?: string[];
  revision?: number;
};

import { type AttachInput, AttachmentRegistry } from "./attachments.js";
export type RuntimeOptions = {
  attachments?: AttachmentRegistry;
  catalogId?: string;
  components?: ComponentApi[];
  /** Additive host schemas: the built-in catalog remains available. */
  customComponents?: ComponentApi[];
  onAction?: (action: UserAction) => void | Promise<void>;
  clientActions?: Record<string, (args: Record<string, unknown>) => void | Promise<void>>;
  onDiagnostic?: (diagnostic: Diagnostic) => void;
  limits?: Partial<{
    messageBytes: number;
    streamBytes: number;
    surfaces: number;
    components: number;
  }>;
};
const defaultLimits = {
  messageBytes: 256 * 1024,
  streamBytes: 8 * 1024 * 1024,
  surfaces: 16,
  components: 2000,
};
const overlapping = (a: string, b: string) =>
  a === "/" || b === "/" || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

const functions = functionDefinitions.map((definition) => ({
  ...definition,
  execute: (args: Record<string, unknown>, context: any) => {
    if (!definition.pure) throw new Error("ACTION_DISPATCH_REQUIRED");
    return evaluateExpression(exprOf(args), (path) =>
      getValue(context.dataModel.getSignal(resolvePath(path, context.path))),
    );
  },
}));
// Catalog descriptors and reference maps are immutable registration metadata.
// Reuse their caches; conversation data always belongs to a new processor.
let defaultCatalog: Catalog<any> | undefined;

/** A small policy layer around upstream A2UI state and component models. */
export class UIRuntime {
  readonly attachments: AttachmentRegistry;
  attach(input: AttachInput) {
    return this.attachments.attach(input);
  }
  readonly processor: MessageProcessor<any>;
  readonly componentApis: ComponentApi[];
  readonly diagnostics: Diagnostic[] = [];
  readonly limits;
  private listeners = new Set<() => void>();
  private nodeListeners = new Map<string, Set<() => void>>();
  private sceneRevisions = new Map<string, number>();
  private snapshots = new Map<string, { signature: string; snapshot: NodeSnapshot }>();
  private dirty = new Map<string, Set<string>>();
  private pending = new Map<string, Map<string, UIMessage>>();
  private errors = new Map<string, string>();
  private seenEvents = new Set<string>();
  private revision = 0;
  private diagnosticSequence = 0;
  private diagnosticEvents: { sequence: number; diagnostic: Diagnostic }[] = [];
  private disposed = false;
  private runs = new Map<string, AbortController>();
  private cleanups = new Set<() => void>();
  constructor(readonly options: RuntimeOptions = {}) {
    this.attachments = options.attachments ?? new AttachmentRegistry();
    this.limits = { ...defaultLimits, ...options.limits };
    const components = options.components ?? [
      ...Object.entries(componentSchemas).map(([name, schema]) => ({ name, schema })),
      ...(options.customComponents ?? []),
    ];
    if (new Set(components.map((c) => c.name)).size !== components.length)
      throw Error("DUPLICATE_COMPONENT_NAME");
    this.componentApis = components;
    let catalog: Catalog<any>;
    if (!options.components && !options.customComponents?.length && !options.catalogId) {
      defaultCatalog ??= new Catalog(CATALOG_ID, PROTOCOL_VERSION, components, functions);
      catalog = defaultCatalog;
    } else
      catalog = new Catalog(
        options.catalogId ?? CATALOG_ID,
        PROTOCOL_VERSION,
        components,
        functions,
      );
    this.processor = new MessageProcessor([catalog], undefined, {
      version: PROTOCOL_VERSION,
      validationConfig: {
        targetVersion: PROTOCOL_VERSION,
        allowMissingRoot: true,
        allowDanglingReferences: true,
        allowOrphanComponents: true,
        allowUnknownElements: false,
        maxDepth: 50,
      },
    });
  }
  /** Runtime-level subscription: surface lifecycle and diagnostics only. */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getRevision = () => this.revision;
  get surfaceIds() {
    return [...this.processor.getSurfaces().keys()];
  }
  getSurface(id: string) {
    return this.processor.getSurface(id);
  }
  capabilities(platform: Capabilities["platform"]): Capabilities {
    const base = capabilitiesFor(platform, {
      catalogIds: [this.options.catalogId ?? CATALOG_ID],
      clientActions: Object.keys(this.options.clientActions ?? {}),
    });
    return {
      ...base,
      components: this.componentApis
        .filter(
          (api) =>
            (base.components?.includes(api.name) || !Object.hasOwn(componentSchemas, api.name)) &&
            (!(api as any).definition || (api as any).definition.platforms.includes(platform)),
        )
        .map((api) => api.name),
    };
  }
  private changed() {
    this.revision++;
    for (const fn of this.listeners) fn();
  }
  report(diagnostic: Diagnostic) {
    this.diagnosticEvents.push({ sequence: ++this.diagnosticSequence, diagnostic });
    if (this.diagnosticEvents.length > 200) this.diagnosticEvents.shift();
    if (this.diagnostics.length >= 200) this.diagnostics.shift();
    this.diagnostics.push(diagnostic);
    this.options.onDiagnostic?.(diagnostic);
    this.changed();
  }
  private notifyNode(surfaceId: string, id: string) {
    for (const fn of this.nodeListeners.get(`${surfaceId}\0${id}`) ?? []) fn();
  }
  /** Validate and apply one envelope. Invalid nodes do not replace valid state. */
  accept(input: unknown, eventId?: string): Diagnostic[] {
    if (this.disposed) throw new Error("RUNTIME_DISPOSED");
    if (eventId && this.seenEvents.has(eventId)) return [];
    const before = this.diagnosticSequence;
    let surfaceId: string | undefined;
    try {
      assertSafeJson(input);
      if (new TextEncoder().encode(JSON.stringify(input)).length > this.limits.messageBytes)
        throw new Error("MESSAGE_LIMIT");
      const message = MessageSchema.parse(input);
      const body =
        "createSurface" in message
          ? message.createSurface
          : "updateComponents" in message
            ? message.updateComponents
            : "updateDataModel" in message
              ? message.updateDataModel
              : message.deleteSurface;
      surfaceId = body.surfaceId;
      if (!("createSurface" in message) && !this.getSurface(surfaceId))
        throw new Error("UNKNOWN_SURFACE");
      if ("createSurface" in message) {
        if (this.surfaceIds.length >= this.limits.surfaces) throw new Error("SURFACE_LIMIT");
        if (this.getSurface(surfaceId)) throw new Error("DUPLICATE_SURFACE");
        this.processor.processMessages(message);
        this.changed();
      } else if ("updateComponents" in message) {
        const surface = this.getSurface(surfaceId)!;
        const incoming = message.updateComponents.components;
        const ids = new Set(incoming.map((c) => c.id));
        if (ids.size !== incoming.length) throw new Error("DUPLICATE_COMPONENT_ID");
        const tracked = new Set([...surface.componentsModel.values].map((node) => node.id));
        for (const key of this.errors.keys())
          if (key.startsWith(`${surfaceId}\0`)) tracked.add(key.slice(surfaceId.length + 1));
        const added = [...ids].filter((id) => !tracked.has(id)).length;
        if (tracked.size + added > this.limits.components) throw new Error("COMPONENT_LIMIT");
        const schemas = Object.fromEntries(
          this.componentApis.map((entry) => [entry.name, entry.schema]),
        );
        // The pinned upstream validates a candidate graph before any mutation.
        // Valid batches need one graph check; rejected batches retain isolation.
        let applied = false;
        try {
          const components = incoming.map((raw) => {
            this.validateMediaRefs(raw);
            return this.repaired(surfaceId, raw, schemas, false);
          });
          this.processor.processMessages({
            version: PROTOCOL_VERSION,
            updateComponents: { surfaceId, components },
          });
          applied = true;
        } catch {
          /* The per-node path below reports and isolates the failures. */
        }
        for (const raw of incoming) {
          try {
            if (!applied) {
              this.validateMediaRefs(raw);
              const component = this.repaired(surfaceId, raw, schemas, false);
              this.processor.processMessages({
                version: PROTOCOL_VERSION,
                updateComponents: { surfaceId, components: [component] },
              });
            }
            this.errors.delete(`${surfaceId}\0${raw.id}`);
          } catch (error) {
            const diagnostic = this.errorDiagnostic(error, surfaceId, raw.id);
            this.errors.set(`${surfaceId}\0${raw.id}`, diagnostic.message);
            this.report(diagnostic);
          }
          this.notifyNode(surfaceId, raw.id);
        }
      } else if ("updateDataModel" in message) {
        const path = resolvePath(message.updateDataModel.path ?? "/");
        if ([...(this.dirty.get(surfaceId) ?? [])].some((edited) => overlapping(edited, path))) {
          const writes = this.pending.get(surfaceId) ?? new Map<string, UIMessage>();
          if (writes.size >= 200 && !writes.has(path)) writes.delete(writes.keys().next().value!);
          writes.set(path, message);
          this.pending.set(surfaceId, writes);
          this.report({
            code: "LOCAL_EDIT_CONFLICT",
            message: "A model update overlaps a local edit; the local value was preserved.",
            surfaceId,
            path,
            severity: "warning",
          });
        } else this.processor.processMessages(message);
      } else {
        this.runs.get(surfaceId)?.abort();
        this.runs.delete(surfaceId);
        this.processor.processMessages(message);
        this.dirty.delete(surfaceId);
        this.pending.delete(surfaceId);
        for (const key of this.errors.keys())
          if (key.startsWith(`${surfaceId}\0`)) this.errors.delete(key);
        for (const key of this.sceneRevisions.keys())
          if (key.startsWith(`${surfaceId}\0`)) this.sceneRevisions.delete(key);
        for (const key of this.snapshots.keys())
          if (key.startsWith(`${surfaceId}\0`)) this.snapshots.delete(key);
        for (const key of this.nodeListeners.keys())
          if (key.startsWith(`${surfaceId}\0`))
            for (const fn of this.nodeListeners.get(key) ?? []) fn();
        this.changed();
      }
      if (eventId) {
        if (this.seenEvents.size >= 10000)
          this.seenEvents.delete(this.seenEvents.values().next().value!);
        this.seenEvents.add(eventId);
      }
    } catch (error) {
      this.report(this.errorDiagnostic(error, surfaceId));
    }
    return this.diagnosticEvents
      .filter((event) => event.sequence > before)
      .map((event) => event.diagnostic);
  }
  /**
   * The component as the model meant it: repaired rather than rejected (see repairComponent).
   * Repairs are reported once, as warnings, when the batch is applied per node.
   */
  private repaired(
    surfaceId: string | undefined,
    raw: Component,
    schemas: Record<string, unknown>,
    quiet = true,
  ): Component {
    const { component, repairs } = repairComponent(
      raw,
      schemas as Parameters<typeof repairComponent>[1],
    );
    if (repairs.length && !quiet)
      this.report({
        code: "COMPONENT_REPAIRED",
        message: repairs.slice(0, 6).join("; ").slice(0, 400),
        severity: "warning",
        surfaceId,
        componentId: component.id,
      });
    return component;
  }
  private validateMediaRefs(raw: Component) {
    const ids =
      typeof raw.attachmentId === "string"
        ? [raw.attachmentId]
        : Array.isArray(raw.attachmentIds)
          ? (raw.attachmentIds as string[])
          : [];
    if (this.attachments.unknownIds(ids).length) throw new Error("UNKNOWN_ATTACHMENT");
    if (raw.component === "Image" && !raw.attachmentId && !raw.asset)
      throw new Error("IMAGE_SOURCE_REQUIRED");
    if (raw.component === "ImageAnnotations") {
      const manifest = this.attachments.get(ids[0]);
      if (
        (raw.regionIds as string[] | undefined)?.some(
          (id) => !manifest?.regions?.some((r) => r.id === id),
        )
      )
        throw new Error("UNKNOWN_ATTACHMENT_REGION");
    }
  }
  private errorDiagnostic(error: unknown, surfaceId?: string, componentId?: string): Diagnostic {
    const zod = error as {
      issues?: {
        path: (string | number)[];
        code: string;
        message: string;
        expected?: string;
        options?: unknown[];
        keys?: string[];
      }[];
    };
    if (zod.issues?.length) {
      const issue = zod.issues[0];
      return {
        code: "INVALID_SCHEMA",
        message: `Invalid ${issue.code} at ${issue.path.join(".") || "message"}.`,
        expected:
          issue.expected ??
          (issue.options
            ? `one of ${JSON.stringify(issue.options)}`
            : issue.keys
              ? "Only properties defined by the component schema"
              : "A valid catalog property; inspect the schema at this path"),
        path: issue.path.join("/"),
        surfaceId,
        componentId,
        severity: "error",
      };
    }
    const code = error instanceof Error ? error.message : "INVALID_MESSAGE";
    return {
      code: /^[A-Z_]+$/.test(code) ? code : "INVALID_COMPONENT",
      message: /^[A-Z_]+$/.test(code)
        ? code
        : "The component does not satisfy the catalog or graph contract.",
      surfaceId,
      componentId,
      severity: "error",
    };
  }
  /** Mark a new generation. Local edits after this point win over model writes. */
  beginRun(surfaceId: string): AbortSignal {
    this.runs.get(surfaceId)?.abort();
    const controller = new AbortController();
    this.runs.set(surfaceId, controller);
    return controller.signal;
  }
  cancel(surfaceId: string) {
    this.runs.get(surfaceId)?.abort();
  }
  async consume(stream: AsyncIterable<unknown>, options: { signal?: AbortSignal } = {}) {
    let receivedBytes = 0;
    const decoder = new NDJSONDecoder(
      (d) => this.report(d),
      this.limits.messageBytes,
      this.limits.streamBytes,
    );
    try {
      for await (const chunk of stream) {
        if (options.signal?.aborted || this.disposed) break;
        receivedBytes +=
          chunk instanceof Uint8Array
            ? chunk.byteLength
            : new TextEncoder().encode(typeof chunk === "string" ? chunk : JSON.stringify(chunk))
                .length;
        if (receivedBytes > this.limits.streamBytes) throw new Error("STREAM_LIMIT");
        if (typeof chunk === "string" || chunk instanceof Uint8Array)
          for (const message of decoder.push(chunk)) this.accept(message);
        else {
          this.accept(chunk);
        }
      }
      if (!options.signal?.aborted && !this.disposed) {
        for (const message of decoder.finish()) this.accept(message);
        this.finish();
      }
    } catch (error) {
      if (!options.signal?.aborted) this.report(this.errorDiagnostic(error));
    }
  }
  /** At stream completion, unresolved references become reportable errors. */
  finish() {
    const before = this.diagnosticSequence;
    for (const surfaceId of this.surfaceIds) {
      for (const node of this.getSurface(surfaceId)!.componentsModel.values) {
        const snapshot = this.getNodeSnapshot(surfaceId, node.id);
        if (snapshot.error)
          this.report({
            code: snapshot.error,
            message: "The expression cannot resolve to its declared type.",
            surfaceId,
            componentId: node.id,
            severity: "error",
          });
        // A prop that could not be evaluated was left out; the node still renders.
        for (const issue of snapshot.issues ?? [])
          this.report({
            code: issue.split(": ").at(-1) || "EXPRESSION_ERROR",
            message: `Left out ${issue.split(": ")[0]}: it could not be evaluated.`,
            surfaceId,
            componentId: node.id,
            severity: "warning",
          });
      }
    }
    for (const surfaceId of this.surfaceIds) {
      if (!this.getSurface(surfaceId)!.componentsModel.has("root")) {
        this.report({
          code: "MISSING_ROOT",
          message: "The surface requires a root component at completion.",
          surfaceId,
          componentId: "root",
          severity: "error",
        });
        continue;
      }
      try {
        this.getSurface(surfaceId)!.componentsModel.validateTopology({
          allowMissingRoot: false,
          allowDanglingReferences: false,
          allowOrphanComponents: true,
        });
      } catch (error) {
        this.report(this.errorDiagnostic(error, surfaceId));
      }
    }
    return this.diagnosticEvents
      .filter((event) => event.sequence > before)
      .map((event) => event.diagnostic);
  }
  read(surfaceId: string, path: string, scope = "/"): any {
    // Inside a template ({componentId, path}) $item/$row is the row and $index/$rowIndex its
    // position, so a row's buttons can toggle or remove that row. Inside map/filter the loop's own
    // $item/$index shadow them; $row/$rowIndex stay the template row
    // (remove: filter(list, ne($index, $rowIndex))).
    if (path === "$item" || path === "$row")
      return this.getSurface(surfaceId)?.dataModel.get(scope);
    if (path === "$index" || path === "$rowIndex") {
      const last = scope.split("/").pop() ?? "";
      return /^\d+$/.test(last) ? Number(last) : null;
    }
    return this.getSurface(surfaceId)?.dataModel.get(resolvePath(path, scope));
  }
  getPendingWrites(surfaceId: string) {
    return [...(this.pending.get(surfaceId) ?? [])].map(([path, message]) => ({ path, message }));
  }
  /** Call accept-model only after the host obtains the user's decision. */
  resolveConflict(surfaceId: string, path: string, decision: "keep-local" | "accept-model") {
    const resolved = resolvePath(path);
    const message = this.pending.get(surfaceId)?.get(resolved);
    if (!message) throw new Error("UNKNOWN_CONFLICT");
    this.pending.get(surfaceId)!.delete(resolved);
    if (decision === "accept-model") {
      const edits = this.dirty.get(surfaceId);
      for (const edit of edits ?? []) if (overlapping(edit, resolved)) edits!.delete(edit);
      return this.accept(message);
    }
    return [];
  }
  /** Resolve values without exposing host objects or invoking side effects. */
  resolve(surfaceId: string, value: any, scope = "/"): any {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((v) => this.resolve(surfaceId, v, scope));
    if (typeof value.path === "string" && Object.keys(value).length === 1)
      return this.read(surfaceId, value.path, scope);
    if (typeof value.call === "string") {
      if (
        !["computeNumber", "computeString", "computeBoolean", "computeArray"].includes(value.call)
      )
        throw new Error("IMPURE_EXPRESSION");
      const result = evaluateExpression(exprOf(value.args), (path) =>
        this.read(surfaceId, path, scope),
      );
      const expected = value.call.slice(7).toLowerCase();
      if (expected === "array" ? !Array.isArray(result) : typeof result !== expected)
        throw new Error("EXPRESSION_TYPE");
      return result;
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, this.resolve(surfaceId, v, scope)]),
    );
  }
  getNodeSnapshot(surfaceId: string, id: string, scope = "/"): NodeSnapshot {
    const key = `${surfaceId}\0${id}\0${scope}`;
    const component = this.getSurface(surfaceId)?.componentsModel.get(id);
    let snapshot: NodeSnapshot = {
      id,
      props: {},
      scope,
      error: this.errors.get(`${surfaceId}\0${id}`),
    };
    if (component) {
      const raw = { id, component: component.type, ...component.properties } as Component;
      // Each prop on its own: one that cannot be evaluated (a formula over missing data, a
      // value of the wrong type) is left out and the widget draws without it — never an error
      // card. What failed stays in `issues` for diagnostics.
      const props: Record<string, unknown> = {};
      const issues: string[] = [];
      for (const [k, v] of Object.entries(component.properties)) {
        if (["action", "onSubmit", "children", "tabs", "items", "nodes"].includes(k)) {
          props[k] = v;
          continue;
        }
        try {
          props[k] = this.resolve(surfaceId, v, scope);
        } catch (error) {
          issues.push(`${k}: ${error instanceof Error ? error.message : "EXPRESSION_ERROR"}`);
        }
      }
      snapshot = {
        id,
        component: component.type,
        raw,
        props,
        scope,
        ...(issues.length ? { issues } : {}),
      };
    }
    if (component?.type === "SvgScene") snapshot.revision = this.sceneRevisions.get(key) ?? 0;
    const signature = JSON.stringify(snapshot);
    if (this.snapshots.get(key)?.signature === signature) return this.snapshots.get(key)!.snapshot;
    this.snapshots.set(key, { signature, snapshot });
    return snapshot;
  }
  /** Subscribe only to this component and data paths its props actually reference. */
  subscribeNode(surfaceId: string, id: string, scope: string, listener: () => void): () => void {
    const key = `${surfaceId}\0${id}`;
    const set = this.nodeListeners.get(key) ?? new Set();
    this.nodeListeners.set(key, set);
    let unsubscribers: (() => void)[] = [];
    const bind = () => {
      for (const fn of unsubscribers) fn();
      unsubscribers = [];
      const surface = this.getSurface(surfaceId);
      const component = surface?.componentsModel.get(id);
      const paths = new Set<string>();
      const walk = (v: unknown) => {
        if (!v || typeof v !== "object") return;
        for (const [k, val] of Object.entries(v)) {
          if (k === "formula" && typeof val === "string") {
            try {
              walk(compiled(val));
            } catch {
              /* a bad formula reports when it is evaluated */
            }
            continue;
          }
          if ((k === "path" || k === "ref") && typeof val === "string") {
            if (val === "$index" || val === "$rowIndex") continue;
            paths.add(val === "$item" || val === "$row" ? scope : resolvePath(val, scope));
          } else walk(val);
        }
      };
      if (component) {
        walk(component.properties);
        for (const path of paths) {
          const sub = surface!.dataModel.subscribe(path, () => {
            if (component.type === "SvgScene") {
              const fullKey = `${key}\0${scope}`;
              this.sceneRevisions.set(fullKey, (this.sceneRevisions.get(fullKey) ?? 0) + 1);
            }
            listener();
          });
          unsubscribers.push(() => sub.unsubscribe());
        }
      }
      listener();
    };
    set.add(bind);
    bind();
    const cleanup = () => {
      set.delete(bind);
      if (!set.size) this.nodeListeners.delete(key);
      for (const fn of unsubscribers) fn();
      this.cleanups.delete(cleanup);
    };
    this.cleanups.add(cleanup);
    return cleanup;
  }
  /** Commit a user edit synchronously before resolving a following action. */
  setValue(surfaceId: string, path: string, value: unknown, scope = "/") {
    assertSafeJson(value);
    const resolved = resolvePath(path, scope);
    const surface = this.getSurface(surfaceId);
    if (!surface) throw new Error("UNKNOWN_SURFACE");
    surface.dataModel.set(resolved, value);
    const edited = this.dirty.get(surfaceId) ?? new Set();
    edited.add(resolved);
    this.dirty.set(surfaceId, edited);
  }
  /** Dispatch only from a trusted host interaction, never from model ingestion. */
  async dispatch(surfaceId: string, componentId: string, input: Action, scope = "/") {
    try {
      const action = ActionSchema.parse(input);
      if (!this.getSurface(surfaceId)?.componentsModel.has(componentId))
        throw new Error("UNKNOWN_COMPONENT");
      if ("event" in action) {
        const context = this.resolve(surfaceId, action.event.context ?? {}, scope);
        await this.options.onAction?.({
          name: action.event.name,
          timestamp: new Date().toISOString(),
          surfaceId,
          sourceComponentId: componentId,
          context,
        });
        return;
      }
      const { call, args } = action.functionCall;
      functionDefinitions.find((definition) => definition.name === call)!.schema.parse(args);
      if (call === "setValue" || call === "setValues") {
        const updates = call === "setValue" ? [args] : args.updates;
        if (!Array.isArray(updates) || updates.length > 20) throw new Error("ACTION_LIMIT");
        const resolved = updates.map((entry) => {
          if (!entry || typeof entry.path !== "string") throw new Error("INVALID_POINTER");
          const value =
            entry.expr !== undefined || typeof entry.formula === "string"
              ? evaluateExpression(exprOf(entry), (path) => this.read(surfaceId, path, scope))
              : this.resolve(surfaceId, entry.value, scope);
          assertSafeJson(value);
          return { path: resolvePath(entry.path, scope), value };
        });
        const validationModel = new DataModel(
          JSON.parse(JSON.stringify(this.read(surfaceId, "/"))),
        );
        try {
          for (const update of resolved) validationModel.set(update.path, update.value);
        } finally {
          validationModel.dispose();
        }
        batchWrite(() => {
          for (const update of resolved) this.setValue(surfaceId, update.path, update.value);
        });
      } else {
        const handler = this.options.clientActions?.[call];
        if (!handler) throw new Error("CLIENT_ACTION_DENIED");
        const values = this.resolve(surfaceId, args, scope);
        if (call === "openUrl") {
          const url = new URL(String(values.url));
          if (url.protocol !== "https:" || url.username || url.password)
            throw new Error("UNSAFE_URL");
        }
        await handler(values);
      }
    } catch (error) {
      this.report(this.errorDiagnostic(error, surfaceId, componentId));
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const run of this.runs.values()) run.abort();
    for (const cleanup of [...this.cleanups]) cleanup();
    this.processor.dispose();
    this.listeners.clear();
    this.nodeListeners.clear();
    this.snapshots.clear();
    this.sceneRevisions.clear();
    this.dirty.clear();
    this.pending.clear();
    this.errors.clear();
  }
}

/** Create an isolated runtime per conversation/session. */
export function createUIRuntime(options?: RuntimeOptions) {
  return new UIRuntime(options);
}

export * from "./host-bridge.js";
export * from "./markdown.js";
export * from "./sandbox.js";
export * from "./simulations.js";
export * from "./svg.js";
export * from "./ticker.js";
export * from "./visuals.js";

const formulas = new Map<string, Expr>();
/** A formula string compiled once (bounded cache). */
function compiled(formula: string): Expr {
  let expr = formulas.get(formula);
  if (!expr) {
    expr = compileFormula(formula);
    if (formulas.size > 500) formulas.clear();
    formulas.set(formula, expr);
  }
  return expr;
}

/** The expression of computed args or a setValue entry: `expr`, or a compiled `formula`. */
function exprOf(args: { expr?: unknown; formula?: unknown }): Expr {
  return typeof args.formula === "string" ? compiled(args.formula) : (args.expr as Expr);
}
