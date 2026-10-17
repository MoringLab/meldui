// biome-ignore-all lint/suspicious/noArrayIndexKey: collection items may repeat an image; their order is fixed
// Diagrams, picture collections and market widgets, drawn natively. Pictures and market data
// come from the host (ImageSourceContext, MarketContext): the engine never fetches by itself.
import { resolveTypography } from "@engine/kit-spec";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  type TextStyle,
  View,
} from "react-native";
import Svg, { Defs, Line, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { useInk, withAlpha } from "./interactive.js";
import { type NativeViewProps, useGestureLock, useUI } from "./renderer.js";

/** This view's own width (measured), for layouts drawn in pixels. */
function useMeasured(): [number, (e: { nativeEvent: { layout: { width: number } } }) => void] {
  const [width, setWidth] = useState(0);
  return [
    width,
    (e) => {
      const w = Math.round(e.nativeEvent.layout.width);
      if (w && Math.abs(w - width) > 1) setWidth(w);
    },
  ];
}

// ── host services ───────────────────────────────────────────────────────────────────────────

export type ImageSource = { uri: string; headers?: Record<string, string> };
/** Turns an image reference (web URL, host id) into something to load, or null if not allowed. */
export const ImageSourceContext = createContext<((src: string) => ImageSource | null) | null>(null);

export type QuoteData = {
  symbol: string;
  name?: string;
  currency?: string;
  price: number;
  change?: number;
  changePercent?: number;
  time?: string;
  /** [epoch ms, price] */
  points: [number, number][];
  previousClose?: number;
  stats?: { label: string; value: string }[];
};
export type MarketHost = {
  quote?: (symbol: string, range: string) => Promise<QuoteData>;
  rate?: (from: string, to: string) => Promise<{ rate: number; time?: string }>;
};
export const MarketContext = createContext<MarketHost | null>(null);

export const VISUAL_LABELS = {
  previous: "Previous",
  next: "Next",
  close: "Close",
  loading: "Loading",
  unavailable: "Not available right now",
  tapNode: "Tap a box to see more",
  swap: "Swap",
  open: "Open",
};

function useLook() {
  const ui = useUI();
  const t = ui.kit.tokens[ui.mode];
  const ty = resolveTypography(ui.kit, Platform.OS === "ios" ? "ios" : "android");
  const family = ty.body.nativeFamily ? { fontFamily: ty.body.nativeFamily } : {};
  const heading = ty.heading.nativeFamily ? { fontFamily: ty.heading.nativeFamily } : {};
  const ink = useInk();
  const body: TextStyle = {
    color: ink ?? t.foreground,
    fontSize: ty.body.size,
    lineHeight: ty.body.lineHeight,
    ...family,
  };
  const labels = { ...VISUAL_LABELS, ...(ui.labels as Record<string, string> | undefined) };
  return {
    ...ui,
    t,
    body,
    family,
    heading,
    radius: ui.kit.tokens.radius,
    labels,
    dark: ui.mode === "dark",
  };
}

// ── images ──────────────────────────────────────────────────────────────────────────────────

export function HostImage({
  src,
  ratio,
  radius,
  alt,
  fit = "cover",
}: {
  src: string;
  ratio?: number;
  radius?: number;
  alt?: string;
  fit?: "cover" | "contain";
}) {
  const resolve = useContext(ImageSourceContext);
  const { t } = useLook();
  const source = useMemo(
    () => resolve?.(src) ?? (/^https:\/\//.test(src) ? { uri: src } : null),
    [resolve, src],
  );
  const [state, setState] = useState<"loading" | "ready" | "failed">(source ? "loading" : "failed");
  const [natural, setNatural] = useState<number | null>(null);
  const aspect = ratio ?? natural ?? 4 / 3;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={alt}
      style={{
        width: "100%",
        aspectRatio: aspect,
        borderRadius: radius ?? 12,
        overflow: "hidden",
        backgroundColor: t.surface,
      }}
    >
      {source && state !== "failed" ? (
        <Image
          source={source}
          resizeMode={fit}
          onLoad={(e) => {
            const s = e.nativeEvent.source;
            if (!ratio && s?.width && s?.height)
              setNatural(Math.max(0.5, Math.min(2.2, s.width / s.height)));
            setState("ready");
          }}
          onError={() => setState("failed")}
          style={{ width: "100%", height: "100%", opacity: state === "ready" ? 1 : 0 }}
        />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Svg width={28} height={28} viewBox="0 0 24 24">
            <Rect
              x={3}
              y={4}
              width={18}
              height={16}
              rx={3}
              stroke={t.muted}
              strokeWidth={1.6}
              fill="none"
            />
            <Path
              d="M7 16l3.5-4 3 3 2-2 2.5 3"
              stroke={t.muted}
              strokeWidth={1.6}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
      )}
    </View>
  );
}

function RoundArrow({
  side,
  onPress,
  label,
}: {
  side: "left" | "right";
  onPress: () => void;
  label: string;
}) {
  const { t } = useLook();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        position: "absolute",
        top: "50%",
        [side]: 10,
        marginTop: -20,
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: withAlpha(t.background, 0.92),
        opacity: pressed ? 0.75 : 1,
        shadowColor: "#000",
        shadowOpacity: 0.16,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 3,
      })}
    >
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path
          d={side === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}
          stroke={t.foreground}
          strokeWidth={2.2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Pressable>
  );
}

