import type { AttachmentRegistry, ContentHost } from "../../packages/core/dist/index";
import cases from "./cases.json";

const files: Record<string, string> = {
  "photo-a": "coast.png",
  "photo-b": "mountain.png",
  "video-a": "sample.mp4",
  "audio-a": "sample.wav",
  "file-a": "report.pdf",
};
/** Reference HOST resolver. Generated model messages contain only the IDs, never these URLs. */
export function sampleContent(
  registry: AttachmentRegistry,
  baseURL: string,
  onAction?: (id: string) => void,
): ContentHost {
  const base = new URL(baseURL);
  for (const manifest of cases[0].attachments)
    if (!registry.has(manifest.id)) registry.attach(manifest as never);
  return {
    attachments: registry,
    policy: { origins: [base.origin], schemes: base.protocol === "http:" ? ["http"] : [] },
    resolver: {
      resolve: async (id) => {
        const manifest = registry.get(id);
        if (!manifest || !files[id]) throw new Error("UNKNOWN_ATTACHMENT");
        return { url: new URL(`/api/attachments/${files[id]}`, base).href, mime: manifest.mime };
      },
      open: async (id) => onAction?.(`open:${id}`),
      download: async (id) => onAction?.(`download:${id}`),
    },
  };
}
