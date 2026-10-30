// General-purpose native building blocks: a styled container (Box), one-at-a-time pages (Pager),
// two-faced cards (Flip), action menus (Menu), device frames for mockups (Device), multi-question
// quizzes graded in place (QuizSet), and the richer input variants (switch, segmented, chips,
// compact slider, ring progress). Everything is drawn from the kit's tokens, so each host keeps
// its own look; state lives in the surface's data model when bound, otherwise in the widget.
import { keyedRuns } from "@engine/core";
import type { UIKit } from "@engine/kit-spec";
import { resolveTypography } from "@engine/kit-spec";
import Slider from "@react-native-community/slider";
import React, {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import {
  animateTo,
  NativeIcon,
  type NativeViewProps,
  useContainerWidth,
  useGestureLock,
  useMotion,
  useUI,
} from "./renderer.js";

/** Korean widget words, for hosts that pass `labels={KO_NATIVE_LABELS}`. */
export const KO_NATIVE_LABELS = {
  previous: "이전",
  next: "다음",
  results: "결과 보기",
  retry: "다시 하기",
  correct: "정답이에요",
  incorrect: "아쉬워요",
  score: "점수",
  flip: "눌러서 뒤집기",
  menu: "더 보기",
  close: "닫기",
};

/** Words the widgets show; hosts pass their language through UIProvider `labels`. */
export const DEFAULT_NATIVE_LABELS = {
  previous: "Previous",
  next: "Next",
  results: "See results",
  retry: "Try again",
  correct: "Correct",
  incorrect: "Not quite",
  score: "Score",
  flip: "Tap to flip",
  menu: "More",
  close: "Close",
};
export type NativeLabels = typeof DEFAULT_NATIVE_LABELS;

type Colors = UIKit["tokens"]["light"] & { warning?: string };

/** The text colour descendants use on a coloured Box (null: the kit's foreground). */
const Ink = createContext<string | null>(null);
export const useInk = () => useContext(Ink);

/** Whether what is behind sits on a filled Box (true) or on the answer's own background. */
const Backdrop = createContext(false);

/** Marks its children as sitting on a filled ground (a host card, a chrome panel). */
export function FilledGround({ children }: { children: React.ReactNode }) {
  return <Backdrop.Provider value>{children}</Backdrop.Provider>;
}

/**
 * The fill for something that needs its own ground here (a field, a tile, a badge, a callout):
 * the kit's surface on the answer's background, and a lighter tile on a filled Box, so a card's
 * rows and inputs stand out from the card without borders.
 */
export function useBackdrop() {
  const { kit, mode } = useUI();
  const t = kit.tokens[mode];
  const filled = useContext(Backdrop);
  const tile = mode === "dark" ? withAlpha("#ffffff", 0.07) : t.background;
  return { filled, fill: filled ? tile : t.surface, tile };
}

/** rgba() of a #rgb / #rrggbb / rgb(a) colour at an alpha; other strings are returned as is. */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    const n = Number.parseInt(full, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const rgb = /^rgba?\(([^,]+),([^,]+),([^,)]+)/i.exec(color);
  return rgb ? `rgba(${rgb[1]?.trim()}, ${rgb[2]?.trim()}, ${rgb[3]?.trim()}, ${alpha})` : color;
}

const warningOf = (t: Colors) => t.warning ?? "#d97706";

function useBase() {
  const ui = useUI();
  const t = ui.kit.tokens[ui.mode] as Colors;
  const ty = resolveTypography(ui.kit, Platform.OS === "ios" ? "ios" : "android");
  const family = ty.body.nativeFamily ? { fontFamily: ty.body.nativeFamily } : {};
  const ink = useInk();
  const body: TextStyle = {
    color: ink ?? t.foreground,
    fontSize: ty.body.size,
    lineHeight: ty.body.lineHeight,
    ...family,
  };
  const space = (key: unknown, fallback = ui.kit.tokens.spacing.md) =>
    key === "none"
      ? 0
      : ((ui.kit.tokens.spacing as Record<string, number>)[String(key)] ?? fallback);
  const labels = { ...DEFAULT_NATIVE_LABELS, ...ui.labels };
  return { ...ui, t, ty, family, body, ink, space, radius: ui.kit.tokens.radius, labels };
}

function boundPath(node: NativeViewProps["node"], key = "value") {
  return (node.raw?.[key] as { path?: string } | undefined)?.path;
}

/** A value kept in the data model when the prop is bound, otherwise in the widget. */
function useBoundState<T>(
  { node, runtime, surfaceId }: NativeViewProps,
  initial: T,
  key = "value",
) {
  const path = boundPath(node, key);
  const [local, setLocal] = useState<T>(initial);
  const value = (path ? ((node.props[key] as T | undefined) ?? initial) : local) as T;
  const set = (next: T) => {
    if (path) runtime.setValue(surfaceId, path, next as unknown, node.scope);
    else setLocal(next);
  };
  return [value, set] as const;
}

// ---------------------------------------------------------------------------------------------
// Box

type ToneLook = { bg?: string; ink?: string; border?: string; lift?: boolean };
function toneLook(tone: unknown, t: Colors, ground: { filled: boolean; tile: string }): ToneLook {
  switch (tone) {
    // A subtle Box inside another filled Box is a lighter tile (a card's rows), not the same grey.
    case "subtle":
      return { bg: ground.filled ? ground.tile : t.surface };
    // Lifted by a soft shadow on the page; on a card it is a tile like subtle. No outline.
    case "raised":
      return ground.filled ? { bg: ground.tile } : { bg: t.background, lift: true };
    case "accent":
      return { bg: t.accent, ink: t.onAccent };
    case "accentSoft":
      return { bg: withAlpha(t.accent, 0.12) };
    case "inverse":
      return { bg: t.foreground, ink: t.background };
    case "success":
      return { bg: withAlpha(t.success, 0.12) };
    case "warning":
      return { bg: withAlpha(warningOf(t), 0.14) };
    case "danger":
      return { bg: withAlpha(t.danger, 0.12) };
    default:
      return {};
  }
}

const JUSTIFY = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
} as const;
const ALIGN = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
} as const;