type CollectionItem = {
  image: string;
  title?: string;
  subtitle?: string;
  caption?: string;
  alt?: string;
  url?: string;
};

function Viewer({ item, onClose }: { item: CollectionItem | null; onClose: () => void }) {
  const { labels } = useLook();
  return (
    <Modal
      visible={!!item}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        accessibilityLabel={labels.close}
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.92)",
          justifyContent: "center",
          padding: 12,
        }}
      >
        {item ? (
          <HostImage
            src={item.image}
            alt={item.alt ?? item.title}
            fit="contain"
            ratio={0.75}
            radius={0}
          />
        ) : null}
        {item?.title ? (
          <Text style={{ color: "#fff", fontSize: 16, marginTop: 16, textAlign: "center" }}>
            {item.title}
          </Text>
        ) : null}
      </Pressable>
    </Modal>
  );
}

export function CollectionView({ node }: NativeViewProps) {
  const p = node.props as {
    title?: string;
    items: CollectionItem[];
    layout?: string;
    aspectRatio?: number;
  };
  const look = useLook();
  const { t, body, family, labels } = look;
  const [width, onLayout] = useMeasured();
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState<CollectionItem | null>(null);
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const lock = useGestureLock();
  const items = (Array.isArray(p.items) ? p.items : []).filter(
    (i) => i && typeof i.image === "string",
  );
  if (!items.length) return null;
  const open = (item: CollectionItem) => {
    if (item.url && /^https:\/\//.test(item.url)) void Linking.openURL(item.url);
    else setZoom(item);
  };
  const title = (item: CollectionItem, center = false) =>
    item.title || item.subtitle ? (
      <View style={{ marginTop: 8, gap: 2, alignItems: center ? "center" : "flex-start" }}>
        {item.title ? (
          <Text
            numberOfLines={2}
            style={{ ...body, fontSize: 15, lineHeight: 21, fontWeight: "600", ...look.heading }}
          >
            {item.title}
          </Text>
        ) : null}
        {item.subtitle ? (
          <Text numberOfLines={2} style={{ ...body, fontSize: 13, lineHeight: 18, color: t.muted }}>
            {item.subtitle}
          </Text>
        ) : null}
      </View>
    ) : null;
  const layout =
    p.layout === "auto" || !p.layout ? (items.length === 1 ? "hero" : "carousel") : p.layout;
  const head = p.title ? (
    <Text style={{ ...body, fontWeight: "700", fontSize: 17, ...look.heading, marginBottom: 10 }}>
      {p.title}
    </Text>
  ) : null;

  if (layout === "list")
    return (
      <View onLayout={onLayout} style={{ gap: 14 }}>
        {head}
        {items.map((item, i) => (
          <Pressable
            key={`${item.image}-${i}`}
            onPress={() => open(item)}
            style={{ flexDirection: "row", gap: 14, alignItems: "flex-start" }}
          >
            <View style={{ width: Math.min(132, (width || 320) * 0.38) }}>
              <HostImage
                src={item.image}
                alt={item.alt ?? item.title}
                ratio={p.aspectRatio ?? 4 / 3}
              />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              {item.title ? (
                <Text style={{ ...body, fontWeight: "700", ...look.heading }}>{item.title}</Text>
              ) : null}
              {item.subtitle ? (
                <Text style={{ ...body, fontSize: 13, color: t.muted }}>{item.subtitle}</Text>
              ) : null}
              {item.caption ? (
                <Text style={{ ...body, fontSize: 14, lineHeight: 21 }}>{item.caption}</Text>
              ) : null}
            </View>
          </Pressable>
        ))}
        <Viewer item={zoom} onClose={() => setZoom(null)} />
      </View>
    );

  if (layout === "grid")
    return (
      <View onLayout={onLayout}>
        {head}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {items.map((item, i) => (
            <Pressable
              key={`${item.image}-${i}`}
              onPress={() => open(item)}
              style={{ width: width ? (width - 10) / 2 : "48%" }}
            >
              <HostImage src={item.image} alt={item.alt ?? item.title} ratio={p.aspectRatio ?? 1} />
              {title(item)}
            </Pressable>
          ))}
        </View>
        <Viewer item={zoom} onClose={() => setZoom(null)} />
      </View>
    );

  if (layout === "strip" || layout === "hero") {
    const hero = layout === "hero" ? items[0] : null;
    const rest = hero ? items.slice(1) : items;
    const card = Math.max(120, Math.min(200, (width || 340) * 0.42));
    return (
      <View onLayout={onLayout} style={{ gap: 12 }}>
        {head}
        {hero ? (
          <Pressable onPress={() => open(hero)}>
            <HostImage
              src={hero.image}
              alt={hero.alt ?? hero.title}
              ratio={p.aspectRatio ?? 16 / 10}
              radius={16}
            />
            {title(hero)}
            {hero.caption ? (
              <Text style={{ ...body, marginTop: 4, color: t.muted, fontSize: 14 }}>
                {hero.caption}
              </Text>
            ) : null}
          </Pressable>
        ) : null}
        {rest.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            onTouchStart={() => lock(true)}
            onTouchEnd={() => lock(false)}
            onTouchCancel={() => lock(false)}
            contentContainerStyle={{ gap: 12, paddingRight: 4 }}
            style={{ marginRight: -4 }}
          >
            {rest.map((item, i) => (
              <Pressable
                key={`${item.image}-${i}`}
                onPress={() => open(item)}
                style={{ width: card }}
              >
                <HostImage
                  src={item.image}
                  alt={item.alt ?? item.title}
                  ratio={p.aspectRatio ?? 1}
                  radius={16}
                />
                {title(item)}
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <Viewer item={zoom} onClose={() => setZoom(null)} />
      </View>
    );
  }

  // carousel
  const w = width || 1;
  const go = (to: number) => {
    const next = Math.max(0, Math.min(items.length - 1, to));
    setPage(next);
    scroller.current?.scrollTo({ x: next * w, animated: true });
  };
  const current = items[page];
  return (
    <View onLayout={onLayout} style={{ gap: 10 }}>
      {head}
      <View>
        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          onTouchStart={() => lock(true)}
          onTouchEnd={() => lock(false)}
          onTouchCancel={() => lock(false)}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / w))}
          style={{ borderRadius: 16 }}
        >
          {items.map((item, i) => (
            <Pressable key={`${item.image}-${i}`} onPress={() => open(item)} style={{ width: w }}>
              <HostImage
                src={item.image}
                alt={item.alt ?? item.title}
                ratio={p.aspectRatio ?? 4 / 3}
                radius={16}
              />
            </Pressable>
          ))}
        </ScrollView>
        {items.length > 1 && page > 0 ? (
          <RoundArrow side="left" label={labels.previous} onPress={() => go(page - 1)} />
        ) : null}
        {items.length > 1 && page < items.length - 1 ? (
          <RoundArrow side="right" label={labels.next} onPress={() => go(page + 1)} />
        ) : null}
      </View>
      {current?.title || current?.caption ? (
        <View style={{ gap: 2 }}>
          {current.title ? (
            <Text style={{ ...body, fontWeight: "700", ...look.heading }}>{current.title}</Text>
          ) : null}
          {(current.caption ?? current.subtitle) ? (
            <Text style={{ ...body, fontSize: 14, color: t.muted }}>
              {current.caption ?? current.subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}
      {items.length > 1 ? (
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}>
          {items.map((item, i) => (
            <View
              key={`dot-${item.image}-${i}`}
              style={{
                width: i === page ? 16 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === page ? t.foreground : withAlpha(t.muted, 0.4),
                ...family,
              }}
            />
          ))}
        </View>
      ) : null}
      <Viewer item={zoom} onClose={() => setZoom(null)} />
    </View>
  );
}

// ── diagram ─────────────────────────────────────────────────────────────────────────────────

const PALETTE: Record<string, { light: string; dark: string }> = {
  blue: { light: "#2563EB", dark: "#60A5FA" },
  green: { light: "#16A34A", dark: "#4ADE80" },
  red: { light: "#DC2626", dark: "#F87171" },
  purple: { light: "#9333EA", dark: "#C084FC" },
  orange: { light: "#EA580C", dark: "#FB923C" },
  yellow: { light: "#CA8A04", dark: "#FACC15" },
  gray: { light: "#64748B", dark: "#94A3B8" },
};
const AUTO_TONES = ["blue", "red", "green", "purple", "orange", "yellow"];

type DNode = {
  id: string;
  label: string;
  sub?: string;
  detail?: string;
  tone?: string;
  emphasis?: boolean;
  x?: number;
  y?: number;
};
type DEdge = {
  from: string;
  to: string;
  label?: string;
  style?: string;
  arrow?: string;
  tone?: string;
  curve?: number;
};
type Placed = DNode & { cx: number; cy: number; w: number; h: number; color: string; rank: number };

const isWide = (ch: string) => /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch);
function textWidth(text: string, size: number) {
  let w = 0;
  for (const ch of text) w += isWide(ch) ? size : size * 0.58;
  return w;
}

/** Positions for every node: layered (tree) top-down or left-right, a circle, a row or manual. */
function layoutDiagram(
  nodes: DNode[],
  edges: DEdge[],
  width: number,
  layout: string,
  direction: string,
  colorOf: (n: DNode, i: number) => string,
): { placed: Placed[]; height: number } {
  const ids = new Set(nodes.map((n) => n.id));
  const live = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const size = (n: DNode) => {
    const w = Math.max(textWidth(n.label, 17), n.sub ? textWidth(n.sub, 13) : 0) + 36;
    return { w: Math.min(Math.max(w, 84), width * 0.46), h: n.sub ? 64 : 46 };
  };
  const base = nodes.map((n, i) => ({
    ...n,
    ...size(n),
    color: colorOf(n, i),
    cx: 0,
    cy: 0,
    rank: 0,
  }));
  const byId = new Map(base.map((n) => [n.id, n]));
  const manual =
    layout === "manual" ||
    (layout === "auto" && nodes.every((n) => typeof n.x === "number" && typeof n.y === "number"));
  if (manual) {
    const height = width * 0.75;
    for (const n of base) {
      n.cx = 12 + ((n.x ?? 50) / 100) * (width - 24);
      n.cy = 12 + ((n.y ?? 50) / 100) * (height - 24);
      n.cx = Math.max(n.w / 2 + 2, Math.min(width - n.w / 2 - 2, n.cx));
      n.cy = Math.max(n.h / 2 + 2, Math.min(height - n.h / 2 - 2, n.cy));
    }
    return { placed: base, height };
  }
  const incoming = new Map<string, number>();
  for (const e of live) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  const roots = base.filter((n) => !incoming.get(n.id));
  const cyclic = roots.length === 0;
  const kind =
    layout === "auto"
      ? cyclic && nodes.length <= 8 && nodes.length >= 3
        ? "circle"
        : nodes.length <= 4 && live.length === 0
          ? "row"
          : "tree"
      : layout;
  if (kind === "circle") {
    const r = Math.min(width * 0.32, 150);
    const cx = width / 2;
    const cy = r + 40;
    base.forEach((n, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / base.length;
      n.cx = cx + r * Math.cos(a) * 1.05;
      n.cy = cy + r * Math.sin(a) * 0.9;
      n.cx = Math.max(n.w / 2 + 2, Math.min(width - n.w / 2 - 2, n.cx));
    });
    const height = Math.max(...base.map((n) => n.cy + n.h / 2)) + 8;
    return { placed: base, height };
  }
  // Ranks: breadth-first from the roots (or the first node), every node once.
  const rank = new Map<string, number>();
  const queue = (roots.length ? roots : base.slice(0, 1)).map((n) => n.id);
  for (const id of queue) rank.set(id, 0);
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi] as string;
    for (const e of live)
      if (e.from === id && !rank.has(e.to)) {
        rank.set(e.to, (rank.get(id) ?? 0) + 1);
        queue.push(e.to);
      }
    if (qi === queue.length - 1)
      for (const n of base)
        if (!rank.has(n.id)) {
          rank.set(n.id, 0);
          queue.push(n.id);
          break;
        }
  }
  if (kind === "row") for (const n of base) rank.set(n.id, 0);
  const rows: Placed[][] = [];
  for (const n of base) {
    n.rank = rank.get(n.id) ?? 0;
    const row = rows[n.rank] ?? [];
    row.push(n);
    rows[n.rank] = row;
  }
  const across = direction === "right" ? 0 : 1;
  const gapMain = 64;
  if (across) {
    let y = 8;
    rows.forEach((row, ri) => {
      if (ri > 0) {
        // Children under the mean x of their parents.
        const parentX = (n: Placed) => {
          const xs = live
            .filter((e) => e.to === n.id)
            .map((e) => byId.get(e.from))
            .filter((p): p is Placed => !!p && p.rank < ri)
            .map((p) => p.cx);
          return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : width / 2;
        };
        row.sort((a, b) => parentX(a) - parentX(b));
      }
      const total = row.reduce((s, n) => s + n.w, 0);
      const gap = Math.max(10, Math.min(28, (width - total) / Math.max(1, row.length + 1)));
      const scale =
        total + gap * (row.length - 1) > width - 8
          ? (width - 8 - gap * (row.length - 1)) / total
          : 1;
      let x = (width - (total * scale + gap * (row.length - 1))) / 2;
      const h = Math.max(...row.map((n) => n.h));
      for (const n of row) {
        n.w *= scale;
        n.cx = x + n.w / 2;
        n.cy = y + h / 2;
        x += n.w + gap;
      }
      y += h + gapMain;
    });
    return { placed: base, height: y - gapMain + 8 };
  }
  // left → right
  const colW = (width - 8) / Math.max(1, rows.length);
  let height = 0;
  rows.forEach((row, ri) => {
    let y = 8;
    for (const n of row) {
      n.w = Math.min(n.w, colW - 16);
      n.cx = 4 + colW * ri + colW / 2;
      n.cy = y + n.h / 2;
      y += n.h + 20;
    }
    height = Math.max(height, y);
  });
  return { placed: base, height: height + 4 };
}

/** Where the line from a's centre towards (tx, ty) leaves a's box. */
function exitPoint(a: Placed, tx: number, ty: number) {
  const dx = tx - a.cx;
  const dy = ty - a.cy;
  if (!dx && !dy) return { x: a.cx, y: a.cy };
  const sx = a.w / 2 / Math.abs(dx || 1e-6);
  const sy = a.h / 2 / Math.abs(dy || 1e-6);
  const s = Math.min(sx, sy);
  return { x: a.cx + dx * s, y: a.cy + dy * s };
}

type Box = { x: number; y: number; w: number; h: number };
const hits = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** One edge's drawn shape: where it leaves and enters its boxes, and its bend's control point. */
function edgeGeometry(a: Placed, b: Placed, e: DEdge, placed: Placed[]) {
  const sameRow = Math.abs(a.cy - b.cy) < 4;
  const between = sameRow
    ? placed.filter((n) => Math.abs(n.cy - a.cy) < 4 && (n.cx - a.cx) * (n.cx - b.cx) < 0).length
    : 0;
  const bend = e.curve ?? (between ? -0.45 : 0);
  const len = Math.hypot(b.cx - a.cx, b.cy - a.cy) || 1;
  const nx = -(b.cy - a.cy) / len;
  const ny = (b.cx - a.cx) / len;
  const cx = (a.cx + b.cx) / 2 + nx * bend * len * 0.5;
  const cy = (a.cy + b.cy) / 2 + ny * bend * len * 0.5;
  return { bend, cx, cy, start: exitPoint(a, cx, cy), end: exitPoint(b, cx, cy) };
}

const LABEL_H = 22;
const LABEL_MAX = 132;

/**
 * Where each edge label goes: the first spot along its own line that covers no box and no
 * label placed before it. A label with no free spot is left out (its node's panel lists it).
 */
function placeLabels(edges: DEdge[], byId: Map<string, Placed>, placed: Placed[], width: number) {
  const boxes: Box[] = placed.map((n) => ({
    x: n.cx - n.w / 2 - 3,
    y: n.cy - n.h / 2 - 3,
    w: n.w + 6,
    h: n.h + 6,
  }));
  const taken: Box[] = [];
  return edges.map((e) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b || !e.label) return null;
    const g = edgeGeometry(a, b, e, placed);
    const w = Math.min(LABEL_MAX, textWidth(e.label, 13) + 14);
    for (const t of [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8]) {
      const u = 1 - t;
      const x = g.bend
        ? u * u * g.start.x + 2 * u * t * g.cx + t * t * g.end.x
        : u * g.start.x + t * g.end.x;
      const y = g.bend
        ? u * u * g.start.y + 2 * u * t * g.cy + t * t * g.end.y
        : u * g.start.y + t * g.end.y;
      const box = {
        x: Math.max(0, Math.min(width - w, x - w / 2)),
        y: y - LABEL_H / 2,
        w,
        h: LABEL_H,
      };
      if (boxes.some((n) => hits(n, box)) || taken.some((l) => hits(l, box))) continue;
      taken.push(box);
      return box;
    }
    return null;
  });
}

