// biome-ignore-all lint/correctness/useExhaustiveDependencies: generation explicitly refreshes resolver URLs; identity changes reset retries
// biome-ignore-all lint/suspicious/noArrayIndexKey: duplicate attachment ids are distinguished by their media occurrence
import {
  attachmentIdFrom,
  type ContentHost,
  DEFAULT_MEDIA_LABELS,
  markdownDestination,
  mediaLayout,
  type ResolvedAttachment,
  resolveAttachment,
} from "@engine/core";
import { resolveTypography } from "@engine/kit-spec";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useVideoPlayer, VideoView } from "expo-video";
import React, {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Image,
  Modal,
  Text as NativeText,
  Platform,
  Pressable,
  ScrollView,
  type TextProps,
  type TextStyle,
  useWindowDimensions,
  View,
} from "react-native";
import { NativeIcon, useUI } from "./renderer.js";

function Text({ style, ...props }: TextProps) {
  const { kit, mode } = useUI();
  const body = resolveTypography(kit, Platform.OS === "ios" ? "ios" : "android").body;
  return (
    <NativeText
      {...props}
      style={[
        {
          color: kit.tokens[mode].foreground,
          fontFamily: body.nativeFamily,
          fontWeight: String(body.weight) as TextStyle["fontWeight"],
          fontSize: body.size,
          lineHeight: body.lineHeight,
        },
        style,
      ]}
    />
  );
}
export const NativeContentContext = createContext<ContentHost | undefined>(undefined);
export function ContentProvider({ host, children }: { host?: ContentHost; children: ReactNode }) {
  return <NativeContentContext.Provider value={host}>{children}</NativeContentContext.Provider>;
}
export const useContentHost = () => useContext(NativeContentContext);
const useLabels = () => ({ ...DEFAULT_MEDIA_LABELS, ...useContentHost()?.labels });
const iconButton = {
  minHeight: 48,
  minWidth: 48,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};
