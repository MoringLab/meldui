import {
  type AttachmentManifest,
  AttachmentManifestSchema,
  type AttachmentVisibility,
  inferKind,
  inferMime,
  promptView,
} from "@engine/protocol";

export type AttachPurpose = "display" | "thumbnail" | "download" | "open";
export type ResolvedAttachment = {
  /** HTTPS, mailto or a host-provided local media URI. Never logged. */
  url: string;
  headers?: Record<string, string>;
  /** Epoch ms; the renderer asks the resolver again before this time or after a load error. */
  expiresAt?: number;
  mime?: string;
};
/** Host-owned: turns an attachment id into something displayable. The engine holds no credentials. */
export interface AttachmentResolver {
  resolve(id: string, purpose: AttachPurpose, signal?: AbortSignal): Promise<ResolvedAttachment>;
  open?(id: string, signal?: AbortSignal): Promise<void>;
  download?(id: string, signal?: AbortSignal): Promise<void>;
}

export type AttachInput = {
  /** A File/Blob-like object (name, type, size). Only its metadata is read. */
  file?: { name?: string; type?: string; size?: number };
  url?: string;
  id?: string;
  meta?: Partial<AttachmentManifest>;
};

/** Registers host attachments and exposes the model-safe view. It never uploads or stores bytes. */
export class AttachmentRegistry {
  private items = new Map<string, AttachmentManifest>();
  private visibility = new Map<string, AttachmentVisibility>();
  private counter = 0;
  constructor(
    private options: {
      defaultVisibility?: AttachmentVisibility;
      allowedSchemes?: string[];
      maxItems?: number;
    } = {},
  ) {}