/** Whether the parent lays its children in a row (a child's width then means flex basis). */
const InRow = createContext(false);

export function BoxView(props: NativeViewProps) {
  const { node, runtime, surfaceId, children } = props;
  const p = node.props as Record<string, any>;
  const { t, space, radius } = useBase();
  const inRow = useContext(InRow);
  // Row and Column with Box sizing (justify, flex, width, padding) are drawn as Boxes too.
  const row = p.direction === "row" || node.component === "Row";
  const ground = useBackdrop();
  const look = toneLook(p.tone, t, ground);
  const selected = Boolean(p.selected);
  const [height, setHeight] = useState(0);
  const corner =
    p.radius === "none"
      ? 0
      : p.radius === "sm"
        ? radius * 0.5
        : p.radius === "lg"
          ? radius * 1.6
          : p.radius === "full"
            ? // A measured half height: Android drops a "999" radius when a fill appears later.
              Math.max(8, height / 2)
            : look.bg || p.border || selected
              ? radius
              : 0;
  const size: Record<string, unknown> = {};
  if (typeof p.width === "number") {
    if (inRow) Object.assign(size, { flexBasis: `${p.width * 100}%`, flexGrow: 0, flexShrink: 1 });
    else Object.assign(size, { width: `${p.width * 100}%` });
  } else if (p.width === "fill")
    Object.assign(size, inRow ? { flex: 1 } : { alignSelf: "stretch" });
  else if (p.width === "hug")
    Object.assign(size, inRow ? { flexGrow: 0 } : { alignSelf: "flex-start" });
  if (typeof p.flex === "number") size.flex = p.flex;
  if (typeof p.height === "number") size.height = p.height;
  if (typeof p.aspectRatio === "number") size.aspectRatio = p.aspectRatio;
  const style: ViewStyle = {
    flexDirection: row ? "row" : "column",
    gap: space(p.gap, row ? space("sm") : space("md")),
    alignItems: p.align ? ALIGN[p.align as keyof typeof ALIGN] : row ? "center" : "stretch",
    justifyContent: p.justify ? JUSTIFY[p.justify as keyof typeof JUSTIFY] : "flex-start",
    flexWrap: p.wrap ? "wrap" : "nowrap",
    // Filled boxes hug their content: 12 around, not a page margin.
    padding: space(p.padding, look.bg || p.border ? space("sm") + space("xs") : 0),
    // Always a fill (transparent when none): a fill that appears later keeps its corners.
    backgroundColor: selected && !look.bg ? withAlpha(t.accent, 0.1) : (look.bg ?? "transparent"),
    borderRadius: corner,
    borderWidth: selected ? 1.5 : p.border || look.border ? 1 : 0,
    borderColor: selected ? t.accent : (look.border ?? t.border),
    overflow: corner ? "hidden" : undefined,
    ...(look.lift
      ? {
          shadowColor: "#000",
          shadowOpacity: 0.06,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        }
      : {}),
    ...(size as ViewStyle),
  };
  const content = <InRow.Provider value={row}>{children}</InRow.Provider>;
  const inner =
    p.scroll === "horizontal" ? (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: style.gap, paddingRight: 2 }}
        style={{ marginHorizontal: 0 }}
      >
        {content}
      </ScrollView>
    ) : (
      content
    );
  const onLayout =
    p.radius === "full"
      ? (e: { nativeEvent: { layout: { height: number } } }) =>
          setHeight(e.nativeEvent.layout.height)
      : undefined;
  const inked = look.ink ? <Ink.Provider value={look.ink}>{inner}</Ink.Provider> : inner;
  const body =
    look.bg && !ground.filled ? <Backdrop.Provider value>{inked}</Backdrop.Provider> : inked;
  if (!p.action)
    return (
      <View style={style} onLayout={onLayout} accessibilityLabel={p.accessibilityLabel}>
        {body}
      </View>
    );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={p.accessibilityLabel}
      accessibilityState={{ selected }}
      onLayout={onLayout}
      onPress={() => void runtime.dispatch(surfaceId, node.id, p.action, node.scope)}
      style={({ pressed }) => [style, pressed && { opacity: 0.86, transform: [{ scale: 0.985 }] }]}
    >
      {body}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------------------------