export function DiagramView({ node, runtime, surfaceId }: NativeViewProps) {
  const p = node.props as {
    title?: string;
    nodes: DNode[];
    edges?: DEdge[];
    layout?: string;
    direction?: string;
    value?: string;
    hint?: string;
  };
  const look = useLook();
  const { t, body, dark, labels } = look;
  const [width, onLayout] = useMeasured();
  const path = (node.raw?.value as { path?: string } | undefined)?.path;
  const [local, setLocal] = useState<string | undefined>(undefined);
  const selected = path ? (p.value as string | undefined) : local;
  const select = (id: string) => {
    const next = selected === id ? undefined : id;
    if (path) runtime.setValue(surfaceId, path, next ?? "", node.scope);
    else setLocal(next);
  };
  const nodes = (Array.isArray(p.nodes) ? p.nodes : []).filter((n) => n?.id && n.label);
  const edges = Array.isArray(p.edges) ? p.edges : [];
  const colorOf = (n: DNode, i: number) => {
    const tone = n.tone && n.tone !== "default" ? n.tone : AUTO_TONES[i % AUTO_TONES.length];
    if (tone === "accent") return t.accent;
    const c = PALETTE[tone as string] ?? { light: "#2563EB", dark: "#60A5FA" };
    return dark ? c.dark : c.light;
  };
  const key = `${width}|${JSON.stringify(nodes)}|${JSON.stringify(edges)}|${p.layout}|${p.direction}|${dark}|${t.accent}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` covers every input of the layout
  const { placed, height } = useMemo(
    () =>
      width
        ? layoutDiagram(nodes, edges, width, p.layout ?? "auto", p.direction ?? "down", colorOf)
        : { placed: [] as Placed[], height: 0 },
    [key],
  );
  const byId = new Map(placed.map((n) => [n.id, n]));
  // biome-ignore lint/correctness/useExhaustiveDependencies: `placed` changes with `key`
  const labelBoxes = useMemo(() => placeLabels(edges, byId, placed, width), [placed]);
  const chosen = selected ? byId.get(selected) : undefined;
  // A chosen node lights its own lines and dims the rest; its panel lists every relation.
  const touches = (e: DEdge) => !selected || e.from === selected || e.to === selected;
  const relations = chosen
    ? edges
        .filter((e) => e.label && (e.from === chosen.id || e.to === chosen.id))
        .map((e) => {
          const other = byId.get(e.from === chosen.id ? e.to : e.from);
          return other ? `${other.label} · ${e.label}` : null;
        })
        .filter((r): r is string => !!r)
    : [];
  const edgeColor = (e: DEdge) => {
    if (e.tone && e.tone !== "default") {
      if (e.tone === "accent") return t.accent;
      const c = PALETTE[e.tone];
      if (c) return dark ? c.dark : c.light;
    }
    return withAlpha(t.muted, 0.85);
  };
  return (
    <View onLayout={onLayout} style={{ gap: 12 }}>
      {p.title ? (
        <Text style={{ ...body, fontWeight: "700", fontSize: 17, ...look.heading }}>{p.title}</Text>
      ) : null}
      {width ? (
        <View style={{ width, height }}>
          <Svg width={width} height={height} style={{ position: "absolute" }}>
            {edges.map((e, i) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              const { bend, cx, cy, start, end } = edgeGeometry(a, b, e, placed);
              const color = touches(e) ? edgeColor(e) : withAlpha(t.muted, 0.22);
              const d = bend
                ? `M${start.x},${start.y} Q${cx},${cy} ${end.x},${end.y}`
                : `M${start.x},${start.y} L${end.x},${end.y}`;
              const arrowAt = (tip: { x: number; y: number }, from: { x: number; y: number }) => {
                const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
                const s = 9;
                return `M${tip.x},${tip.y} L${tip.x - s * Math.cos(ang - 0.45)},${tip.y - s * Math.sin(ang - 0.45)} L${tip.x - s * Math.cos(ang + 0.45)},${tip.y - s * Math.sin(ang + 0.45)} Z`;
              };
              const arrow = e.arrow ?? "end";
              const control = bend ? { x: cx, y: cy } : start;
              const controlEnd = bend ? { x: cx, y: cy } : end;
              return (
                <React.Fragment key={`e-${e.from}-${e.to}-${i}`}>
                  <Path
                    d={d}
                    stroke={color}
                    strokeWidth={2}
                    fill="none"
                    strokeDasharray={e.style === "dashed" ? "7 6" : undefined}
                    strokeLinecap="round"
                  />
                  {arrow === "end" || arrow === "both" ? (
                    <Path d={arrowAt(end, control)} fill={color} />
                  ) : null}
                  {arrow === "both" ? <Path d={arrowAt(start, controlEnd)} fill={color} /> : null}
                </React.Fragment>
              );
            })}
            {placed.map((n) => {
              const on = n.id === selected;
              return (
                <Rect
                  key={`n-${n.id}`}
                  x={n.cx - n.w / 2}
                  y={n.cy - n.h / 2}
                  width={n.w}
                  height={n.h}
                  rx={14}
                  fill={withAlpha(n.color, dark ? 0.2 : 0.1)}
                  stroke={withAlpha(n.color, on || n.emphasis ? 1 : 0.7)}
                  strokeWidth={on || n.emphasis ? 2.6 : 1.5}
                />
              );
            })}
          </Svg>
          {edges.map((e, i) => {
            const box = labelBoxes[i];
            if (!box || !e.label) return null;
            return (
              <View
                key={`l-${e.from}-${e.to}-${i}`}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: box.x,
                  top: box.y,
                  width: box.w,
                  height: box.h,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 6,
                  borderRadius: box.h / 2,
                  backgroundColor: t.background,
                  opacity: touches(e) ? 1 : 0.35,
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    ...body,
                    fontSize: 13,
                    lineHeight: 17,
                    color: e.tone && e.tone !== "default" ? edgeColor(e) : t.muted,
                  }}
                >
                  {e.label}
                </Text>
              </View>
            );
          })}
          {placed.map((n) => (
            <Pressable
              key={`p-${n.id}`}
              accessibilityRole="button"
              accessibilityLabel={n.sub ? `${n.label}, ${n.sub}` : n.label}
              accessibilityState={{ selected: n.id === selected }}
              onPress={() => select(n.id)}
              style={{
                position: "absolute",
                left: n.cx - n.w / 2,
                top: n.cy - n.h / 2,
                width: n.w,
                height: n.h,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 8,
              }}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{
                  ...body,
                  ...look.heading,
                  fontSize: 17,
                  lineHeight: 22,
                  fontWeight: "700",
                  color: n.color,
                }}
              >
                {n.label}
              </Text>
              {n.sub ? (
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={{ ...body, fontSize: 13, lineHeight: 17, color: withAlpha(n.color, 0.85) }}
                >
                  {n.sub}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={{ height: 160 }} />
      )}
      {chosen ? (
        <View
          style={{
            borderRadius: 16,
            padding: 14,
            backgroundColor: withAlpha(chosen.color, dark ? 0.18 : 0.08),
            gap: 4,
          }}
        >
          <Text style={{ ...body, fontWeight: "700", color: chosen.color, ...look.heading }}>
            {chosen.label}
            {chosen.sub ? ` · ${chosen.sub}` : ""}
          </Text>
          {chosen.detail ? <Text style={{ ...body, fontSize: 15 }}>{chosen.detail}</Text> : null}
          {relations.length ? (
            <Text style={{ ...body, fontSize: 14, color: t.muted }}>{relations.join("  ·  ")}</Text>
          ) : null}
        </View>
      ) : nodes.some((n) => n.detail) ? (
        <Text style={{ ...body, fontSize: 13, color: t.muted, textAlign: "center" }}>
          {p.hint || labels.tapNode}
        </Text>
      ) : p.hint ? (
        <Text style={{ ...body, fontSize: 13, color: t.muted, textAlign: "center" }}>{p.hint}</Text>
      ) : null}
    </View>
  );
}

// ── market ──────────────────────────────────────────────────────────────────────────────────

const RANGES = ["1d", "5d", "1m", "6m", "ytd", "1y", "5y", "max"];
function fmt(n: number | undefined, digits = 2) {
  if (n === undefined || !Number.isFinite(n)) return "–";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
const CURRENCY_SIGN: Record<string, string> = {
  USD: "US$",
  KRW: "₩",
  JPY: "¥",
  EUR: "€",
  GBP: "£",
  CNY: "CN¥",
  HKD: "HK$",
};
const FLAG: Record<string, string> = {
  USD: "🇺🇸",
  KRW: "🇰🇷",
  JPY: "🇯🇵",
  EUR: "🇪🇺",
  GBP: "🇬🇧",
  CNY: "🇨🇳",
  HKD: "🇭🇰",
  CAD: "🇨🇦",
  AUD: "🇦🇺",
  CHF: "🇨🇭",
  SGD: "🇸🇬",
  TWD: "🇹🇼",
  VND: "🇻🇳",
  THB: "🇹🇭",
};

function PriceChart({
  points,
  up,
  width,
  height,
  base,
}: {
  points: [number, number][];
  up: boolean;
  width: number;
  height: number;
  base?: number;
}) {
  const { t, body, dark } = useLook();
  const [touch, setTouch] = useState<number | null>(null);
  const lock = useGestureLock();
  if (points.length < 2 || !width) return <View style={{ height }} />;
  const values = points.map((p) => p[1]);
  let lo = Math.min(...values, base ?? Number.POSITIVE_INFINITY);
  let hi = Math.max(...values, base ?? Number.NEGATIVE_INFINITY);
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const right = 46;
  const plotW = width - right;
  const x = (i: number) => (i / (points.length - 1)) * plotW;
  const y = (v: number) => 6 + (1 - (v - lo) / (hi - lo)) * (height - 12);
  const color = up ? (dark ? "#4ADE80" : "#16A34A") : dark ? "#F87171" : "#E11D48";
  const line = points
    .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${plotW},${height} L0,${height} Z`;
  const ticks = [0, 1, 2, 3].map((k) => lo + pad + ((hi - lo - 2 * pad) * k) / 3);
  const at =
    touch === null
      ? null
      : Math.max(0, Math.min(points.length - 1, Math.round((touch / plotW) * (points.length - 1))));
  const pick = (e: { nativeEvent: { locationX: number } }) => setTouch(e.nativeEvent.locationX);
  return (
    <View
      style={{ width, height }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        lock(true);
        pick(e);
      }}
      onResponderMove={pick}
      onResponderRelease={() => {
        lock(false);
        setTouch(null);
      }}
      onResponderTerminate={() => {
        lock(false);
        setTouch(null);
      }}
    >
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="qfill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0.28} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {ticks.map((v) => (
          <Line
            key={`t-${v}`}
            x1={0}
            x2={plotW}
            y1={y(v)}
            y2={y(v)}
            stroke={withAlpha(t.muted, 0.25)}
            strokeDasharray="3 5"
          />
        ))}
        {base !== undefined ? (
          <Line
            x1={0}
            x2={plotW}
            y1={y(base)}
            y2={y(base)}
            stroke={withAlpha(t.muted, 0.5)}
            strokeDasharray="2 4"
          />
        ) : null}
        <Path d={area} fill="url(#qfill)" />
        <Path d={line} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" />
        {at !== null ? (
          <Line
            x1={x(at)}
            x2={x(at)}
            y1={0}
            y2={height}
            stroke={t.foreground}
            strokeWidth={1}
            opacity={0.5}
          />
        ) : null}
      </Svg>
      {ticks.map((v) => (
        <Text
          key={`y-${v}`}
          style={{
            ...body,
            position: "absolute",
            right: 0,
            top: y(v) - 8,
            fontSize: 11,
            lineHeight: 15,
            color: t.muted,
          }}
        >
          {fmt(v, v >= 1000 ? 0 : 2)}
        </Text>
      ))}
      {at !== null ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: Math.min(plotW - 120, Math.max(0, x(at) - 60)),
            top: 0,
            width: 120,
            paddingVertical: 4,
            borderRadius: 10,
            backgroundColor: withAlpha(t.foreground, 0.88),
            alignItems: "center",
          }}
        >
          <Text
            style={{
              ...body,
              fontSize: 13,
              lineHeight: 17,
              color: t.background,
              fontWeight: "700",
            }}
          >
            {fmt(points[at]?.[1])}
          </Text>
          <Text
            style={{ ...body, fontSize: 11, lineHeight: 14, color: withAlpha(t.background, 0.75) }}
          >
            {new Date(points[at]?.[0] ?? 0).toLocaleString()}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function QuoteView({ node }: NativeViewProps) {
  const p = node.props as { symbol: string; name?: string; range?: string; compact?: boolean };
  const market = useContext(MarketContext);
  const { t, body, labels, ...look } = useLook();
  const [width, onLayout] = useMeasured();
  const [range, setRange] = useState(p.range ?? "1d");
  const [data, setData] = useState<QuoteData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    if (!market?.quote) {
      setFailed(true);
      return;
    }
    market.quote(p.symbol, range).then(
      (d) => live && setData(d),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [market, p.symbol, range]);
  const up = (data?.change ?? 0) >= 0;
  const color = up ? (look.dark ? "#4ADE80" : "#16A34A") : look.dark ? "#F87171" : "#E11D48";
  const sign = CURRENCY_SIGN[data?.currency ?? ""] ?? (data?.currency ? `${data.currency} ` : "");
  return (
    <View
      onLayout={onLayout}
      style={{ borderRadius: 20, padding: 16, backgroundColor: t.surface, gap: 10 }}
    >
      <View style={{ gap: 2 }}>
        <Text style={{ ...body, fontSize: 14, color: t.muted }}>
          {data?.name ?? p.name ?? p.symbol} ({p.symbol.toUpperCase()})
        </Text>
        <Text style={{ ...body, ...look.heading, fontSize: 28, lineHeight: 34, fontWeight: "700" }}>
          {data ? `${sign}${fmt(data.price)}` : failed ? "–" : " "}
        </Text>
        {data ? (
          <Text style={{ ...body, fontSize: 15, color, fontWeight: "600" }}>
            {up ? "+" : ""}
            {fmt(data.change)} ({up ? "+" : ""}
            {fmt(data.changePercent)}%)
            {data.time ? (
              <Text style={{ color: t.muted, fontWeight: "400" }}>{`  ${data.time}`}</Text>
            ) : null}
          </Text>
        ) : (
          <Text style={{ ...body, fontSize: 14, color: t.muted }}>
            {failed ? labels.unavailable : labels.loading}
          </Text>
        )}
      </View>
      {!p.compact ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 4 }}
        >
          {RANGES.map((r) => (
            <Pressable
              key={r}
              accessibilityRole="button"
              accessibilityState={{ selected: r === range }}
              onPress={() => setRange(r)}
              style={{
                paddingHorizontal: 12,
                height: 32,
                borderRadius: 16,
                justifyContent: "center",
                backgroundColor: r === range ? t.background : "transparent",
              }}
            >
              <Text
                style={{
                  ...body,
                  fontSize: 13,
                  fontWeight: r === range ? "700" : "500",
                  color: r === range ? t.foreground : t.muted,
                }}
              >
                {r.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <PriceChart
        points={data?.points ?? []}
        up={up}
        width={width ? width - 32 : 0}
        height={p.compact ? 90 : 170}
        base={range === "1d" ? data?.previousClose : undefined}
      />
      {data?.stats?.length && !p.compact ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 8 }}>
          {data.stats.slice(0, 9).map((s) => (
            <View key={s.label} style={{ width: "33.3%", paddingRight: 8 }}>
              <Text style={{ ...body, fontSize: 12, lineHeight: 16, color: t.muted }}>
                {s.label}
              </Text>
              <Text style={{ ...body, fontSize: 14, lineHeight: 19, fontWeight: "600" }}>
                {s.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function ConverterView({ node }: NativeViewProps) {
  const p = node.props as { from: string; to: string; amount?: number; rate?: number };
  const market = useContext(MarketContext);
  const { t, body, labels, family } = useLook();
  const [pair, setPair] = useState([p.from.toUpperCase(), p.to.toUpperCase()] as [string, string]);
  const [amount, setAmount] = useState(String(p.amount ?? 100));
  const [rate, setRate] = useState<{ rate: number; time?: string } | null>(
    p.rate ? { rate: p.rate } : null,
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    if (p.rate && pair[0] === p.from.toUpperCase()) {
      setRate({ rate: p.rate });
      return;
    }
    if (!market?.rate) {
      setFailed(true);
      return;
    }
    setFailed(false);
    market.rate(pair[0], pair[1]).then(
      (r) => live && setRate(r),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [market, pair, p.rate, p.from]);
  const value = Number(amount.replace(/,/g, ""));
  const converted = rate && Number.isFinite(value) ? value * rate.rate : undefined;
  const digits = (code: string) => (code === "KRW" || code === "JPY" || code === "VND" ? 0 : 2);
  const row = (code: string, children: React.ReactNode) => (
    <View style={{ paddingVertical: 12, gap: 4 }}>
      <Text style={{ ...body, fontSize: 14, color: t.muted }}>
        {FLAG[code] ?? "💱"} {code}
      </Text>
      {children}
    </View>
  );
  return (
    <View
      style={{
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 4,
        backgroundColor: t.surface,
      }}
    >
      {row(
        pair[0],
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ ...body, fontSize: 22, color: t.muted }}>
            {CURRENCY_SIGN[pair[0]] ?? ""}{" "}
          </Text>
          <TextInput
            value={amount}
            onChangeText={(s) => setAmount(s.replace(/[^0-9.,]/g, ""))}
            keyboardType="decimal-pad"
            accessibilityLabel={pair[0]}
            style={{ flex: 1, padding: 0, fontSize: 24, color: t.foreground, ...family }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={labels.swap}
            onPress={() => setPair([pair[1], pair[0]])}
            hitSlop={10}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: t.background,
            }}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24">
              <Path
                d="M7 4v14m0 0l-3-3m3 3l3-3M17 20V6m0 0l-3 3m3-3l3 3"
                stroke={t.foreground}
                strokeWidth={2}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Pressable>
        </View>,
      )}
      <View style={{ height: 1, backgroundColor: withAlpha(t.border, 0.5) }} />
      {row(
        pair[1],
        <Text style={{ ...body, fontSize: 24, lineHeight: 30 }}>
          {CURRENCY_SIGN[pair[1]] ?? ""}{" "}
          {converted === undefined ? (failed ? "–" : "…") : fmt(converted, digits(pair[1]))}
        </Text>,
      )}
      {rate ? (
        <Text style={{ ...body, fontSize: 12, color: t.muted, paddingBottom: 10 }}>
          1 {pair[0]} = {fmt(rate.rate, rate.rate >= 100 ? 2 : 4)} {pair[1]}
          {rate.time ? ` · ${rate.time}` : ""}
        </Text>
      ) : failed ? (
        <Text style={{ ...body, fontSize: 12, color: t.muted, paddingBottom: 10 }}>
          {labels.unavailable}
        </Text>
      ) : null}
    </View>
  );
}

/** A host-resolved Image (`src`). */
export function SourceImageView({ node }: NativeViewProps) {
  const p = node.props as {
    src: string;
    alt?: string;
    caption?: string;
    aspectRatio?: number;
    fit?: "cover" | "contain";
  };
  const { t, body } = useLook();
  return (
    <View style={{ gap: 6 }}>
      <HostImage
        src={p.src}
        alt={p.alt}
        ratio={p.aspectRatio}
        fit={p.fit === "contain" ? "contain" : "cover"}
        radius={16}
      />
      {p.caption ? (
        <Text style={{ ...body, fontSize: 13, color: t.muted }}>{p.caption}</Text>
      ) : null}
    </View>
  );
}
