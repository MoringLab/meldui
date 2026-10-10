// biome-ignore-all lint/correctness/useExhaustiveDependencies: generation explicitly refreshes resolver URLs; identity changes reset retries
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
  Text as NativeText,
  Platform,
  Pressable,
  ScrollView,
  type TextProps,
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
}: {
  url: string;
  seek?: number;
  muted: boolean;
  label: string;
}) {
  const player = useVideoPlayer(url, (p) => {
    p.muted = muted;
  });
  useEffect(() => {
    if (seek !== undefined && Number.isFinite(seek)) player.currentTime = Math.max(0, seek);
  }, [seek, player]);
  return (
    <VideoView
      player={player}
      nativeControls
      accessibilityLabel={label}
      style={{ width: "100%", aspectRatio: 16 / 9 }}
    />
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
        </View>
      ) : manifest.kind === "video" ? (
        <>
          <Video url={state.value.url} seek={seek} muted={muted} label={label} />
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
  const items = ids.flatMap((id) => (host?.attachments.get(id) ? [host.attachments.get(id)!] : []));
  const chosen = layout === "auto" ? mediaLayout(items) : layout;
  const children = ids.map((id, i) => (
    <View key={id} style={chosen === "carousel" ? { width: 260 } : undefined}>
      <AttachmentMedia id={id} alt={alt?.[i]} file={chosen === "files"} />
    </View>
  ));
  return (
    <View style={{ gap: 16 }}>
      {caption && <Text>{caption}</Text>}
      {chosen === "carousel" ? (
        <ScrollView horizontal contentContainerStyle={{ gap: 16 }}>
          {children}
        </ScrollView>
      ) : (
        <View style={{ gap: 16 }}>{children}</View>
      )}
    </View>
  );
}