const buttonStyle = {
  minHeight: 48,
  minWidth: 48,
  padding: 12,
  borderWidth: 1,
  borderRadius: 8,
  borderColor: "#7b8490",
};
export async function openContentLink(host: ContentHost | undefined, url: string) {
  const safe = markdownDestination(url);
  if (!host || !safe) return;
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
  const labels = useLabels();
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
    <View
      style={{ padding: 16, gap: 8, borderWidth: 1, borderColor: "#7b8490", borderRadius: 12 }}
      accessible={false}
    >
      <Text>{manifest?.name ?? labels.unavailable}</Text>
      {manifest && (
        <Text>
          {manifest.mime}
          {manifest.size !== undefined ? ` · ${manifest.size} bytes` : ""}
        </Text>
      )}
      {caption && <Text>{caption}</Text>}
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {host?.resolver.open && manifest && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void action("open")}
            style={buttonStyle}
          >
            <Text>{labels.open}</Text>
          </Pressable>
        )}
        {host?.resolver.download && manifest && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void action("download")}
            style={buttonStyle}
          >
            <Text>{labels.download}</Text>
          </Pressable>
        )}
      </View>
      {error && manifest && <Text accessibilityRole="alert">{labels.unavailable}</Text>}
    </View>
  );
}
function Video({
  url,
  seek,
  muted,
  label,
  transcript,
  ratio = 16 / 9,
  radius = 0,
}: {
  transcript?: string | { t: number; text: string }[];
  url: string;
  seek?: number;
  muted: boolean;
  label: string;
  ratio?: number;
  radius?: number;
}) {
  const player = useVideoPlayer(url, (p) => {
    p.muted = muted;
    p.timeUpdateEventInterval = 0.5;
  });
  const [currentTime, setCurrentTime] = useState(0);
  useEffect(() => {
    const sub = player.addListener("timeUpdate", (event) => setCurrentTime(event.currentTime));
    return () => sub.remove();
  }, [player]);
  const line = Array.isArray(transcript)
    ? transcript.filter((row) => row.t <= currentTime).at(-1)?.text
    : undefined;
  useEffect(() => {
    if (seek !== undefined && Number.isFinite(seek)) player.currentTime = Math.max(0, seek);
  }, [seek, player]);
  return (
    <View>
      <VideoView
        player={player}
        nativeControls
        accessibilityLabel={label}
        style={{ width: "100%", aspectRatio: ratio, borderRadius: radius, overflow: "hidden" }}
      />
      {line && <Text accessibilityLiveRegion="polite">{line}</Text>}
      {Array.isArray(transcript) &&
        transcript.map((row) => (
          <Pressable
            key={row.t}
            accessibilityRole="button"
            style={buttonStyle}
            onPress={() => {
              player.currentTime = row.t;
            }}
          >
            <Text>
              {row.t}s · {row.text}
            </Text>
          </Pressable>
        ))}
    </View>
  );
}
function Audio({ url, label }: { url: string; label: string }) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  return (
    <View style={{ gap: 8 }}>
      <Text>
        {label} · {Math.round(status.currentTime)}s
      </Text>
      <Pressable
        accessibilityRole="button"
        style={buttonStyle}
        onPress={() => (status.playing ? player.pause() : player.play())}
      >
        <Text>{status.playing ? "Pause" : "Play"}</Text>
      </Pressable>
    </View>
  );
}
export function AttachmentMedia({
  id,
  alt,
  caption,
  file = false,
  seek,
  muted = true,
  regionIds = [],
  ratio: fixedRatio,
}: {
  /** Uniform frame ratio (grids); the picture is cropped to fill it. Default: its own ratio. */
  ratio?: number;
  id: string;
  alt?: string;
  caption?: string;
  file?: boolean;
  seek?: number;
  muted?: boolean;
  regionIds?: string[];
}) {
  const host = useContentHost();
  const [zoomed, setZoomed] = useState(false),
    [zoom, setZoom] = useState(1);
  const screen = useWindowDimensions();
  const [state, setState] = useState<{ id: string; value?: ResolvedAttachment; error?: boolean }>({
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
      setState({ id, error: true });
      return;
    }
    void resolveAttachment(host, id, "display", controller.signal)
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
          setState({ id, error: true });
          host.onDiagnostic?.("MEDIA_RESOLVE_FAILED", id);
        }
      });
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, host, generation]);
  const manifest = host?.attachments.get(id);
  const { kit, mode } = useUI();
  const t = kit.tokens[mode];
  const labels = useLabels();
  // The frame keeps the media's ratio from the first frame on: the manifest's size, then the
  // decoded image's own size, so nothing below it moves when the image arrives.
  const [natural, setNatural] = useState<number | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setNatural(undefined);
    setLoaded(false);
  }, [id]);
  if (file || !manifest || manifest.kind === "file") return <FileCard id={id} caption={caption} />;
  const declared = manifest.width && manifest.height ? manifest.width / manifest.height : undefined;
  const ratio = fixedRatio ?? Math.min(2.4, Math.max(0.56, declared ?? natural ?? 4 / 3));
  const label = alt || manifest.alt || manifest.name;
  const frame = {
    width: "100%" as const,
    aspectRatio: manifest.kind === "audio" ? undefined : ratio,
    borderRadius: kit.tokens.radius,
    overflow: "hidden" as const,
    backgroundColor: t.surface,
  };
  if (state.error)
    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${labels.unavailable}: ${label}`}
        style={[frame, { alignItems: "center", justifyContent: "center", padding: 16, gap: 6 }]}
      >
        <NativeIcon name="image-off" size={22} color={t.muted} />
        <Text numberOfLines={2} style={{ color: t.muted, fontSize: 13, textAlign: "center" }}>
          {labels.unavailable}
        </Text>
      </View>
    );
  if (state.id !== id || !state.value)
    return (
      <View
        accessible
        accessibilityLabel={`${labels.loading}: ${label}`}
        style={[frame, manifest.kind === "audio" && { height: 56 }]}
      />
    );
  const failed = () => {
    if (retries.current++ === 0) setGeneration((g) => g + 1);
    else {
      setState({ id, error: true });
      host?.onDiagnostic?.("MEDIA_LOAD_FAILED", id);
    }
  };
  return (
    <View style={{ gap: 8 }}>
      {manifest.kind === "image" ? (
        <View>
          <Pressable
            accessibilityRole="imagebutton"
            accessibilityLabel={label}
            accessibilityHint={labels.enlarge}
            onPress={() => {
              setZoom(1);
              setZoomed(true);
            }}
            style={frame}
          >
            <Image
              source={{ uri: state.value.url }}
              resizeMode="cover"
              style={{ width: "100%", height: "100%", opacity: loaded ? 1 : 0 }}
              onLoad={(e) => {
                const size = e.nativeEvent.source;
                if (!declared && size?.width && size?.height) setNatural(size.width / size.height);
                setLoaded(true);
              }}
              onError={failed}
            />
          </Pressable>
          {manifest.regions
            ?.filter((r) => regionIds.includes(r.id))
            .map((r) => (
              <Text key={r.id}>
                {r.label} ({r.x}, {r.y})
              </Text>
            ))}
          <Modal
            visible={zoomed}
            animationType="fade"
            statusBarTranslucent
            onRequestClose={() => setZoomed(false)}
          >
            <View style={{ flex: 1, backgroundColor: "#000" }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", padding: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={labels.close}
                  onPress={() => setZoomed(false)}
                  style={iconButton}
                >
                  <NativeIcon name="close" color="#fff" />
                </Pressable>
                {Platform.OS === "android" && (
                  <View style={{ flexDirection: "row", gap: 4 }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={labels.zoomOut}
                      style={[iconButton, { opacity: zoom <= 1 ? 0.4 : 1 }]}
                      disabled={zoom <= 1}
                      onPress={() => setZoom(Math.max(1, zoom - 1))}
                    >
                      <NativeText style={{ color: "#fff", fontSize: 22 }}>−</NativeText>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={labels.zoomIn}
                      style={[iconButton, { opacity: zoom >= 4 ? 0.4 : 1 }]}
                      disabled={zoom >= 4}
                      onPress={() => setZoom(Math.min(4, zoom + 1))}
                    >
                      <NativeIcon name="plus" color="#fff" />
                    </Pressable>
                  </View>
                )}
              </View>
              <ScrollView
                maximumZoomScale={4}
                minimumZoomScale={1}
                centerContent
                contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
              >
                <ScrollView
                  horizontal
                  contentContainerStyle={{ flexGrow: 1, alignItems: "center" }}
                >
                  <Image
                    source={{ uri: state.value.url }}
                    accessibilityLabel={label}
                    resizeMode="contain"
                    style={{ width: screen.width * zoom, height: (screen.width * zoom) / ratio }}
                  />
                </ScrollView>
              </ScrollView>
            </View>
          </Modal>
        </View>
      ) : manifest.kind === "video" ? (
        <>
          <Video
            url={state.value.url}
            seek={seek}
            muted={muted}
            label={label}
            ratio={ratio}
            radius={kit.tokens.radius}
            transcript={manifest.transcript}
          />
          {typeof manifest.transcript === "string" && <Text>{manifest.transcript}</Text>}
        </>
      ) : (
        <Audio url={state.value.url} label={label} />
      )}
      {caption && <Text style={{ color: t.muted, fontSize: 13 }}>{caption}</Text>}
    </View>
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
  const { kit, mode } = useUI();
  const t = kit.tokens[mode];
  const labels = useLabels();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const track = useRef<React.ElementRef<typeof ScrollView>>(null);
  const items = ids.flatMap((id) => (host?.attachments.get(id) ? [host.attachments.get(id)!] : []));
  const chosen = layout === "auto" ? mediaLayout(items) : layout;
  const carousel = chosen === "carousel";
  const go = (next: number) => {
    setPage(next);
    track.current?.scrollTo({ x: next * width, animated: true });
  };
  const columns =
    width >= 280 && ids.length > 1 && ["grid", "compare", "mosaic"].includes(chosen) ? 2 : 1;
  useEffect(() => {
    setPage((old) => Math.min(old, Math.max(0, ids.length - 1)));
  }, [ids.length]);
  useEffect(() => {
    if (carousel && width > 0) track.current?.scrollTo({ x: page * width, animated: false });
  }, [width, carousel]);
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ gap: 12 }}>
      {caption && <Text>{caption}</Text>}
      {carousel ? (
        <>
          <ScrollView
            ref={track}
            horizontal
            pagingEnabled
            directionalLockEnabled
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) =>
              setPage(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)))
            }
          >
            {ids.map((id, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: repeated attachment ids use an occurrence key
              <View key={`${id}-${i}`} style={{ width: Math.max(1, width) }}>
                <AttachmentMedia id={id} alt={alt?.[i]} />
              </View>
            ))}
          </ScrollView>
          <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center" }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={labels.previous}
              disabled={page === 0}
              style={[iconButton, { opacity: page === 0 ? 0.3 : 1 }]}
              onPress={() => go(page - 1)}
            >
              <NativeIcon name="chevron-left" color={t.foreground} />
            </Pressable>
            <View
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={`${page + 1} / ${ids.length}`}
              style={{ flexDirection: "row", gap: 6 }}
            >
              {ids.map((id, i) => (
                <View
                  key={`${id}-${i}`}
                  style={{
                    width: i === page ? 16 : 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: i === page ? t.foreground : t.border,
                  }}
                />
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={labels.next}
              disabled={page >= ids.length - 1}
              style={[iconButton, { opacity: page >= ids.length - 1 ? 0.3 : 1 }]}
              onPress={() => go(page + 1)}
            >
              <NativeIcon name="chevron-right" color={t.foreground} />
            </Pressable>
          </View>
        </>
      ) : (
        <View style={{ flexDirection: columns === 2 ? "row" : "column", flexWrap: "wrap", gap: 8 }}>
          {ids.map((id, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: repeated attachment ids use an occurrence key
            <View key={`${id}-${i}`} style={{ width: columns === 2 ? (width - 8) / 2 : undefined }}>
              <AttachmentMedia
                id={id}
                alt={alt?.[i]}
                file={chosen === "files"}
                ratio={columns === 2 ? 1 : undefined}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
