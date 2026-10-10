import { z } from "zod";

export const ATTACHMENT_KINDS = ["image", "video", "audio", "file"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];
const transcript = z.union([
  z.string().max(200_000),
  z.array(z.object({ t: z.number().min(0), text: z.string().max(4000) }).strict()).max(5000),
]);

/**
 * Host-created attachment record. The engine never creates, uploads or stores the bytes.
 * `url`/`handle`/`thumbnailUrl` stay on the host side: they are never sent to the model.
 */
export const AttachmentManifestSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
    kind: z.enum(ATTACHMENT_KINDS),
    mime: z.string().max(128),
    name: z.string().max(256),
    size: z.number().int().nonnegative().optional(),
    url: z.string().max(4096).optional(),
    handle: z.string().max(1024).optional(),
    thumbnailUrl: z.string().max(4096).optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    duration: z.number().nonnegative().optional(),
    alt: z.string().max(1024).optional(),
    description: z.string().max(4000).optional(),
    transcript: transcript.optional(),
    textExtract: z.string().max(200_000).optional(),
    expiresAt: z.number().optional(),
    regions: z
      .array(
        z
          .object({
            id: z.string().max(128),
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            width: z.number().min(0).max(1),
            height: z.number().min(0).max(1),
            label: z.string().max(200),
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();
export type AttachmentManifest = z.infer<typeof AttachmentManifestSchema>;
export type AttachmentVisibility = {
  /** Host-supplied description, transcript and extracted text may be shown to the model. */
  text?: boolean;
  /** A thumbnail or the image itself may be sent to the model (opt-in, size-capped by the host). */
  vision?: boolean;
};

const EXT: Record<string, AttachmentKind> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  heic: "image",
  svg: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  mkv: "video",
  m4v: "video",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  ogg: "audio",
  flac: "audio",
  aac: "audio",
};
/** Infer the kind from MIME type or extension only; no network, no content sniffing. */
export function inferKind(mime: string | undefined, name = ""): AttachmentKind {
  const top = mime?.split("/")[0];
  if (top === "image" || top === "video" || top === "audio") return top;
  return EXT[name.split(".").pop()?.toLowerCase() ?? ""] ?? "file";
}
const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  json: "application/json",
};
export function inferMime(name: string, mime?: string) {
  return mime || MIME[name.split(".").pop()?.toLowerCase() ?? ""] || "application/octet-stream";
}

/** Redact signed URLs and query strings for logs, artifacts and history. */
export function redactUrl(value: string) {
  return value.replace(/(https?:\/\/[^\s"'<>?#]+)[?#][^\s"'<>]*/gi, "$1?[redacted]");
}
const omitUrls = (s: string) =>
  s.replace(/(?:https?:|data:|file:|blob:)[^\s<>"']+/gi, "[host URL omitted]");
const clip = (s: string, n: number) =>
  omitUrls(s).length > n ? `${omitUrls(s).slice(0, n)}…` : omitUrls(s);
/** The only view of an attachment the model may see. Binary, URLs and handles are never included. */
export function promptView(a: AttachmentManifest, visibility: AttachmentVisibility = {}) {
  const view: Record<string, unknown> = {
    id: a.id,
    kind: a.kind,
    mime: a.mime,
    name: clip(a.name, 120),
    size: a.size,
    width: a.width,
    height: a.height,
    duration: a.duration,
    alt: a.alt ? clip(a.alt, 300) : undefined,
    regions: a.regions?.map((r) => ({ ...r, label: clip(r.label, 200) })),
  };
  if (visibility.text) {
    view.description = a.description ? clip(a.description, 1000) : undefined;
    view.transcript =
      typeof a.transcript === "string"
        ? clip(a.transcript, 6000)
        : a.transcript?.slice(0, 200).map((x) => ({ t: x.t, text: clip(x.text, 300) }));
    view.textExtract = a.textExtract ? clip(a.textExtract, 6000) : undefined;
  }
  return Object.fromEntries(Object.entries(view).filter(([, v]) => v !== undefined));
}

/** Remove signed/query URL data from persisted histories and diagnostic/eval artifacts. */
export function redactContent<T>(value: T): T {
  if (typeof value === "string") return redactUrl(value) as T;
  if (Array.isArray(value)) return value.map(redactContent) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactContent(child)]),
    ) as T;
  return value;
}
