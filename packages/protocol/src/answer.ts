import { z } from "zod";

/** Hybrid answer wire, additive to A2UI v0.9: Markdown text and one-line JSON control lines. */
export const ANSWER_WIRE_VERSION = "v1" as const;
export const SNAPSHOT_SCHEMA = 2 as const;

const id = z.string().min(1).max(128);
const attachmentId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/** Declares the next surface and its required plain-text equivalent. */
export const SurfaceDeclarationSchema = z
  .object({
    engine: z.literal(ANSWER_WIRE_VERSION),
    block: z.literal("surface"),
    surfaceId: id,
    fallbackText: z.string().min(1).max(4000),
    title: z.string().max(200).optional(),
  })
  .strict();
export const MEDIA_LAYOUTS = [
  "auto",
  "hero",
  "compare",
  "grid",
  "carousel",
  "mosaic",
  "player",
  "files",
] as const;
export const MediaDeclarationSchema = z
  .object({
    engine: z.literal(ANSWER_WIRE_VERSION),
    block: z.literal("media"),
    attachments: z.array(attachmentId).min(1).max(40),
    layout: z.enum(MEDIA_LAYOUTS).default("auto"),
    caption: z.string().max(1000).optional(),
    markdown: z.string().max(65536).optional(),
    placement: z.enum(["left", "right", "above", "below"]).default("below"),
    mediaFraction: z.number().min(0.25).max(0.65).default(0.4),
    alt: z.array(z.string().max(1024)).max(40).optional(),
  })
  .strict();
/** Reserved for the sandbox milestone; refused unless the host policy allows it. */
export const SandboxDeclarationSchema = z
  .object({
    engine: z.literal(ANSWER_WIRE_VERSION),
    block: z.literal("sandbox"),
    mode: z.enum(["html", "app"]),
    artifactId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,128}$/)
      .optional(),
    phase: z.enum(["preview", "complete"]).optional(),
    libraries: z
      .array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/))
      .max(10)
      .optional(),
    state: z.record(z.unknown()).optional(),
    source: z.string().max(131072).optional(),
    fallbackText: z.string().min(1).max(4000),
  })
  .passthrough();
export const ControlLineSchema = z.union([
  SurfaceDeclarationSchema,
  MediaDeclarationSchema,
  SandboxDeclarationSchema,
]);
export type SurfaceDeclaration = z.infer<typeof SurfaceDeclarationSchema>;
export type MediaDeclaration = z.infer<typeof MediaDeclarationSchema>;
export type MediaLayout = (typeof MEDIA_LAYOUTS)[number];

export const HostPolicySchema = z
  .object({
    mode: z.enum(["auto", "markdown-only", "engine-only"]).default("auto"),
    maxSurfaces: z.number().int().min(0).max(16).default(3),
    /** Undefined = every component the renderer supports. */
    allowedComponents: z.array(z.string()).optional(),
    allowMedia: z.boolean().default(true),
    allowSandbox: z.boolean().default(false),
    maxOutputTokens: z.number().int().min(1).max(8192).optional(),
    latencyBudgetMs: z.number().int().min(1).max(120000).optional(),
    /** Content height policy: undefined grows with content; a number caps it with internal scroll. */
    maxSurfaceHeight: z.number().positive().optional(),
  })
  .strict();
export type HostPolicy = z.infer<typeof HostPolicySchema>;
export const defaultHostPolicy = (policy: Partial<HostPolicy> = {}): HostPolicy =>
  HostPolicySchema.parse(policy);

export type AnswerBlockStatus = "streaming" | "complete" | "error" | "blocked";
export type AnswerBlock =
  | { id: string; kind: "markdown"; text: string; status: AnswerBlockStatus }
  | {
      id: string;
      kind: "surface";
      surfaceId: string;
      fallbackText: string;
      fallbackSource: "model" | "generated";
      title?: string;
      status: AnswerBlockStatus;
    }
  | {
      id: string;
      kind: "media";
      attachmentIds: string[];
      layout: MediaLayout;
      caption?: string;
      markdown?: string;
      placement?: "left" | "right" | "above" | "below";
      mediaFraction?: number;
      alt?: string[];
      status: AnswerBlockStatus;
    }
  | {
      id: string;
      kind: "sandbox";
      mode: "html" | "app";
      phase?: "preview" | "complete";
      libraries?: string[];
      state?: Record<string, unknown>;
      revision?: number;
      source?: string;
      fallbackText: string;
      /** "building": the declaration is still streaming (source not here yet); see `progress`. */
      status: "blocked" | "complete" | "building";
      /** While building: what the streamed source has reached (styles, layout, behaviour). */
      progress?: "layout" | "style" | "script";
      title?: string;
    };

export type AnswerEvent =
  | { seq: number; type: "markdown"; blockId: string; text: string }
  | { seq: number; type: "block"; block: AnswerBlock }
  | { seq: number; type: "message"; blockId: string; message: unknown }
  | { seq: number; type: "block-end"; blockId: string }
  | { seq: number; type: "end" };

/** Persisted answer: blocks, per-surface message log and the user's data-model state. */
export const AnswerSnapshotSchema = z.object({
  schema: z.literal(SNAPSHOT_SCHEMA),
  protocol: z.literal("v0.9"),
  sdk: z.string().max(64).optional(),
  blocks: z.array(z.record(z.unknown())).max(200),
  surfaces: z.record(
    z.object({
      catalogId: z.string(),
      messages: z.array(z.unknown()).max(5000),
      data: z.unknown().optional(),
    }),
  ),
});
export type AnswerSnapshot = z.infer<typeof AnswerSnapshotSchema>;