// Round buttons and dots, shared by Pager and QuizSet

function RoundButton({
  icon,
  label,
  onPress,
  disabled,
  size = 40,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  size?: number;
}) {
  const { t } = useBase();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: t.surface,
        borderWidth: 1,
        borderColor: withAlpha(t.border, 0.7),
        opacity: disabled ? 0.35 : pressed ? 0.7 : 1,
      })}
    >
      <NativeIcon name={icon} color={t.foreground} size={20} />
    </Pressable>
  );
}

function Dots({
  count,
  index,
  colorOf,
}: {
  count: number;
  index: number;
  colorOf?: (i: number) => string | undefined;
}) {
  const { t } = useBase();
  if (count > 12)
    return (
      <Text style={{ color: t.muted, fontVariant: ["tabular-nums"] }}>
        {index + 1} / {count}
      </Text>
    );
  return (
    <View
      accessible
      accessibilityLabel={`${index + 1} / ${count}`}
      style={{ flexDirection: "row", gap: 6, alignItems: "center" }}
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: dots are positional
          key={i}
          style={{
            width: i === index ? 18 : 6,
            height: 6,
            borderRadius: 3,
            backgroundColor:
              colorOf?.(i) ?? (i === index ? t.foreground : withAlpha(t.border, 0.9)),
          }}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Pager

export function PagerView(props: NativeViewProps) {
  const { node, children } = props;
  const p = node.props as Record<string, any>;
  const { labels, space } = useBase();
  const pages = React.Children.toArray(children);
  const count = pages.length;
  const [stored, setStored] = useBoundState<number>(props, 0);
  const index = Math.min(Math.max(0, Math.round(Number(stored) || 0)), Math.max(0, count - 1));
  const [width, setWidth] = useState(0);
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const lock = useGestureLock();
  useEffect(() => {
    if (width) scroller.current?.scrollTo({ x: index * width, animated: true });
  }, [index, width]);
  const go = (next: number) => {
    const target = p.loop ? (next + count) % count : Math.min(count - 1, Math.max(0, next));
    setStored(target);
  };
  const controls = p.controls ?? "both";
  return (
    <View style={{ gap: space("md") }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        directionalLockEnabled
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={() => lock(true)}
        onScrollEndDrag={() => lock(false)}
        onMomentumScrollEnd={(e) => {
          const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
          if (next !== index) setStored(next);
        }}
      >
        {pages.map((page, i) => (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: pages are positional
            key={i}
            style={{ width: Math.max(1, width) }}
            accessibilityElementsHidden={i !== index}
            importantForAccessibility={i === index ? "auto" : "no-hide-descendants"}
          >
            {page}
          </View>
        ))}
      </ScrollView>
      {controls !== "none" && count > 1 ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: controls === "dots" ? "center" : "space-between",
          }}
        >
          {controls !== "dots" ? (
            <RoundButton
              icon="chevron-left"
              label={labels.previous}
              onPress={() => go(index - 1)}
              disabled={!p.loop && index === 0}
            />
          ) : null}
          {controls !== "arrows" ? <Dots count={count} index={index} /> : null}
          {controls !== "dots" ? (
            <RoundButton
              icon="chevron-right"
              label={labels.next}
              onPress={() => go(index + 1)}
              disabled={!p.loop && index === count - 1}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Flip

export function FlipView(props: NativeViewProps) {
  const { node, renderChild } = props;
  const p = node.props as Record<string, any>;
  const { t, radius, space, labels, body } = useBase();
  const motion = useMotion();
  const [flipped, setFlipped] = useBoundState<boolean>(props, false);
  const turn = useRef(new Animated.Value(flipped ? 1 : 0)).current;
  const [heights, setHeights] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    animateTo(turn, flipped ? 1 : 0, motion, { useNativeDriver: true, minDurationMs: 260 });
  }, [flipped, motion, turn]);
  const height = p.height ?? Math.max(160, heights[0], heights[1]);
  const face = (side: 0 | 1): ViewStyle => ({
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    minHeight: height,
    borderRadius: radius * 1.6,
    padding: space("lg"),
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: side ? withAlpha(t.accent, 0.1) : t.surface,
    borderWidth: 1,
    borderColor: side ? withAlpha(t.accent, 0.3) : withAlpha(t.border, 0.6),
    backfaceVisibility: "hidden",
  });
  const measure = (side: 0 | 1) => (e: { nativeEvent: { layout: { height: number } } }) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    setHeights((prev) => (prev[side] === h ? prev : side ? [prev[0], h] : [h, prev[1]]));
  };
  const front = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] });
  const back = turn.interpolate({ inputRange: [0, 1], outputRange: ["180deg", "360deg"] });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={labels.flip}
      accessibilityState={{ expanded: flipped }}
      onPress={() => setFlipped(!flipped)}
      style={{ height }}
    >
      <Animated.View
        style={[face(0), { transform: [{ perspective: 1000 }, { rotateY: front }] }]}
        importantForAccessibility={flipped ? "no-hide-descendants" : "auto"}
        onLayout={measure(0)}
      >
        {renderChild(p.front)}
      </Animated.View>
      <Animated.View
        style={[face(1), { transform: [{ perspective: 1000 }, { rotateY: back }] }]}
        importantForAccessibility={flipped ? "auto" : "no-hide-descendants"}
        onLayout={measure(1)}
      >
        {renderChild(p.back)}
      </Animated.View>
      <View
        pointerEvents="none"
        style={{ position: "absolute", right: space("sm"), bottom: space("sm"), opacity: 0.55 }}
      >
        <Text style={{ ...body, fontSize: 12, color: t.muted }}>↻</Text>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------------------------
// Menu

export function MenuView({ node, runtime, surfaceId }: NativeViewProps) {
  const p = node.props as Record<string, any>;
  const { t, body, labels, radius, space, ink } = useBase();
  const anchor = useRef<React.ComponentRef<typeof View>>(null);
  const [open, setOpen] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const items = (p.items ?? []) as {
    label: unknown;
    icon?: string;
    action: unknown;
    tone?: string;
  }[];
  const show = () =>
    anchor.current?.measureInWindow((x: number, y: number, w: number, h: number) =>
      setOpen({ x, y, w, h }),
    );
  const label = p.label ? String(p.label) : "";
  const raw = (node.raw?.items as { action: unknown }[] | undefined) ?? [];
  return (
    <View ref={anchor} collapsable={false} style={{ alignSelf: label ? "flex-start" : "auto" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label || labels.menu}
        accessibilityState={{ expanded: Boolean(open) }}
        hitSlop={6}
        onPress={show}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          height: 40,
          minWidth: 40,
          paddingHorizontal: label ? 14 : 0,
          justifyContent: "center",
          borderRadius: 20,
          backgroundColor: pressed
            ? withAlpha(t.foreground, 0.08)
            : label
              ? t.surface
              : "transparent",
        })}
      >
        {p.icon || !label ? (
          <NativeIcon name={p.icon ?? "more"} color={ink ?? t.foreground} size={20} />
        ) : null}
        {label ? <Text style={{ ...body, fontWeight: "600" }}>{label}</Text> : null}
      </Pressable>
      <Modal
        transparent
        visible={Boolean(open)}
        animationType="fade"
        onRequestClose={() => setOpen(null)}
      >
        <Pressable
          accessibilityLabel={labels.close}
          style={{ flex: 1 }}
          onPress={() => setOpen(null)}
        >
          {open ? (
            <View
              style={{
                position: "absolute",
                top: open.y + open.h + 6,
                // Opens towards the screen's middle: right-aligned to a button on the right half.
                ...(open.x + open.w / 2 > 200
                  ? { right: Math.max(8, Platform.OS === "web" ? 8 : 12) }
                  : { left: Math.max(8, open.x) }),
                minWidth: 200,
                maxWidth: 280,
                paddingVertical: space("xs"),
                borderRadius: radius * 1.4,
                backgroundColor: t.background,
                borderWidth: 1,
                borderColor: withAlpha(t.border, 0.6),
                shadowColor: "#000",
                shadowOpacity: 0.16,
                shadowRadius: 20,
                shadowOffset: { width: 0, height: 8 },
                elevation: 8,
              }}
            >
              {items.map((item, i) => (
                <Pressable
                  // biome-ignore lint/suspicious/noArrayIndexKey: menu rows are positional
                  key={i}
                  accessibilityRole="menuitem"
                  onPress={() => {
                    setOpen(null);
                    void runtime.dispatch(
                      surfaceId,
                      node.id,
                      (raw[i]?.action ?? item.action) as never,
                      node.scope,
                    );
                  }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    minHeight: 48,
                    paddingHorizontal: 16,
                    backgroundColor: pressed ? withAlpha(t.foreground, 0.06) : "transparent",
                  })}
                >
                  {item.icon ? (
                    <NativeIcon
                      name={item.icon}
                      size={18}
                      color={item.tone === "danger" ? t.danger : t.muted}
                    />
                  ) : null}
                  <Text
                    style={{ ...body, color: item.tone === "danger" ? t.danger : t.foreground }}
                  >
                    {String(item.label)}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Device

export function DeviceView({ node, children }: NativeViewProps) {
  const p = node.props as Record<string, any>;
  const { t, space, body } = useBase();
  const container = useContainerWidth();
  const kind = p.kind ?? "phone";
  const dark = withAlpha(t.foreground, 0.92);
  if (kind === "browser")
    return (
      <View
        style={{
          borderRadius: 14,
          borderWidth: 1,
          borderColor: withAlpha(t.border, 0.8),
          overflow: "hidden",
          backgroundColor: t.background,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 12,
            height: 40,
            backgroundColor: t.surface,
          }}
        >
          <View style={{ flexDirection: "row", gap: 6 }}>
            {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
              <View
                key={c}
                style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c }}
              />
            ))}
          </View>
          <View
            style={{
              flex: 1,
              height: 26,
              borderRadius: 13,
              backgroundColor: t.background,
              justifyContent: "center",
              paddingHorizontal: 12,
            }}
          >
            <Text numberOfLines={1} style={{ ...body, fontSize: 12, color: t.muted }}>
              {String(p.title ?? "")}
            </Text>
          </View>
        </View>
        <View style={{ padding: space("md"), gap: space("md") }}>{children}</View>
      </View>
    );
  const phone = kind === "phone";
  const width = Math.min(container || 320, phone ? 300 : 520);
  return (
    <View
      accessibilityLabel={p.title ? String(p.title) : undefined}
      style={{
        alignSelf: "center",
        width,
        minHeight: phone ? width * 1.9 : width * 0.72,
        borderRadius: phone ? 44 : 28,
        borderWidth: phone ? 9 : 11,
        borderColor: dark,
        backgroundColor: t.background,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          height: 34,
          paddingHorizontal: 20,
        }}
      >
        <Text style={{ ...body, fontSize: 12, fontWeight: "600", color: t.foreground }}>9:41</Text>
        {phone ? (
          <View style={{ width: 76, height: 22, borderRadius: 11, backgroundColor: dark }} />
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2 }}>
          {[5, 7, 9, 11].map((h) => (
            <View
              key={h}
              style={{ width: 3, height: h, borderRadius: 1, backgroundColor: t.foreground }}
            />
          ))}
          <View
            style={{
              marginLeft: 4,
              width: 20,
              height: 10,
              borderRadius: 3,
              borderWidth: 1,
              borderColor: t.foreground,
              padding: 1,
            }}
          >
            <View
              style={{ flex: 1, width: "72%", borderRadius: 1, backgroundColor: t.foreground }}
            />
          </View>
        </View>
      </View>
      <View
        style={{
          flex: 1,
          paddingHorizontal: space("md"),
          paddingBottom: space("lg"),
          gap: space("md"),
        }}
      >
        {children}
      </View>
      {phone ? (
        <View
          style={{
            alignSelf: "center",
            width: 108,
            height: 4,
            borderRadius: 2,
            marginBottom: 8,
            backgroundColor: withAlpha(t.foreground, 0.85),
          }}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// QuizSet

type Question = {
  prompt: unknown;
  choices: unknown[];
  correctIndex: number;
  explanation?: unknown;
};

export function QuizSetView(props: NativeViewProps) {
  const p = props.node.props as Record<string, any>;
  const { t, body, ty, space, radius, labels } = useBase();
  const questions = (p.questions ?? []) as Question[];
  const total = questions.length;
  const [stored, setStored] = useBoundState<unknown[]>(props, []);
  const answers = Array.from({ length: total }, (_, i) =>
    Array.isArray(stored) && Number.isInteger(stored[i]) ? (stored[i] as number) : null,
  );
  const [index, setIndex] = useState(() => Math.max(0, answers.indexOf(null)));
  const [showResults, setShowResults] = useState(false);
  const score = answers.filter((a, i) => a !== null && a === questions[i]?.correctIndex).length;
  const answeredAll = answers.every((a) => a !== null);
  const choose = (choice: number) => {
    if (answers[index] !== null) return;
    const next = [...answers];
    next[index] = choice;
    setStored(next);
  };
  const header = (
    <View style={{ gap: space("sm") }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ ...body, fontWeight: "700" }} accessibilityRole="header">
          {p.title ? String(p.title) : ""}
        </Text>
        <Text style={{ ...body, color: t.muted, fontVariant: ["tabular-nums"] }}>
          {showResults ? `${labels.score} ${score}/${total}` : `${index + 1} / ${total}`}
        </Text>
      </View>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: withAlpha(t.border, 0.6) }}>
        <View
          style={{
            height: 4,
            borderRadius: 2,
            width: `${((showResults ? total : answers.filter((a) => a !== null).length) / Math.max(1, total)) * 100}%`,
            backgroundColor: t.accent,
          }}
        />
      </View>
    </View>
  );
  if (showResults)
    return (
      <View style={{ gap: space("lg") }}>
        {header}
        <View style={{ alignItems: "center", gap: space("sm"), paddingVertical: space("md") }}>
          <Text
            accessibilityLiveRegion="polite"
            style={{
              ...body,
              fontSize: ty.body.size * 2.6,
              lineHeight: ty.body.size * 3,
              fontWeight: "800",
            }}
          >
            {score}
            <Text style={{ color: t.muted, fontWeight: "600" }}> / {total}</Text>
          </Text>
          <Dots
            count={total}
            index={-1}
            colorOf={(i) => (answers[i] === questions[i]?.correctIndex ? t.success : t.danger)}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setStored([]);
            setIndex(0);
            setShowResults(false);
          }}
          style={({ pressed }) => ({
            alignSelf: "center",
            height: 44,
            paddingHorizontal: 20,
            borderRadius: 22,
            justifyContent: "center",
            backgroundColor: t.surface,
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <Text style={{ ...body, fontWeight: "600" }}>{labels.retry}</Text>
        </Pressable>
      </View>
    );
  const question = questions[index];
  if (!question) return null;
  const answer = answers[index];
  const answered = answer !== null;
  const right = answered && answer === question.correctIndex;
  return (
    <View style={{ gap: space("lg") }}>
      {header}
      <Text
        style={{
          ...body,
          fontSize: ty.body.size * 1.13,
          lineHeight: ty.body.size * 1.6,
          fontWeight: "700",
        }}
      >
        {String(question.prompt)}
      </Text>
      <View style={{ gap: space("sm") }}>
        {question.choices.map((choice, i) => {
          const isRight = answered && i === question.correctIndex;
          const isWrong = answered && i === answer && !isRight;
          const tint = isRight ? t.success : isWrong ? t.danger : null;
          return (
            <Pressable
              // biome-ignore lint/suspicious/noArrayIndexKey: choices are positional
              key={i}
              accessibilityRole="radio"
              accessibilityState={{ checked: answer === i, disabled: answered }}
              disabled={answered}
              onPress={() => choose(i)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                minHeight: 52,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderRadius: radius,
                backgroundColor: tint ? withAlpha(tint, 0.12) : t.surface,
                borderWidth: 1.5,
                borderColor: tint ?? "transparent",
                opacity: answered && !tint ? 0.55 : pressed ? 0.8 : 1,
              })}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: tint ?? t.background,
                }}
              >
                {tint ? (
                  <NativeIcon name={isRight ? "check" : "close"} color={t.onAccent} size={16} />
                ) : (
                  <Text style={{ ...body, fontSize: 13, fontWeight: "700", color: t.muted }}>
                    {String.fromCharCode(65 + i)}
                  </Text>
                )}
              </View>
              <Text style={{ ...body, flex: 1 }}>{String(choice)}</Text>
            </Pressable>
          );
        })}
      </View>
      {answered ? (
        <View accessibilityLiveRegion="polite" style={{ gap: 4 }}>
          <Text style={{ ...body, fontWeight: "700", color: right ? t.success : t.danger }}>
            {right ? labels.correct : labels.incorrect}
          </Text>
          {question.explanation ? (
            <Text style={{ ...body, color: t.muted }}>{String(question.explanation)}</Text>
          ) : null}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <RoundButton
          icon="chevron-left"
          label={labels.previous}
          onPress={() => setIndex(index - 1)}
          disabled={index === 0}
        />
        {index === total - 1 && answeredAll ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowResults(true)}
            style={({ pressed }) => ({
              height: 44,
              paddingHorizontal: 20,
              borderRadius: 22,
              justifyContent: "center",
              backgroundColor: t.accent,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ ...body, color: t.onAccent, fontWeight: "700" }}>{labels.results}</Text>
          </Pressable>
        ) : (
          <RoundButton
            icon="chevron-right"
            label={labels.next}
            onPress={() => setIndex(index + 1)}
            disabled={index === total - 1}
          />
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Input variants

export function SwitchRow({ node, runtime, surfaceId }: NativeViewProps) {
  const p = node.props as Record<string, any>;
  const { t, body } = useBase();
  const motion = useMotion();
  const path = boundPath(node);
  const on = Boolean(p.value);
  const knob = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    animateTo(knob, on ? 1 : 0, motion, { useNativeDriver: true });
  }, [on, motion, knob]);
  const disabled = Boolean(p.disabled) || !path;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={String(p.label ?? "")}
      accessibilityState={{ checked: on, disabled }}
      disabled={disabled}
      onPress={() => path && runtime.setValue(surfaceId, path, !on, node.scope)}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 }}
    >
      <Text style={{ ...body, flex: 1 }}>{String(p.label ?? "")}</Text>
      <View
        style={{
          width: 50,
          height: 30,
          borderRadius: 15,
          padding: 3,
          backgroundColor: on ? t.accent : withAlpha(t.foreground, 0.16),
        }}
      >
        <Animated.View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: "#fff",
            shadowColor: "#000",
            shadowOpacity: 0.18,
            shadowRadius: 3,
            shadowOffset: { width: 0, height: 1 },
            elevation: 2,
            transform: [
              { translateX: knob.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) },
            ],
          }}
        />
      </View>
    </Pressable>
  );
}