  /** Register by manifest (already complete) or by file/url plus metadata. */
  attach(
    input: AttachInput | AttachmentManifest,
    visibility?: AttachmentVisibility,
  ): AttachmentManifest {
    if (this.items.size >= (this.options.maxItems ?? 200)) throw new Error("ATTACHMENT_LIMIT");
    const asInput = input as AttachInput;
    const complete = "kind" in input && "mime" in input && "name" in input;
    let manifest: AttachmentManifest;
    if (complete) manifest = AttachmentManifestSchema.parse(input);
    else {
      const name =
        asInput.file?.name ??
        asInput.meta?.name ??
        asInput.url?.split(/[?#]/)[0].split("/").pop() ??
        "attachment";
      const mime = inferMime(name, asInput.file?.type || asInput.meta?.mime);
      manifest = AttachmentManifestSchema.parse({
        ...asInput.meta,
        id: asInput.id ?? asInput.meta?.id ?? `att-${++this.counter}`,
        name,
        mime,
        kind: asInput.meta?.kind ?? inferKind(mime, name),
        size: asInput.file?.size ?? asInput.meta?.size,
        url: asInput.url ?? asInput.meta?.url,
      });
    }
    this.checkScheme(manifest.url);
    this.checkScheme(manifest.thumbnailUrl);
    if (this.items.has(manifest.id)) throw new Error("DUPLICATE_ATTACHMENT");
    this.items.set(manifest.id, manifest);
    if (visibility) this.visibility.set(manifest.id, visibility);
    return manifest;
  }
  private checkScheme(url?: string) {
    if (!url) return;
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
    const allowed = this.options.allowedSchemes ?? ["https"];
    if (!scheme || !allowed.includes(scheme)) throw new Error("UNSAFE_ATTACHMENT_URL");
  }
  has(id: string) {
    return this.items.has(id);
  }
  get(id: string) {
    return this.items.get(id);
  }
  list() {
    return [...this.items.values()];
  }
  remove(id: string) {
    this.items.delete(id);
    this.visibility.delete(id);
  }
  /** Model-visible description of one attachment, honoring per-attachment visibility. */
  view(id: string) {
    const a = this.items.get(id);
    return a
      ? promptView(a, { ...this.options.defaultVisibility, ...this.visibility.get(id) })
      : undefined;
  }
  /** Prompt-safe list. Never contains URLs, handles or credentials. */
  views() {
    return this.list().map((a) => this.view(a.id)!);
  }
  /** Image attachments the host allowed the model to see. Callers fetch thumbnails themselves. */
  visionIds() {
    return this.list()
      .filter(
        (a) =>
          a.kind === "image" &&
          { ...this.options.defaultVisibility, ...this.visibility.get(a.id) }.vision,
      )
      .map((a) => a.id);
  }
  /** Ids a model-produced block may reference; anything else is a repairable error. */
  unknownIds(ids: string[]) {
    return ids.filter((id) => !this.items.has(id));
  }
}

export type ContentPolicy = {
  /** Exact URL origins explicitly trusted by the host; empty denies all remote media. */
  origins: string[];
  schemes?: string[];
  maxBytes?: number;
  timeoutMs?: number;
  /** Attribute-free b/strong/i/em/s/del/code pairs only; raw HTML is never rendered. */
  formattingHtml?: boolean;
};
export type ContentHost = {
  attachments: AttachmentRegistry;
  resolver: AttachmentResolver;
  policy: ContentPolicy;
  /** Host decides whether to open/confirm a permitted external link. No built-in navigation. */
  openLink?: (url: string) => Promise<void> | void;
  onDiagnostic?: (code: string, attachmentId: string) => void;
  /** Words renderers show or announce around media, in the host's language. */
  labels?: Partial<MediaLabels>;
};
export type MediaLabels = {
  loading: string;
  unavailable: string;
  enlarge: string;
  close: string;
  previous: string;
  next: string;
  zoomIn: string;
  zoomOut: string;
  open: string;
  download: string;
};
export const DEFAULT_MEDIA_LABELS: MediaLabels = {
  loading: "Loading",
  unavailable: "Media unavailable",
  enlarge: "Enlarge",
  close: "Close",
  previous: "Previous",
  next: "Next",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  open: "Open",
  download: "Download",
};
export function checkResolvedAttachment(
  result: ResolvedAttachment,
  manifest: AttachmentManifest,
  policy: ContentPolicy,
  purpose: AttachPurpose,
): ResolvedAttachment {
  let url: URL;
  try {
    url = new URL(result.url);
  } catch {
    throw new Error("MEDIA_URL_BLOCKED");
  }
  const scheme = url.protocol.slice(0, -1);
  if (
    !["https", ...(policy.schemes ?? [])].includes(scheme) ||
    ["data", "javascript", "file"].includes(scheme)
  )
    throw new Error("MEDIA_URL_BLOCKED");
  if (url.username || url.password || !policy.origins.includes(url.origin))
    throw new Error("MEDIA_ORIGIN_BLOCKED");
  if (manifest.size !== undefined && manifest.size > (policy.maxBytes ?? 50 * 1024 * 1024))
    throw new Error("MEDIA_SIZE_LIMIT");
  if (result.expiresAt !== undefined && result.expiresAt <= Date.now())
    throw new Error("MEDIA_URL_EXPIRED");
  const mime = result.mime ?? manifest.mime;
  if (purpose === "thumbnail") {
    if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(mime)) throw new Error("MEDIA_TYPE_BLOCKED");
  } else if (
    mime !== manifest.mime ||
    /^(text\/html|image\/svg\+xml|application\/javascript)$/.test(mime)
  ) {
    throw new Error("MEDIA_TYPE_BLOCKED");
  }
  return { ...result, mime };
}
/** Resolve at most twice (once if an expired URL is returned). Never logs URLs or auth data. */
export async function resolveAttachment(
  host: ContentHost,
  id: string,
  purpose: AttachPurpose = "display",
  signal?: AbortSignal,
): Promise<ResolvedAttachment> {
  const manifest = host.attachments.get(id);
  if (!manifest) throw new Error("UNKNOWN_ATTACHMENT");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const timeout = setTimeout(cancel, host.policy.timeoutMs ?? 8000);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) controller.abort();
  const combined = controller.signal;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (combined.aborted) throw new Error("MEDIA_RESOLVE_ABORTED");
      let abort: () => void = () => {};
      const aborted = new Promise<never>((_, reject) => {
        abort = () => reject(new Error("MEDIA_RESOLVE_ABORTED"));
        combined.addEventListener("abort", abort, { once: true });
      });
      let response: ResolvedAttachment;
      try {
        response = await Promise.race([host.resolver.resolve(id, purpose, combined), aborted]);
      } finally {
        combined.removeEventListener("abort", abort);
      }
      if (combined.aborted) throw new Error("MEDIA_RESOLVE_ABORTED");
      try {
        return checkResolvedAttachment(response, manifest, host.policy, purpose);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "MEDIA_URL_EXPIRED" || attempt === 1)
          throw error;
      }
    }
    throw new Error("MEDIA_RESOLVE_FAILED");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}

export function mediaLayout(items: AttachmentManifest[]) {
  if (items.some((i) => i.kind === "file") || new Set(items.map((i) => i.kind)).size > 1)
    return "files";
  if (items[0]?.kind === "video" || items[0]?.kind === "audio") return "player";
  return items.length === 1
    ? "hero"
    : items.length === 2
      ? "compare"
      : items.length <= 6
        ? "grid"
        : "carousel";
}
