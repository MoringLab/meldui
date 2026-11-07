// Svg (markup drawn safely), Media (one picture or video by address), Calendar (a month with
// events and ranges) and Link (a row that opens a page). Addresses are opened by the host
// (LinkHandlerContext); only https pages open without one.

import { resolveTypography } from "@engine/kit-spec";
import { useVideoPlayer, VideoView } from "expo-video";
import { useContext, useMemo, useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import {
  CARD_TILE_MARGIN,
  DEFAULT_NATIVE_LABELS,
  heavier,
  InCard,
  useBackdrop,
  useInk,
  withAlpha,
} from "./interactive.js";
import { LinkHandlerContext } from "./markdown.js";
import { type CalendarEvent, type CalendarRange, dayKey, monthWeeks } from "./month.js";
import { NativeIcon, type NativeViewProps, useUI } from "./renderer.js";
import { colorOf } from "./style.js";
import { sanitizeSvg, svgAspect } from "./svg-markup.js";
import { HostImage, ImageSourceContext } from "./visuals.js";

function useLook() {
  const ui = useUI();
  const t = ui.kit.tokens[ui.mode];
  const ty = resolveTypography(ui.kit, Platform.OS === "ios" ? "ios" : "android");
  const ink = useInk();
  const body = {
    color: ink ?? t.foreground,
    fontSize: ty.body.size,
    lineHeight: ty.body.lineHeight,
    ...(ty.body.nativeFamily ? { fontFamily: ty.body.nativeFamily } : {}),
  };
  const labels = {
    ...DEFAULT_NATIVE_LABELS,
    ...(ui.labels as Partial<typeof DEFAULT_NATIVE_LABELS> | undefined),
  };
  return {
    ...ui,
    t,
    ty,
    body,
    ink,
    labels,
    dark: ui.mode === "dark",
    weight: (w: 500 | 600 | 700) => heavier(ty, w),
  };
}

/** Opens an address through the host; without a host handler only web pages open. */
function useOpen() {
  const handle = useContext(LinkHandlerContext);
  return (url: string) => {
    if (handle?.(url)) return;
    if (/^https:\/\//.test(url)) void Linking.openURL(url);
  };
}

// ── Svg ──────────────────────────────────────────────────────────────────────────────────────

export function SvgMarkupView({ node }: NativeViewProps) {
  const p = node.props as { markup?: string; alt?: string; size?: number };
  const { t, ink, body } = useLook();
  const clean = useMemo(() => sanitizeSvg(String(p.markup ?? "")), [p.markup]);
  if (!clean) return p.alt ? <Text style={{ ...body, color: t.muted }}>{p.alt}</Text> : null;
  const aspect = svgAspect(clean);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={p.alt}
      style={{
        width: p.size ?? "100%",
        aspectRatio: aspect,
        alignSelf: p.size ? "center" : "stretch",
      }}
    >
      <SvgXml xml={clean} width="100%" height="100%" color={ink ?? t.foreground} />
    </View>
  );
}

// ── Media ────────────────────────────────────────────────────────────────────────────────────

const VIDEO_FILE = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
const YOUTUBE =
  /^https:\/\/(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/;

export function MediaView({ node }: NativeViewProps) {
  const p = node.props as {
    src: string;
    kind?: "image" | "video";
    poster?: string;
    fit?: "corner" | "full";
    aspectRatio?: number;
    caption?: string;
    alt?: string;
  };
  const { t, body } = useLook();
  const inCard = useContext(InCard);
  const full = p.fit === "full";
  const youtube = YOUTUBE.exec(p.src);
  const video = p.kind === "video" || (!p.kind && (VIDEO_FILE.test(p.src) || !!youtube));
  const radius = full ? 0 : 16;
  return (
    <View style={{ gap: 6, ...(full && inCard ? { marginHorizontal: -14 } : {}) }}>
      {video ? (
        <VideoTile
          src={p.src}
          poster={
            p.poster ?? (youtube ? `https://i.ytimg.com/vi/${youtube[1]}/hqdefault.jpg` : undefined)
          }
          page={!!youtube || !VIDEO_FILE.test(p.src)}
          ratio={p.aspectRatio ?? 16 / 9}
          radius={radius}
          label={p.alt ?? p.caption ?? ""}
        />
      ) : (
        <HostImage src={p.src} alt={p.alt} ratio={p.aspectRatio} fit="cover" radius={radius} />
      )}
      {p.caption ? (
        <Text
          style={{
            ...body,
            fontSize: 13,
            lineHeight: 18,
            color: t.muted,
            ...(full && inCard ? { marginHorizontal: 14 } : {}),
          }}
        >
          {p.caption}
        </Text>
      ) : null}
    </View>
  );
}

/** A still with a play button: a video file plays here, a video page (YouTube) opens. */
function VideoTile({
  src,
  poster,
  page,
  ratio,
  radius,
  label,
}: {
  src: string;
  poster?: string;
  page: boolean;
  ratio: number;
  radius: number;
  label: string;
}) {
  const { t } = useLook();
  const open = useOpen();
  const resolve = useContext(ImageSourceContext);
  const [playing, setPlaying] = useState(false);
  const fileUrl = useMemo(() => {
    const r = resolve?.(src) as { uri?: string } | null | undefined;
    return r?.uri ?? (/^https:\/\//.test(src) ? src : null);
  }, [resolve, src]);
  if (playing && fileUrl)
    return <InlineVideo url={fileUrl} ratio={ratio} radius={radius} label={label} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label || "video"}
      onPress={() => (page ? open(src) : setPlaying(true))}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <View
        style={{
          width: "100%",
          aspectRatio: ratio,
          borderRadius: radius,
          overflow: "hidden",
          backgroundColor: withAlpha(t.foreground, 0.08),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {poster ? (
          <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
            <HostImage src={poster} ratio={ratio} radius={0} fit="cover" />
          </View>
        ) : null}
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: "rgba(0,0,0,0.45)",
            alignItems: "center",
            justifyContent: "center",
            paddingLeft: 3,
          }}
        >
          <NativeIcon name="play" size={22} color="#FFFFFF" />
        </View>
      </View>
    </Pressable>
  );
}

function InlineVideo({
  url,
  ratio,
  radius,
  label,
}: {
  url: string;
  ratio: number;
  radius: number;
  label: string;
}) {
  const player = useVideoPlayer(url, (pl) => {
    pl.play();
  });
  return (
    <VideoView
      player={player}
      nativeControls
      accessibilityLabel={label}
      style={{ width: "100%", aspectRatio: ratio, borderRadius: radius, overflow: "hidden" }}
    />
  );
}

// ── Calendar ─────────────────────────────────────────────────────────────────────────────────

export function CalendarView({ node, runtime, surfaceId }: NativeViewProps) {
  const p = node.props as {
    title?: string;
    month: string;
    events?: CalendarEvent[];
    ranges?: CalendarRange[];
    style?: "chips" | "dots";
    weekStart?: "sun" | "mon";
    value?: string;
    today?: string;
  };
  const { t, body, labels, dark, weight } = useLook();
  const path = (node.raw?.value as { path?: string } | undefined)?.path;
  const [local, setLocal] = useState<string>("");
  const selected = path ? String(p.value ?? "") : local || String(p.value ?? "");
  const select = (date: string) => {
    const next = date === selected ? "" : date;
    if (path) runtime.setValue(surfaceId, path, next, node.scope);
    else setLocal(next);
  };
  const today = p.today ?? dayKey(new Date(Date.now() - new Date().getTimezoneOffset() * 60_000));
  const weeks = useMemo(
    () => monthWeeks(p.month, p.events ?? [], p.ranges ?? [], p.weekStart ?? "sun"),
    [p.month, p.events, p.ranges, p.weekStart],
  );
  const dots = p.style === "dots";
  const [y, m] = p.month.split("-").map(Number);
  const names = labels.weekdays;
  const order = p.weekStart === "mon" ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  const colorFor = (c?: string) => colorOf(c, t, dark) ?? t.accent;
  const day = weeks.flat().find((d) => d.date === selected);
  const small = { ...body, fontSize: 11, lineHeight: 14 };
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ ...body, ...weight(600), fontSize: 15, lineHeight: 21 }}>
        {p.title ||
          labels.monthTitle
            .replace("{year}", String(y))
            .replace("{month}", labels.months[(m ?? 1) - 1] ?? String(m))}
      </Text>
      <View style={{ flexDirection: "row" }}>
        {order.map((i) => (
          <Text
            key={i}
            style={{ ...small, flex: 1, textAlign: "center", color: i === 0 ? t.danger : t.muted }}
          >
            {names[i]}
          </Text>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0]!.date} style={{ flexDirection: "row" }}>
          {week.map((d, i) => {
            const isToday = d.date === today;
            const isSelected = d.date === selected;
            const shown = dots ? [] : d.events.slice(0, 2);
            const more = d.events.length - shown.length;
            return (
              <Pressable
                key={d.date}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${d.date}${d.events.length ? `, ${d.events.map((e) => e.title).join(", ")}` : ""}`}
                onPress={() => select(d.date)}
                style={{
                  flex: 1,
                  minHeight: dots ? 40 : 58,
                  paddingVertical: 3,
                  gap: 2,
                  opacity: d.inMonth ? 1 : 0.35,
                }}
              >
                {d.ranges.slice(0, 1).map(({ range, first, last }) => (
                  <View
                    key={range.start + range.end}
                    style={{
                      position: "absolute",
                      top: 3,
                      height: 24,
                      left: first ? 4 : 0,
                      right: last ? 4 : 0,
                      backgroundColor: withAlpha(colorFor(range.color), 0.16),
                      borderTopLeftRadius: first ? 12 : 0,
                      borderBottomLeftRadius: first ? 12 : 0,
                      borderTopRightRadius: last ? 12 : 0,
                      borderBottomRightRadius: last ? 12 : 0,
                    }}
                  />
                ))}
                <View
                  style={{
                    alignSelf: "center",
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: isSelected
                      ? t.foreground
                      : isToday
                        ? withAlpha(t.accent, 0.16)
                        : "transparent",
                  }}
                >
                  <Text
                    style={{
                      ...small,
                      fontSize: 12,
                      ...(isSelected || isToday ? weight(700) : {}),
                      color: isSelected ? t.background : order[i] === 0 ? t.danger : t.foreground,
                    }}
                  >
                    {d.day}
                  </Text>
                </View>
                {dots ? (
                  <View
                    style={{ flexDirection: "row", justifyContent: "center", gap: 3, height: 6 }}
                  >
                    {d.events.slice(0, 3).map((e) => (
                      <View
                        key={`${e.date}${e.time ?? ""}${e.title}`}
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: 3,
                          backgroundColor: colorFor(e.color),
                        }}
                      />
                    ))}
                  </View>
                ) : (
                  <>
                    {shown.map((e) => (
                      <Text
                        key={`${e.date}${e.time ?? ""}${e.title}`}
                        numberOfLines={1}
                        style={{
                          ...small,
                          fontSize: 9,
                          lineHeight: 12,
                          marginHorizontal: 1,
                          paddingHorizontal: 2,
                          borderRadius: 3,
                          overflow: "hidden",
                          color: colorFor(e.color),
                          backgroundColor: withAlpha(colorFor(e.color), 0.14),
                        }}
                      >
                        {e.title}
                      </Text>
                    ))}
                    {more > 0 ? (
                      <Text
                        style={{
                          ...small,
                          fontSize: 9,
                          lineHeight: 11,
                          textAlign: "center",
                          color: t.muted,
                        }}
                      >
                        +{more}
                      </Text>
                    ) : null}
                  </>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
      {(p.ranges ?? []).some((r) => r.label) ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {(p.ranges ?? [])
            .filter((r) => r.label)
            .map((r) => (
              <View
                key={r.start + r.end}
                style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    backgroundColor: withAlpha(colorFor(r.color), 0.35),
                  }}
                />
                <Text style={{ ...small, color: t.muted }}>{r.label}</Text>
              </View>
            ))}
        </View>
      ) : null}
      {day ? (
        <View style={{ gap: 6, paddingTop: 4 }}>
          {day.events.length ? (
            day.events.map((e) => (
              <View
                key={`${e.date}${e.time ?? ""}${e.title}`}
                style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                <View
                  style={{
                    width: 3,
                    alignSelf: "stretch",
                    minHeight: 18,
                    borderRadius: 2,
                    backgroundColor: colorFor(e.color),
                  }}
                />
                {e.time ? (
                  <Text
                    style={{
                      ...body,
                      fontSize: 13,
                      lineHeight: 18,
                      color: t.muted,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {e.time}
                  </Text>
                ) : null}
                <Text style={{ ...body, fontSize: 14, lineHeight: 20, flex: 1 }} numberOfLines={2}>
                  {e.title}
                </Text>
              </View>
            ))
          ) : (
            <Text style={{ ...body, fontSize: 13, lineHeight: 18, color: t.muted }}>
              {labels.noEvents}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

// ── Link ─────────────────────────────────────────────────────────────────────────────────────

export function LinkView({ node }: NativeViewProps) {
  const p = node.props as { href: string; title?: string; subtitle?: string; icon?: string };
  const { t, body, weight } = useLook();
  const { fill } = useBackdrop();
  const inCard = useContext(InCard);
  const open = useOpen();
  const title = String(p.title ?? "");
  const subtitle = p.subtitle ? String(p.subtitle) : "";
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={[title, subtitle].filter(Boolean).join(", ")}
      onPress={() => open(p.href)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 52,
        paddingVertical: 9,
        paddingHorizontal: 12,
        borderRadius: 16,
        backgroundColor: fill,
        opacity: pressed ? 0.6 : 1,
        ...(inCard ? CARD_TILE_MARGIN : {}),
      })}
    >
      {p.icon ? (
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: withAlpha(t.foreground, 0.06),
          }}
        >
          <NativeIcon name={p.icon} size={19} color={t.foreground} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 1 }}>
        <Text numberOfLines={2} style={{ ...body, ...weight(500), fontSize: 15, lineHeight: 21 }}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={2} style={{ ...body, color: t.muted, fontSize: 13, lineHeight: 18 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <NativeIcon name="chevron-right" size={16} color={t.muted} />
    </Pressable>
  );
}