export function ChoiceRow({ node, runtime, surfaceId }: NativeViewProps) {
  const p = node.props as Record<string, any>;
  const { t, body, ty, space } = useBase();
  const path = boundPath(node);
  const options = (p.options ?? []) as { label: string; value: string }[];
  const write = (value: string) => path && runtime.setValue(surfaceId, path, value, node.scope);
  const segmented = p.variant === "segmented";
  const items = options.map((o) => {
    const on = o.value === p.value;
    return (
      <Pressable
        key={o.value}
        accessibilityRole={segmented ? "tab" : "radio"}
        accessibilityState={{ selected: on, checked: on }}
        onPress={() => write(o.value)}
        style={({ pressed }) => ({
          ...(segmented ? { flex: 1 } : {}),
          minHeight: segmented ? 36 : 38,
          paddingHorizontal: 14,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: segmented ? 10 : 19,
          backgroundColor: on
            ? segmented
              ? t.background
              : t.foreground
            : segmented
              ? "transparent"
              : t.surface,
          opacity: pressed ? 0.8 : 1,
          ...(on && segmented
            ? {
                shadowColor: "#000",
                shadowOpacity: 0.1,
                shadowRadius: 4,
                shadowOffset: { width: 0, height: 1 },
                elevation: 1,
              }
            : {}),
        })}
      >
        <Text
          numberOfLines={1}
          style={{
            ...body,
            fontSize: ty.small.size,
            fontWeight: on ? "700" : "500",
            color: on ? (segmented ? t.foreground : t.background) : t.foreground,
          }}
        >
          {o.label}
        </Text>
      </Pressable>
    );
  });
  return (
    <View style={{ gap: space("sm") }}>
      {p.label ? (
        <Text style={{ ...body, fontSize: ty.small.size, color: t.muted }}>{String(p.label)}</Text>
      ) : null}
      {segmented ? (
        <View
          style={{
            flexDirection: "row",
            padding: 3,
            gap: 3,
            borderRadius: 12,
            backgroundColor: t.surface,
          }}
        >
          {items}
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{items}</View>
      )}
    </View>
  );
}

