// biome-ignore-all lint/correctness/useExhaustiveDependencies: generation explicitly refreshes resolver URLs; identity changes reset retries
// biome-ignore-all lint/suspicious/noArrayIndexKey: duplicate attachment ids are distinguished by their media occurrence
import {
  attachmentIdFrom,
  type ContentHost,
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
import { useUI } from "./renderer.js";

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
      <Text>{manifest?.name ?? "Unknown attachment"}</Text>
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
            <Text>Open</Text>
          </Pressable>
        )}
        {host?.resolver.download && manifest && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void action("download")}
            style={buttonStyle}
          >
            <Text>Download</Text>
          </Pressable>
        )}
      </View>
      {(error || !manifest) && <Text accessibilityRole="alert">Attachment unavailable</Text>}
    </View>
  );
}
function Video({
  url,
  seek,
  muted,
  label,
  transcript,
}: {
  transcript?: string | { t: number; text: string }[];
  url: string;
  seek?: number;
  muted: boolean;
  label: string;
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
        style={{ width: "100%", aspectRatio: 16 / 9 }}
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
}: {
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
  if (file || !manifest || state.error || manifest.kind === "file")
    return <FileCard id={id} caption={caption} />;
  if (state.id !== id || !state.value)
    return <Text accessibilityRole="text">Loading {manifest.name}…</Text>;
  const label = alt || manifest.alt || manifest.name;
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
          <Image
            source={{ uri: state.value.url }}
            accessibilityLabel={label}
            accessible
            resizeMode="contain"
            style={{ width: "100%", aspectRatio: (manifest.width ?? 4) / (manifest.height ?? 3) }}
            onError={failed}
          />
          {manifest.regions
            ?.filter((r) => regionIds.includes(r.id))
            .map((r) => (
              <Text key={r.id}>
                {r.label} ({r.x}, {r.y})
              </Text>
            ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Enlarge ${label}`}
            style={buttonStyle}
            onPress={() => {
              setZoom(1);
              setZoomed(true);
            }}
          >
            <Text>Enlarge image</Text>
          </Pressable>
          <Modal visible={zoomed} onRequestClose={() => setZoomed(false)}>
            <View style={{ flex: 1, backgroundColor: "#17212b" }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setZoomed(false)}
                style={buttonStyle}
              >
                <NativeText style={{ color: "#fff" }}>Close image</NativeText>
              </Pressable>
              {Platform.OS === "android" && (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Zoom out"
                    style={buttonStyle}
                    disabled={zoom <= 1}
                    onPress={() => setZoom(Math.max(1, zoom - 1))}
                  >
                    <NativeText style={{ color: "#fff" }}>−</NativeText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Zoom in"
                    style={buttonStyle}
                    disabled={zoom >= 4}
                    onPress={() => setZoom(Math.min(4, zoom + 1))}
                  >
                    <NativeText style={{ color: "#fff" }}>+</NativeText>
                  </Pressable>
                </View>
              )}
              <ScrollView
                maximumZoomScale={4}
                minimumZoomScale={1}
                contentContainerStyle={{ flexGrow: 1 }}
              >
                <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}>
                  <Image
                    source={{ uri: state.value.url }}
                    accessibilityLabel={label}
                    resizeMode="contain"
                    style={{ width: screen.width * zoom, height: 600 * zoom }}
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
            transcript={manifest.transcript}
          />
          <Text>
            {typeof manifest.transcript === "string"
              ? manifest.transcript
              : (manifest.transcript?.map((t) => t.text).join("\n") ??
                "Transcript not supplied by host.")}
          </Text>
        </>
      ) : (
        <Audio url={state.value.url} label={label} />
      )}
      {caption && <Text>{caption}</Text>}
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
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const track = useRef<React.ElementRef<typeof ScrollView>>(null);
  const items = ids.flatMap((id) => (host?.attachments.get(id) ? [host.attachments.get(id)!] : []));
  const chosen = layout === "auto" ? mediaLayout(items) : layout;
  const carousel = chosen === "carousel";
  const columns = width >= 480 && ["grid", "compare", "mosaic"].includes(chosen) ? 2 : 1;
  useEffect(() => {
    setPage((old) => Math.min(old, Math.max(0, ids.length - 1)));
  }, [ids.length]);
  useEffect(() => {
    if (carousel && width > 0) track.current?.scrollTo({ x: page * width, animated: false });
  }, [width, carousel]);
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ gap: 16 }}>
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
          <View
            style={{
              flexDirection: "row",
              justifyContent: "center",
              alignItems: "center",
              gap: 16,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous image"
              disabled={page === 0}
              style={buttonStyle}
              onPress={() => {
                setPage(page - 1);
                track.current?.scrollTo({ x: (page - 1) * width, animated: false });
              }}
            >
              <Text>Previous</Text>
            </Pressable>
            <Text accessibilityLiveRegion="polite">
              {page + 1} / {ids.length}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next image"
              disabled={page >= ids.length - 1}
              style={buttonStyle}
              onPress={() => {
                setPage(page + 1);
                track.current?.scrollTo({ x: (page + 1) * width, animated: false });
              }}
            >
              <Text>Next</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <View
          style={{ flexDirection: columns === 2 ? "row" : "column", flexWrap: "wrap", gap: 16 }}
        >
          {ids.map((id, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: repeated attachment ids use an occurrence key
            <View
              key={`${id}-${i}`}
              style={{ width: columns === 2 ? (width - 16) / 2 : undefined }}
            >
              <AttachmentMedia id={id} alt={alt?.[i]} file={chosen === "files"} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
