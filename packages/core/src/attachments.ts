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