/** A slider with its label and value on one line above the track: compact enough for two side by side. */
export function SliderRow({ node, runtime, surfaceId }: NativeViewProps) {
  const p = node.props as Record<string, any>;
  const { t, body, ty } = useBase();
  const lock = useGestureLock();
  const path = boundPath(node);
  const value = Number(p.value) || 0;
  const step = Number(p.step) || 1;
  const decimals = Math.min(4, (String(step).split(".")[1] ?? "").length);
  return (
    <View style={{ gap: 2, minWidth: 140, flexGrow: 1, flexBasis: 140 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text
          numberOfLines={1}
          style={{ ...body, flex: 1, fontSize: ty.small.size, color: t.muted }}
        >
          {String(p.label ?? "")}
        </Text>
        <Text
          testID={`value-${node.id}`}
          style={{ ...body, fontWeight: "700", fontVariant: ["tabular-nums"] }}
        >
          {value.toFixed(decimals)}
          {p.unit ? (
            <Text style={{ fontWeight: "500", color: t.muted }}> {String(p.unit)}</Text>
          ) : null}
        </Text>
      </View>
      <Slider
        accessibilityLabel={String(p.label ?? "")}
        testID={`input-${node.id}`}
        disabled={Boolean(p.disabled) || !path}
        value={value}
        minimumValue={p.min}
        maximumValue={p.max}
        step={step}
        onValueChange={(v) => path && runtime.setValue(surfaceId, path, v, node.scope)}
        onSlidingStart={() => lock(true)}
        onSlidingComplete={() => lock(false)}
        minimumTrackTintColor={t.accent}
        maximumTrackTintColor={withAlpha(t.border, 0.9)}
        thumbTintColor={t.accent}
        style={{ height: 36, width: "100%", marginHorizontal: Platform.OS === "android" ? -10 : 0 }}
      />
    </View>
  );
}

export function ProgressRing({ node }: NativeViewProps) {
  const p = node.props as Record<string, any>;
  const { t, body, ty } = useBase();
  const max = Number(p.max) || 100;
  const ratio = Math.min(1, Math.max(0, (Number(p.value) || 0) / max));
  const size = 96;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={String(p.label ?? "")}
      accessibilityValue={{ min: 0, max, now: Number(p.value) || 0 }}
      style={{ alignItems: "center", gap: 6 }}
    >
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Svg width={size} height={size} style={{ position: "absolute" }}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={withAlpha(t.border, 0.7)}
            strokeWidth={stroke}
            fill="none"
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={t.accent}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${c * ratio} ${c}`}
            rotation={-90}
            originX={size / 2}
            originY={size / 2}
          />
        </Svg>
        <Text style={{ ...body, fontWeight: "800", fontVariant: ["tabular-nums"] }}>
          {Math.round(ratio * 100)}%
        </Text>
      </View>
      {p.label ? (
        <Text style={{ ...body, fontSize: ty.small.size, color: t.muted }}>{String(p.label)}</Text>
      ) : null}
    </View>
  );
}

/** Text sizes relative to the body size. */
export const TEXT_SCALE = { sm: 0.87, md: 1, lg: 1.2, xl: 1.47, display: 2.1 } as const;

/** Text with size / weight / alignment / tone, in the colour of the Box it sits on. */
export function SizedText({ node }: NativeViewProps): ReactNode {
  const p = node.props as Record<string, any>;
  const { t, body, ink } = useBase();
  const { selectable } = useUI();
  const scale = TEXT_SCALE[(p.size as keyof typeof TEXT_SCALE) ?? "md"] ?? 1;
  const size = (body.fontSize as number) * scale;
  const tone =
    p.tone === "muted"
      ? ink
        ? withAlpha(ink, 0.7)
        : t.muted
      : p.tone === "accent"
        ? t.accent
        : p.tone === "success"
          ? t.success
          : p.tone === "danger"
            ? t.danger
            : (ink ?? t.foreground);
  return (
    <Text
      selectable={selectable}
      style={{
        ...body,
        flexShrink: 1,
        color: tone,
        ...(p.highlight
          ? {
              backgroundColor: withAlpha(t.accent, 0.2),
              alignSelf: "flex-start",
              paddingHorizontal: 2,
              borderRadius: 4,
            }
          : {}),
        fontSize: size,
        lineHeight: size * (scale >= 1.4 ? 1.25 : 1.5),
        fontWeight:
          p.weight === "bold"
            ? "700"
            : p.weight === "medium"
              ? "600"
              : scale >= 1.4
                ? "700"
                : "400",
        textAlign: p.align === "center" ? "center" : p.align === "end" ? "right" : "left",
        ...(p.size === "display" ? { fontVariant: ["tabular-nums"], letterSpacing: -0.5 } : {}),
      }}
    >
      {keyedRuns(String(p.text ?? "")).map((run) =>
        run.bold || run.mark ? (
          <Text
            key={run.at}
            style={{
              ...(run.bold ? { fontWeight: "700" as const } : {}),
              ...(run.mark ? { backgroundColor: withAlpha(t.accent, 0.2) } : {}),
            }}
          >
            {run.text}
          </Text>
        ) : (
          run.text
        ),
      )}
    </Text>
  );
}

/** Buttons with an icon, icon-only, small, full width; on a coloured Box they take its ink. */
export function ActionButton({ node, runtime, surfaceId }: NativeViewProps) {
  const p = node.props as Record<string, any>;
  const { t, body, ink } = useBase();
  const label = String(p.label ?? "");
  const variant = p.variant ?? "primary";
  const small = p.size === "sm";
  const primary = variant === "primary";
  const fg = primary ? t.onAccent : variant === "quiet" ? (ink ?? t.accent) : (ink ?? t.foreground);
  const bg = primary
    ? t.accent
    : variant === "secondary"
      ? ink
        ? withAlpha(ink, 0.16)
        : t.surface
      : "transparent";
  const height = p.iconOnly ? (small ? 36 : 44) : small ? 36 : 48;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(p.disabled) }}
      disabled={Boolean(p.disabled)}
      hitSlop={p.iconOnly ? 4 : 0}
      onPress={() => void runtime.dispatch(surfaceId, node.id, p.action, node.scope)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        height,
        minWidth: height,
        paddingHorizontal: p.iconOnly ? 0 : small ? 14 : 20,
        borderRadius: height / 2,
        backgroundColor: bg,
        alignSelf: p.fill ? "stretch" : "flex-start",
        opacity: p.disabled ? 0.45 : pressed ? 0.8 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      {p.icon ? <NativeIcon name={p.icon} color={fg} size={small ? 16 : 18} /> : null}
      {p.iconOnly ? null : (
        <Text
          style={{
            ...body,
            color: fg,
            fontWeight: "700",
            fontSize: small ? (body.fontSize as number) * 0.9 : body.fontSize,
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export { InRow };
