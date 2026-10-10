// biome-ignore-all lint/correctness/useExhaustiveDependencies: generation explicitly refreshes resolver URLs; identity changes reset retries
import {
  attachmentIdFrom,
  type ContentHost,
  markdownDestination,
  mediaLayout,
  type ResolvedAttachment,
  resolveAttachment,
} from "@engine/core";
import React, {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
export const ContentContext = createContext<ContentHost | undefined>(undefined);
export function ContentProvider({ host, children }: { host?: ContentHost; children: ReactNode }) {
  return <ContentContext.Provider value={host}>{children}</ContentContext.Provider>;
}
export const useContentHost = () => useContext(ContentContext);

export function useAttachment(id: string, thumbnail = false) {
  const host = useContentHost();
  const [state, setState] = useState<{ value?: ResolvedAttachment; error?: string; id: string }>({
    id,
  });
  const [generation, setGeneration] = useState(0);
  const retries = useRef(0);
  useEffect(() => {
    retries.current = 0;
  }, [id, host]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({ id });
    if (!host) {
      setState({ id, error: "MEDIA_HOST_REQUIRED" });
      return;
    }
    void resolveAttachment(host, id, thumbnail ? "thumbnail" : "display", controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setState({ id, value });
        if (value.expiresAt)
          timer = setTimeout(
            () => setGeneration((g) => g + 1),
            Math.max(1000, value.expiresAt - Date.now() - 1000),
          );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          host.onDiagnostic?.("MEDIA_RESOLVE_FAILED", id);
          setState({ id, error: "Media unavailable" });
        }
      });
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [host, id, thumbnail, generation]);
  return {
    ...(state.id === id ? state : { id }),
    failed: () => {
      if (retries.current++ === 0) setGeneration((g) => g + 1);
      else {
        host?.onDiagnostic?.("MEDIA_LOAD_FAILED", id);
        setState({ id, error: "Media unavailable" });
      }
    },
  };
}
export async function openContentLink(host: ContentHost | undefined, value: string) {
  const safe = markdownDestination(value);
  if (!safe || !host) return;
  const id = attachmentIdFrom(safe);
  if (id) {
    await resolveAttachment(host, id, "open");
    await host.resolver.open?.(id);
  } else if (safe.startsWith("mailto:") || host.policy.origins.includes(new URL(safe).origin))
    await host.openLink?.(safe);
}
export function FileCard({ id, caption }: { id: string; caption?: string }) {
  const host = useContentHost();
  const manifest = host?.attachments.get(id);
  const [error, setError] = useState(false);
  const action = async (kind: "open" | "download") => {
    try {
      if (!host) return;
      await resolveAttachment(host, id, kind);
      await host.resolver[kind]?.(id);
    } catch {
      setError(true);
      host?.onDiagnostic?.("MEDIA_ACTION_FAILED", id);
    }
  };
  return (
    <div className="ui-file-card" role="group" aria-label={manifest?.name ?? id}>
      <strong>{manifest?.name ?? "Unknown attachment"}</strong>
      {manifest && (
        <small>
          {manifest.mime}
          {manifest.size !== undefined ? ` · ${manifest.size.toLocaleString()} bytes` : ""}
        </small>
      )}
      {caption && <p>{caption}</p>}
      <div>
        {host?.resolver.open && manifest && (
          <button type="button" onClick={() => void action("open")}>
            Open
          </button>
        )}
        {host?.resolver.download && manifest && (
          <button type="button" onClick={() => void action("download")}>
            Download
          </button>
        )}
      </div>
      {(error || !manifest) && <p role="status">Attachment unavailable</p>}
    </div>
  );
}
export function AttachmentMedia({
  id,
  alt,
  caption,
  seek,
  muted = true,
  autoplay = false,
  file = false,
  regionIds = [],
}: {
  id: string;
  alt?: string;
  caption?: string;
  seek?: number;
  muted?: boolean;
  autoplay?: boolean;
  file?: boolean;
  regionIds?: string[];
}) {
  const host = useContentHost();
  const { value, error, failed } = useAttachment(id);
  const manifest = host?.attachments.get(id);
  const player = useRef<HTMLVideoElement | null>(null);
  const [captions, setCaptions] = useState<string>();
  useEffect(() => {
    const transcript = manifest?.transcript;
    if (!transcript) {
      setCaptions(undefined);
      return;
    }
    const rows = typeof transcript === "string" ? [{ t: 0, text: transcript }] : transcript;
    const stamp = (seconds: number) =>
      new Date(Math.max(0, seconds) * 1000).toISOString().slice(11, 23);
    const vtt =
      "WEBVTT\n\n" +
      rows
        .map(
          (r, i) =>
            `${stamp(r.t)} --> ${stamp(rows[i + 1]?.t ?? Math.max(r.t + 5, manifest?.duration ?? 0))}\n${r.text.replace(/-->/g, "→").replace(/\n{2,}/g, "\n")}\n`,
        )
        .join("\n");
    const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
    setCaptions(url);
    return () => URL.revokeObjectURL(url);
  }, [manifest]);
  useEffect(() => {
    if (player.current && Number.isFinite(seek)) player.current.currentTime = Math.max(0, seek!);
  }, [seek, value]);
  // autoplay is intentionally disabled until the host explicitly supplies a playback policy.
  void autoplay;
  if (file || manifest?.kind === "file" || error || !manifest)
    return <FileCard id={id} caption={caption} />;
  if (!value)
    return (
      <div className="ui-media-loading" role="status">
        Loading {manifest.name}…
      </div>
    );
  const label = alt || manifest.alt || manifest.name;
  const regions = manifest.regions?.filter((r) => regionIds.includes(r.id)) ?? [];
  return (
    <figure className="ui-media-item">
      {manifest.kind === "image" ? (
        <div className="ui-image-stage">
          <img
            src={value.url}
            alt={label}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={failed}
            width={manifest.width}
            height={manifest.height}
          />
          {regions.map((r) => (
            <span
              className="ui-image-region"
              key={r.id}
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.width * 100}%`,
                height: `${r.height * 100}%`,
              }}
              role="note"
              aria-label={r.label}
            >
              {r.label}
            </span>
          ))}
        </div>
      ) : manifest.kind === "video" ? (
        <>
          <video
            ref={player}
            src={value.url}
            controls
            muted={muted}
            preload="metadata"
            onError={failed}
            aria-label={label}
          >
            <track
              kind="captions"
              src={captions}
              label={captions ? "Host transcript" : "Captions not supplied"}
              srcLang="en"
            />
          </video>
          <details>
            <summary>Transcript</summary>
            <p>
              {typeof manifest.transcript === "string"
                ? manifest.transcript
                : (manifest.transcript?.map((t) => t.text).join("\n") ??
                  "Transcript not supplied by host.")}
            </p>
          </details>
        </>
      ) : (
        <>
          <audio src={value.url} controls preload="metadata" onError={failed} aria-label={label}>
            <track kind="captions" src={captions} label="Host transcript" />
          </audio>
          <p>
            {typeof manifest.transcript === "string"
              ? manifest.transcript
              : (manifest.transcript?.map((t) => t.text).join("\n") ??
                "Transcript not supplied by host.")}
          </p>
        </>
      )}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
export function MediaContent({
  ids,
  layout = "auto",
  caption,
  alt,
}: {
  ids: string[];
  layout?: string;
  caption?: string;
  alt?: string[];
}) {
  const host = useContentHost();
  const items = ids.flatMap((id) => (host?.attachments.get(id) ? [host.attachments.get(id)!] : []));
  const chosen = layout === "auto" ? mediaLayout(items) : layout;
  return (
    <section className={`ui-media ui-media-${chosen}`} aria-label={caption || "Attachments"}>
      {caption && <p className="ui-media-caption">{caption}</p>}
      <div className="ui-media-items">
        {ids.map((id, i) => (
          <AttachmentMedia key={id} id={id} alt={alt?.[i]} file={chosen === "files"} />
        ))}
      </div>
    </section>
  );
}
