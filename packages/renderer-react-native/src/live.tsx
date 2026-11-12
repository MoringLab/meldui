/**
 * Draws a Live surface: markup a model wrote (elements, SVG, states and JS formulas), evaluated
 * directly. Every node re-renders only when a state it read changes, so a slider moves just the
 * shapes that depend on it; while an answer streams, finished nodes keep their identity and are
 * not drawn again. Kit components (Chart, Table, Formula…) are drawn by their usual widgets.
 */
import {
  type Each,
  type El,
  type Env,
  handlerCode,
  IDENTITY,
  type If,
  isPlainObject,
  LiveError,
  LiveLimit,
  LiveProgram,
  type Matrix,
  multiply,
  type Node,
  objectShape,
  parseExpr,
  parseLive,
  parseStatements,
  parseTransform,
  resolveName,
  rowScope,
  SVG_ELEMENTS,
  safeSvgProps,
  safeViewBox,
  shapeOf,
  shareTree,
  show,
  slotFor,
  splitText,
  transformPoint,
  type UIRuntime,
  viewBoxMatrix,
} from "@engine/core";
import { type ResolvedTypography, resolveTypography, type UIKit } from "@engine/kit-spec";
import { componentSchemas } from "@engine/protocol";
import Slider from "@react-native-community/slider";
import React, {
  cloneElement,
  createContext,
  isValidElement,
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useId,
  useRef,
  useState,
} from "react";
import {
  Animated,
  AppState,
  Dimensions,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import * as S from "react-native-svg";
import { FilledGround, useBackdrop, withAlpha } from "./interactive.js";
import { LinkHandlerContext } from "./markdown.js";
import {
  NativeBoundary,
  NativeIcon,
  NativeView,
  type NativeViewProps,
  useGestureLock,
  useUI,
} from "./renderer.js";
import { isDark } from "./style.js";
import { LabelBoard, labelWidth } from "./label-board.js";
import { LiveMap, readPins } from "./live-map.js";

type Palette = UIKit["tokens"]["light"] & { warning?: string };
/** Styles built up field by field (React Native's style types are read-only). */
type W<T> = { -readonly [K in keyof T]: T[K] };
type VS = W<ViewStyle>;
type TS = W<TextStyle>;
/** Where a node is drawn: a layout, inside text, inside a drawing, or inside a drawing's text. */
type Ns = "view" | "inline" | "svg" | "labels";

/** What a host adds to Live UIs: copying text and touch feedback. */
export type LiveHostServices = {
  copy?: (text: string) => void;
  haptic?: (kind: "light" | "selection") => void;
  /** sheet({…}) from a tap: the host opens a bottom sheet and fills it. */
  sheet?: (spec: Record<string, unknown>) => void;
  /** A map tile's address (z/x/y), or null when the host has no map. */
  mapTile?: (z: number, x: number, y: number) => string | null;
  /** <file path="…"/>: the host draws the file the answer handed over at that place. */
  renderFile?: (path: string, name?: string) => React.ReactNode;
};
export const LiveHost = createContext<LiveHostServices>({});

type Ctx = {
  program: LiveProgram;
  runtime: UIRuntime;
  surfaceId: string;
  kit: UIKit;
  ty: ResolvedTypography;
  allow: Set<string> | null;
  report: (where: string, error: unknown) => void;
  components: Record<string, React.ComponentType<NativeViewProps>>;
  renderChild: NativeViewProps["renderChild"];
};
const LiveCtx = createContext<Ctx | null>(null);
const useCtx = () => useContext(LiveCtx) as Ctx;

/** The colours a subtree draws with: the kit's, or the other mode's under theme="dark" / a dark ground. */
type Look = { t: Palette; dark: boolean; ink: string; fill: string; filled: boolean };
const LookCtx = createContext<Look | null>(null);
const useLook = () => useContext(LookCtx) as Look;
function lookFor(kit: UIKit, dark: boolean, filled: boolean, ink?: string): Look {
  const t = kit.tokens[dark ? "dark" : "light"] as Palette;
  const fill = filled ? (dark ? withAlpha("#ffffff", 0.08) : t.background) : t.surface;
  return { t, dark, ink: ink ?? t.foreground, fill, filled };
}

// ── colours, sizes ──────────────────────────────────────────────────────────────────────────────

const HUES: Record<string, string> = {
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  yellow: "#eab308",
  lime: "#84cc16",
  green: "#22c55e",
  emerald: "#10b981",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  sky: "#0ea5e9",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  purple: "#a855f7",
  fuchsia: "#d946ef",
  pink: "#ec4899",
  rose: "#f43f5e",
  gray: "#6b7280",
  grey: "#6b7280",
  slate: "#64748b",
  zinc: "#71717a",
  neutral: "#737373",
  stone: "#78716c",
};
function mix(hex: string, to: number, t: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
const NAMED = new Set(["white", "black", "transparent"]);
/** A colour as written (a role, a hue like blue or blue-600, #hex, rgb(), hsl()); undefined if unreadable. */
export function liveColor(value: unknown, look: Look, svg = false): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  if (!v) return undefined;
  const t = look.t;
  switch (v) {
    case "primary":
    case "foreground":
    case "text":
    case "default":
      return look.ink;
    case "secondary":
    case "muted":
    case "tertiary":
      return t.muted;
    case "accent":
      return t.accent;
    case "onAccent":
    case "on-accent":
      return t.onAccent;
    case "background":
    case "bg":
      return t.background;
    case "surface":
    case "surface-secondary":
    case "card":
      return look.fill;
    case "subtle":
    case "fill":
      return look.dark ? withAlpha("#ffffff", 0.08) : withAlpha("#000000", 0.05);
    case "border":
    case "line":
      return t.border;
    case "success":
      return t.success;
    case "danger":
    case "error":
      return t.danger;
    case "warning":
      return t.warning ?? (look.dark ? "#fbbf24" : "#d97706");
    case "info":
      return look.dark ? "#60a5fa" : "#2563eb";
    case "currentColor":
      return svg ? "currentColor" : look.ink;
    case "none":
      return svg ? "none" : "transparent";
  }
  const hue = /^([a-z]+)(?:-(\d{2,3}))?$/.exec(v);
  if (hue && HUES[hue[1] as string]) {
    const base = HUES[hue[1] as string] as string;
    const shade = hue[2] ? Number(hue[2]) : look.dark ? 400 : 500;
    if (shade === 500) return base;
    return shade < 500
      ? mix(base, 255, ((500 - shade) / 450) * 0.92)
      : mix(base, 0, ((shade - 500) / 450) * 0.8);
  }
  if (NAMED.has(v)) return v;
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return v;
  if (/^(rgb|hsl)a?\(\s*[-\d.%\s,/]+\)$/i.test(v)) return v;
  if (svg && /^url\(#[\w-]+\)$/.test(v)) return v;
  return undefined;
}

const TEXT_SCALE: Record<string, number> = {
  "2xs": 0.69,
  xs: 0.75,
  sm: 0.875,
  md: 1,
  base: 1,
  lg: 1.125,
  xl: 1.375,
  "2xl": 1.75,
  "3xl": 2.125,
  "4xl": 2.5,
  display: 2.5,
};
const ICON: Record<string, number> = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
  "2xl": 40,
  "3xl": 48,
};
const RADIUS: Record<string, number> = {
  none: 0,
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  "2xl": 24,
  "3xl": 32,
  full: 999,
};
const SPACE: Record<string, number> = { none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32 };

const num = (v: unknown): number | undefined => {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && /^-?[\d.]+(px|dp)?$/.test(v.trim())
        ? Number.parseFloat(v)
        : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
};
const clampN = (n: number | undefined, lo: number, hi: number) =>
  n === undefined ? undefined : Math.max(lo, Math.min(hi, n));
/** Spacing: a step of 4dp ({3} → 12), a token, or "12px". */
function space(v: unknown): number | undefined {
  if (typeof v === "number") return clampN(v * 4, -400, 400);
  if (typeof v === "string") {
    if (v in SPACE) return SPACE[v];
    if (/px$|dp$/.test(v)) return clampN(num(v), -400, 400);
    const n = num(v);
    return n === undefined ? undefined : clampN(n * 4, -400, 400);
  }
  return undefined;
}
/** A length: dp, "120px", "50%", "fill"/"full" (100%). */
function length(v: unknown): number | `${number}%` | undefined {
  // A size that cannot be meant (negative, far past any screen) is ignored, as if it weren't there.
  const sane = (n: number | undefined) => (n !== undefined && n >= 0 && n <= 4000 ? n : undefined);
  if (typeof v === "number") return sane(v);
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (s === "fill" || s === "full" || s === "100%") return "100%";
  if (/^[\d.]+%$/.test(s)) return s as `${number}%`;
  return sane(num(s));
}
function radiusOf(v: unknown): number | undefined {
  if (typeof v === "number") return clampN(v, 0, 999);
  if (typeof v === "string") return RADIUS[v] ?? clampN(num(v), 0, 999);
  return undefined;
}
function ratioOf(v: unknown): number | undefined {
  if (typeof v === "number") return v > 0 ? clampN(v, 0.1, 10) : undefined;
  if (typeof v === "string") {
    const m = /^([\d.]+)\s*[:/]\s*([\d.]+)$/.exec(v.trim());
    if (m) return clampN(Number(m[1]) / Number(m[2]), 0.1, 10);
    return clampN(num(v), 0.1, 10);
  }
  return undefined;
}

const ALIGN: Record<string, ViewStyle["alignItems"]> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
  baseline: "baseline",
};
const JUSTIFY: Record<string, ViewStyle["justifyContent"]> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly",
  "space-between": "space-between",
  "space-around": "space-around",
};

/** The view style of a layout element from its attributes. */
function boxStyle(a: Record<string, unknown>, look: Look, row: boolean, defaultGap: number): VS {
  const s: VS = { flexDirection: row ? "row" : "column" };
  const gap = a.gap !== undefined ? space(a.gap) : defaultGap;
  if (gap) s.gap = gap;
  if (a.rowGap !== undefined) s.rowGap = space(a.rowGap);
  if (a.columnGap !== undefined) s.columnGap = space(a.columnGap);
  const align = ALIGN[String(a.align ?? a.alignItems ?? "")];
  if (align) s.alignItems = align;
  else if (row) s.alignItems = "center";
  const justify = JUSTIFY[String(a.justify ?? a.justifyContent ?? "")];
  if (justify) s.justifyContent = justify;
  if (a.wrap) s.flexWrap = "wrap";
  const self = ALIGN[String(a.self ?? a.alignSelf ?? "")];
  if (self) s.alignSelf = self;
  if (a.flex !== undefined) {
    const f = num(a.flex);
    if (f !== undefined) {
      s.flexGrow = f;
      s.flexShrink = 1;
      s.flexBasis = 0;
    }
  }
  if (a.grow !== undefined) s.flexGrow = num(a.grow) ?? 1;
  if (a.shrink !== undefined) s.flexShrink = num(a.shrink) ?? 1;
  // size
  const size = length(a.size);
  if (size !== undefined) {
    s.width = size;
    s.height = size;
  }
  for (const k of ["width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight"] as const) {
    if (a[k] === undefined) continue;
    if (a[k] === "hug") {
      if (k === "width") s.alignSelf = "flex-start";
      continue;
    }
    const l = length(a[k]);
    if (l !== undefined)
      (s as any)[k] =
        k === "maxHeight" || k === "height" ? (typeof l === "number" ? Math.min(l, 2000) : l) : l;
  }
  // A fixed width still fits the screen it is on.
  if (typeof s.width === "number" && s.maxWidth === undefined) s.maxWidth = "100%";
  const ratio = ratioOf(a.aspectRatio ?? a.ratio);
  if (ratio) s.aspectRatio = ratio;
  // padding and margin
  const pad = (_key: string, ...names: string[]) => {
    for (const n of names) if (a[n] !== undefined) return space(a[n]);
    return undefined;
  };
  const p = a.padding ?? a.p;
  if (p && typeof p === "object" && !Array.isArray(p)) {
    const o = p as Record<string, unknown>;
    s.paddingTop = space(o.top ?? o.y) ?? 0;
    s.paddingBottom = space(o.bottom ?? o.y) ?? 0;
    s.paddingLeft = space(o.left ?? o.x) ?? 0;
    s.paddingRight = space(o.right ?? o.x) ?? 0;
  } else if (p !== undefined) s.padding = space(p);
  const px = pad("px", "px", "paddingX", "paddingHorizontal");
  const py = pad("py", "py", "paddingY", "paddingVertical");
  if (px !== undefined) s.paddingHorizontal = px;
  if (py !== undefined) s.paddingVertical = py;
  for (const [k, names] of [
    ["paddingTop", ["pt", "paddingTop"]],
    ["paddingBottom", ["pb", "paddingBottom"]],
    ["paddingLeft", ["pl", "paddingLeft"]],
    ["paddingRight", ["pr", "paddingRight"]],
  ] as const) {
    const v = pad(k, ...names);
    if (v !== undefined) (s as any)[k] = v;
  }
  const m = a.margin ?? a.m;
  if (m !== undefined && typeof m !== "object") s.margin = space(m);
  for (const [k, names] of [
    ["marginHorizontal", ["mx"]],
    ["marginVertical", ["my"]],
    ["marginTop", ["mt", "marginTop"]],
    ["marginBottom", ["mb", "marginBottom"]],
    ["marginLeft", ["ml", "marginLeft"]],
    ["marginRight", ["mr", "marginRight"]],
  ] as const) {
    const v = pad(k, ...names);
    if (v !== undefined) (s as any)[k] = v;
  }
  // ground
  const bg = liveColor(a.bg ?? a.background ?? a.backgroundColor, look);
  if (bg) s.backgroundColor = bg;
  const border = a.border;
  if (border) {
    if (typeof border === "object" && !Array.isArray(border)) {
      const o = border as Record<string, unknown>;
      s.borderWidth = clampN(num(o.size ?? o.width) ?? 1, 0, 20);
      s.borderColor = liveColor(o.color, look) ?? look.t.border;
    } else {
      s.borderWidth = typeof border === "number" ? clampN(border, 0, 20) : 1;
      s.borderColor =
        liveColor(typeof border === "string" && border !== "true" ? border : undefined, look) ??
        look.t.border;
    }
  }
  if (a.borderColor) s.borderColor = liveColor(a.borderColor, look) ?? s.borderColor;
  if (a.borderWidth !== undefined) s.borderWidth = clampN(num(a.borderWidth), 0, 20);
  for (const side of ["Top", "Bottom", "Left", "Right"] as const) {
    const v = a[`border${side}`];
    if (v) {
      (s as any)[`border${side}Width`] =
        typeof v === "number" ? clampN(v, 0, 20) : StyleSheet.hairlineWidth * 2;
      if (!s.borderColor)
        s.borderColor = liveColor(typeof v === "string" ? v : undefined, look) ?? look.t.border;
    }
  }
  const r = a.radius ?? a.rounded ?? a.borderRadius;
  if (r && typeof r === "object" && !Array.isArray(r)) {
    const o = r as Record<string, unknown>;
    s.borderTopLeftRadius = radiusOf(o.topLeft ?? o.top ?? o.left) ?? 0;
    s.borderTopRightRadius = radiusOf(o.topRight ?? o.top ?? o.right) ?? 0;
    s.borderBottomLeftRadius = radiusOf(o.bottomLeft ?? o.bottom ?? o.left) ?? 0;
    s.borderBottomRightRadius = radiusOf(o.bottomRight ?? o.bottom ?? o.right) ?? 0;
  } else if (r !== undefined) s.borderRadius = radiusOf(r === true ? "md" : r);
  if (a.opacity !== undefined) s.opacity = clampN(num(a.opacity), 0, 1);
  if (a.clip || a.overflow === "hidden") s.overflow = "hidden";
  if (a.position === "absolute" || a.absolute) {
    s.position = "absolute";
    for (const k of ["top", "left", "right", "bottom"] as const) {
      const v = a[k];
      if (v !== undefined) (s as any)[k] = typeof v === "string" && v.endsWith("%") ? v : num(v);
    }
    if (a.inset !== undefined) {
      const v = num(a.inset) ?? 0;
      Object.assign(s, { top: v, left: v, right: v, bottom: v });
    }
  }
  if (a.z !== undefined || a.zIndex !== undefined) s.zIndex = num(a.z ?? a.zIndex);
  const transform: any[] = [];
  if (a.rotate !== undefined) transform.push({ rotate: `${num(a.rotate) ?? 0}deg` });
  if (a.scale !== undefined) transform.push({ scale: clampN(num(a.scale), 0, 10) ?? 1 });
  if (a.translateX !== undefined)
    transform.push({ translateX: clampN(num(a.translateX), -4000, 4000) ?? 0 });
  if (a.translateY !== undefined)
    transform.push({ translateY: clampN(num(a.translateY), -4000, 4000) ?? 0 });
  if (transform.length) s.transform = transform;
  if (a.shadow) {
    const lvl = a.shadow === "lg" ? 3 : a.shadow === "sm" ? 1 : 2;
    Object.assign(s, {
      elevation: lvl * 3,
      shadowColor: "#000",
      shadowOpacity: look.dark ? 0.5 : 0.12,
      shadowRadius: lvl * 5,
      shadowOffset: { width: 0, height: lvl * 2 },
    });
  }
  if (a.style && isPlainObject(a.style)) Object.assign(s, sanitizeStyle(a.style, look));
  // As in HTML: a row that runs out of room narrows what is in it rather than running off the card.
  if (s.flexShrink === undefined) s.flexShrink = 1;
  return s;
}
/** style={{…}} as a model writes it: numbers, lengths and colours only. */
function sanitizeStyle(o: Record<string, unknown>, look: Look): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (/color$/i.test(k)) {
      const c = liveColor(v, look);
      if (c) out[k] = c;
    } else if (typeof v === "number" && Number.isFinite(v)) out[k] = clampN(v, -4000, 4000);
    else if (typeof v === "string" && /^-?[\d.]+%$/.test(v)) out[k] = v;
    else if (
      typeof v === "string" &&
      /^(flex-start|flex-end|center|stretch|space-between|space-around|row|column|wrap|absolute|relative|hidden|bold|normal|italic|underline|line-through)$/.test(
        v,
      )
    )
      out[k] = v;
  }
  return out;
}

// ── evaluation ──────────────────────────────────────────────────────────────────────────────────

type Attrs = Record<string, unknown>;
type Handlers = Record<string, (...args: unknown[]) => void>;
const EVENT = /^(on[A-Z]\w*|action)$/;

/** Re-renders the calling component when one of `deps` changes. */
function useWatch(program: LiveProgram, deps: Set<string>) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const key = deps.size ? [...deps].join("\u0000") : "";
  const stamp = program.stamp(deps);
  const seen = useRef(stamp);
  seen.current = stamp;
  useEffect(() => {
    if (!key) return;
    const names = key.split("\u0000");
    // A change between this render and the subscription is not missed.
    if (program.stamp(names) !== seen.current) force();
    return program.watch(names, force);
  }, [program, key]);
}

/** Evaluates an element's attributes; handlers become callbacks that run the code when called. */
function evalAttrs(
  node: El,
  env: Env,
  ctx: Ctx,
  deps: Set<string>,
): { a: Attrs; on: Handlers; write?: (v: unknown) => void } {
  const a: Attrs = {};
  const on: Handlers = {};
  let write: ((v: unknown) => void) | undefined;
  for (const attr of node.attrs) {
    const name = attr.name;
    if (name === "key") continue;
    if (EVENT.test(name) && attr.kind === "expr") {
      const src = String(attr.value);
      on[
        name === "action"
          ? "onPress"
          : name === "onClick" || name === "onTap"
            ? "onPress"
            : name === "onInput" || name === "onValueChange"
              ? "onChange"
              : name
      ] = (...args) => run(ctx, src, env, args);
      continue;
    }
    if (attr.kind === "flag") a[name] = true;
    else if (attr.kind === "str") a[name] = attr.value;
    else if (attr.kind === "bare") {
      const v = String(attr.value);
      a[name] = /^-?\d+(\.\d+)?$/.test(v)
        ? Number(v)
        : v === "true"
          ? true
          : v === "false"
            ? false
            : v;
    } else {
      const src = String(attr.value);
      try {
        a[name] = ctx.program.read(src, env, deps);
      } catch (error) {
        ctx.report(`${node.name}.${name}`, error);
      }
      if ((name === "value" || name === "bind" || name === "checked") && isRef(src)) {
        write = (v) => {
          try {
            ctx.program.run(parseStatements(`${src} = __v`), env.child({ __v: v }));
          } catch (error) {
            ctx.report(`${node.name}.${name}`, error);
          }
        };
        if (name === "bind") a.value = a.bind;
      }
    }
  }
  return write ? { a, on, write } : { a, on };
}
function isRef(src: string): boolean {
  try {
    const e = parseExpr(src);
    return e.t === "id" || e.t === "mem";
  } catch {
    return false;
  }
}
function run(ctx: Ctx, src: string, env: Env, args: unknown[]) {
  try {
    ctx.program.run(handlerCode(src), env, args);
  } catch (error) {
    ctx.report("handler", error);
  }
}
/** An input's value and how it changes: bound (value={x}, onChange) or, unbound, kept by the widget. */
function useControl(
  value: unknown,
  change: ((v: unknown) => void) | undefined,
): [unknown, (v: unknown) => void] {
  const [local, setLocal] = useState(value);
  return change ? [value, change] : [local, setLocal];
}
/** The value an input reports: writes the bound state and calls onChange. */
function changer(
  write: ((v: unknown) => void) | undefined,
  on: Handlers,
): ((v: unknown) => void) | undefined {
  if (!write && !on.onChange) return undefined;
  return (v) => {
    write?.(v);
    on.onChange?.(v);
  };
}

// ── root ────────────────────────────────────────────────────────────────────────────────────────

export function LiveView({ node, runtime, surfaceId, renderChild }: NativeViewProps) {
  const ui = useUI();
  const linkHandler = useContext(LinkHandlerContext);
  const host = useContext(LiveHost);
  const p = node.props as { source?: string; final?: boolean; frame?: boolean; allow?: string[] };
  const source = String(p.source ?? "");
  const doc = parseLive(source, Boolean(p.final));
  const prev = useRef<Node[] | undefined>(undefined);
  const nodes = shareTree(prev.current, doc.nodes);
  prev.current = nodes;
  const store = runtime.liveStore(surfaceId);
  const actions = useRef({ linkHandler, host });
  actions.current = { linkHandler, host };
  // A new program only when the declarations change (they come first; the UI streams after).
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the declarations, not the whole document
  const program = useMemo(
    () =>
      new LiveProgram(doc.decls, store, {
        send: (text) =>
          void runtime.options.onAction?.({
            name: "send",
            timestamp: new Date().toISOString(),
            surfaceId,
            sourceComponentId: node.id,
            context: { text },
          }),
        ask: (text) =>
          void runtime.options.onAction?.({
            name: "ask",
            timestamp: new Date().toISOString(),
            surfaceId,
            sourceComponentId: node.id,
            context: { text },
          }),
        open: (url) => {
          if (actions.current.linkHandler?.(url)) return;
          if (/^https:\/\//.test(url)) void Linking.openURL(url);
        },
        copy: (text) => actions.current.host.copy?.(text),
        sheet: (spec) => actions.current.host.sheet?.(spec),
      }),
    // A new program only when the declarations change (they come first; the UI streams after).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc.signature, store],
  );
  useEffect(() => () => program.dispose(), [program]);
  const reported = useRef(new Set<string>());
  const rootView = useRef<Measurable | null>(null);
  const ty = useMemo(
    () => resolveTypography(ui.kit, Platform.OS === "ios" ? "ios" : "android"),
    [ui.kit],
  );
  const allowKey = (p.allow ?? []).join(",");
  // Everything below reads these, so they keep their identity while a reply streams.
  const childRenderer = useRef(renderChild);
  childRenderer.current = renderChild;
  const ctx = useMemo<Ctx>(
    () => ({
      program,
      runtime,
      surfaceId,
      kit: ui.kit,
      ty,
      allow: allowKey ? new Set(allowKey.split(",")) : null,
      components: ui.components,
      renderChild: ((...args: Parameters<typeof renderChild>) =>
        childRenderer.current(...args)) as typeof renderChild,
      report: (where, error) => {
        const message = `${where}: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          240,
        );
        if (reported.current.has(message) || reported.current.size > 40) return;
        reported.current.add(message);
        runtime.report({
          code: error instanceof LiveLimit ? "LIVE_LIMIT" : "LIVE",
          message,
          severity: "warning",
          surfaceId,
        });
      },
    }),
    [program, runtime, surfaceId, ui.kit, ty, allowKey, ui.components],
  );
  const { filled } = useBackdrop();
  const base = useMemo(
    () => lookFor(ui.kit, ui.mode === "dark", filled),
    [ui.kit, ui.mode, filled],
  );
  const drawn = nodes.filter(
    (n) =>
      n.type === "el" ||
      (n.type === "text" && n.text.trim()) ||
      n.type === "each" ||
      n.type === "if",
  );
  const only = drawn.length === 1 && drawn[0]?.type === "el" ? (drawn[0] as El) : null;
  const grounded = (el: El) =>
    el.attrs.some((x) =>
      ["bg", "background", "backgroundColor", "border", "tone"].includes(x.name),
    );
  const childEls = (el: El): El[] =>
    el.children.flatMap((c) =>
      c.type === "el"
        ? [c]
        : c.type === "each"
          ? c.children.filter((x): x is El => x.type === "el")
          : c.type === "if"
            ? [...c.yes, ...c.else].filter((x): x is El => x.type === "el")
            : [],
    );
  // One ground of its own (a card, a coloured box), or a group of such cards: no extra frame.
  // Things with a ground of their own: a card, a coloured box, a picture, a map, a file.
  const isCard = (el: El) =>
    grounded(el) ||
    resolveName(el.name) === "Card" ||
    /^(image|img|photo|picture|carousel|slides|map|file|attachment)$/i.test(el.name);
  const selfFramed =
    (drawn.length > 1 && drawn.every((n) => n.type === "el" && isCard(n))) ||
    (!!only &&
      (isCard(only) ||
        only.attrs.some((x) => x.name === "plain" || (x.name === "frame" && x.value === "false")) ||
        (childEls(only).length > 0 && childEls(only).every(isCard))));
  const framed = Boolean(p.frame) && !selfFramed && drawn.length > 0;
  // A UI that pads itself already: the frame adds its ground, not a second padding.
  const padsItself = !!only && only.attrs.some((x) => /^(padding|p|px|py)$/.test(x.name));
  const framedLook = useMemo(() => lookFor(ui.kit, ui.mode === "dark", true), [ui.kit, ui.mode]);
  const body = (
    <LookCtx.Provider value={framed ? framedLook : base}>
      <View ref={rootView as never} style={{ gap: 12 }} collapsable={false}>
        <Kids nodes={nodes} env={program.root} ns="view" />
      </View>
    </LookCtx.Provider>
  );
  return (
    <LiveCtx.Provider value={ctx}>
      <Timers program={program} report={ctx.report} root={rootView} />
      {framed ? (
        <View
          style={{
            backgroundColor: base.fill,
            borderRadius: ui.kit.tokens.radius * 1.6,
            padding: padsItself ? 0 : 16,
          }}
        >
          <FilledGround>{body}</FilledGround>
        </View>
      ) : (
        body
      )}
    </LiveCtx.Provider>
  );
}

type Measurable = {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
};

/** useInterval timers: run while the UI is on screen and the app is in front; at most ~30 a second. */
function Timers({
  program,
  report,
  root,
}: {
  program: LiveProgram;
  report: Ctx["report"];
  root: { current: Measurable | null };
}) {
  const [active, setActive] = useState(AppState.currentState === "active");
  const hasTimers = program.timers.length > 0;
  const seen = useRef(true);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);
  // A simulation scrolled out of sight rests.
  useEffect(() => {
    if (!hasTimers || !active) return;
    const look = () =>
      root.current?.measureInWindow((_x, y, _width, height) => {
        seen.current = y + height > 0 && y < Dimensions.get("window").height;
      });
    const id = setInterval(look, 800);
    return () => clearInterval(id);
  }, [hasTimers, active, root]);
  if (!hasTimers || !active) return null;
  return (
    <>
      {program.timers.map((t, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: timers are fixed for a program
        <Timer key={i} program={program} fn={t.fn} delay={t.delay} report={report} seen={seen} />
      ))}
    </>
  );
}
function Timer({
  program,
  fn,
  delay,
  report,
  seen,
}: {
  program: LiveProgram;
  fn: LiveProgram["timers"][number]["fn"];
  delay: LiveProgram["timers"][number]["delay"];
  report: Ctx["report"];
  seen: { current: boolean };
}) {
  const deps = new Set<string>();
  let ms: number | null = null;
  try {
    const v = program.read(delay, program.root, deps);
    ms = typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.max(33, v) : null;
  } catch (error) {
    report("useInterval", error);
  }
  useWatch(program, deps);
  useEffect(() => {
    if (ms === null) return;
    let failures = 0;
    let last = 0;
    let stopped = false;
    // Paced by frames: when a phone can't keep up, ticks get further apart instead of piling up.
    const loop = (now: number) => {
      if (stopped) return;
      frame = requestAnimationFrame(loop);
      if (now - last < ms - 4 || !seen.current) return;
      last = now;
      try {
        program.run(fn, program.root);
        failures = 0;
      } catch (error) {
        report("useInterval", error);
        // Ticks are small: one that used up its budget would freeze the app 30 times a second.
        if (error instanceof LiveLimit || ++failures >= 3) stopped = true;
      }
    };
    let frame = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [program, fn, ms, report, seen]);
  return null;
}

// ── nodes ───────────────────────────────────────────────────────────────────────────────────────

const MAX_EACH = 400;
/** Rows a loop may draw; a loop inside a loop shares what its parent has left per row. */
const RowRoom = createContext(3000);

function Kids({ nodes, env, ns, cell }: { nodes: Node[]; env: Env; ns: Ns; cell?: ViewStyle }) {
  return (
    <>
      {nodes.map((n, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the order of a node's children is fixed
        <LiveNode key={`${n.type}${n.at ?? i}`} node={n} env={env} ns={ns} cell={cell} />
      ))}
    </>
  );
}

const LiveNode = memo(function LiveNode({
  node,
  env,
  ns,
  cell,
}: {
  node: Node;
  env: Env;
  ns: Ns;
  cell?: ViewStyle;
}) {
  if (ns === "labels") {
    // The words of a drawing, in the layer above it; everything else has its place in the drawing.
    if (!holdsLabels([node])) return null;
    if (node.type === "el")
      return node.name.toLowerCase() === "text" ? (
        <SvgLabel node={node} env={env} />
      ) : (
        <SvgLabelGroup node={node} env={env} />
      );
  } else if (ns === "svg" && node.type === "el" && isLabel(node)) return null;
  switch (node.type) {
    case "el":
      return <LiveEl node={node} env={env} ns={ns} cell={cell} />;
    case "text":
      if (!node.text.trim() && ns !== "inline") return null;
      return <LiveText text={node.text} env={env} ns={ns} />;
    case "each":
      return <LiveEach node={node} env={env} ns={ns} cell={cell} />;
    case "if":
      return <LiveIf node={node} env={env} ns={ns} cell={cell} />;
    default:
      return null;
  }
});

function LiveEach({ node, env, ns, cell }: { node: Each; env: Env; ns: Ns; cell?: ViewStyle }) {
  const ctx = useCtx();
  const room = useContext(RowRoom);
  const deps = new Set<string>();
  let list: unknown[] = [];
  try {
    const v = ctx.program.read(node.list, env, deps);
    list = Array.isArray(v)
      ? v
      : typeof v === "number"
        ? Array.from({ length: Math.min(Math.max(0, v), MAX_EACH) }, (_, i) => i)
        : v && typeof v === "object"
          ? Object.values(v)
          : [];
  } catch (error) {
    ctx.report(`each ${node.list}`, error);
  }
  useWatch(ctx.program, deps);
  // One scope per row, kept while the row's item is the same value: unchanged rows are not redrawn.
  const scopes = useRef(new Map<string, Env>());
  const keyAttr = node.children
    .find((c): c is El => c.type === "el")
    ?.attrs.find((x) => x.name === "key");
  const keySrc = node.key ?? (keyAttr?.kind === "expr" ? String(keyAttr.value) : null);
  const next = new Map<string, Env>();
  const rows = list.slice(0, Math.min(MAX_EACH, room)).map((item, i) => {
    let key = String(i);
    let scope = scopes.current.get(key);
    const fresh =
      !scope ||
      scope.parent !== env ||
      scope.vars.get("\u0000row") !== item ||
      scope.vars.get("\u0000i") !== i;
    if (fresh) scope = rowScope(env, node, item, i);
    if (keySrc) {
      try {
        key = `k${show(ctx.program.read(keySrc, scope))}`;
      } catch {}
      const kept = scopes.current.get(key);
      if (
        kept &&
        kept.parent === env &&
        kept.vars.get("\u0000row") === item &&
        kept.vars.get("\u0000i") === i
      )
        scope = kept;
    }
    while (next.has(key)) key += "'";
    next.set(key, scope as Env);
    return { key, scope: scope as Env };
  });
  scopes.current = next;
  return (
    <RowRoom.Provider value={Math.max(1, Math.floor(room / Math.max(1, rows.length)))}>
      {rows.map(({ key, scope }) => (
        <Kids key={key} nodes={node.children} env={scope} ns={ns} cell={cell} />
      ))}
    </RowRoom.Provider>
  );
}

function LiveIf({ node, env, ns, cell }: { node: If; env: Env; ns: Ns; cell?: ViewStyle }) {
  const ctx = useCtx();
  const deps = new Set<string>();
  let yes = false;
  try {
    yes = Boolean(ctx.program.read(node.cond, env, deps));
  } catch (error) {
    ctx.report(`if ${node.cond}`, error);
  }
  useWatch(ctx.program, deps);
  return <Kids nodes={yes ? node.yes : node.else} env={env} ns={ns} cell={cell} />;
}

/** Text with {formulas}; bare text in a layout gets the body style. */
function LiveText({ text, env, ns }: { text: string; env: Env; ns: Ns }) {
  const ctx = useCtx();
  const look = useLook();
  const deps = new Set<string>();
  const parts = splitText(text).map((p) => {
    if (typeof p === "string") return { s: p, lit: true };
    try {
      return { s: show(ctx.program.read(p.expr, env, deps)), lit: false };
    } catch (error) {
      ctx.report(`{${p.expr}}`, error);
      return { s: "", lit: false };
    }
  });
  useWatch(ctx.program, deps);
  // Words straight inside a drawing (not in <text>) are not drawn: react-native-svg cannot hold them.
  if (ns === "svg" || ns === "labels") return null;
  const spans = inlineSpans(parts, ns !== "inline");
  if (ns === "inline") return <>{spans}</>;
  if (!spans.length) return null;
  return (
    <Text selectable={false} style={{ ...textStyle({}, ctx, look, "md"), flexShrink: 1 }}>
      {spans}
    </Text>
  );
}

/** `**bold**`, `*italic*`, `~~struck~~` and `` `code` `` in literal text (not in computed values). */
function inlineSpans(parts: { s: string; lit: boolean }[], trim: boolean): ReactNode[] {
  let joined = parts.map((p) => p.s.replace(/\s+/g, " ")).join("");
  if (trim) joined = joined.trim();
  if (!joined) return [];
  if (!parts.some((p) => p.lit && /[*~`_]/.test(p.s))) return [joined];
  const out: ReactNode[] = [];
  const re =
    /(\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|`([^`]+)`|\*([^*\s][^*]*)\*|(?<![\w])_([^_\s][^_]*)_(?![\w]))/g;
  let last = 0;
  let k = 0;
  for (let m = re.exec(joined); m; m = re.exec(joined)) {
    if (m.index > last) out.push(joined.slice(last, m.index));
    const [, , b, b2, s, code, i, i2] = m;
    const style: TextStyle =
      b || b2
        ? { fontWeight: "700" }
        : s
          ? { textDecorationLine: "line-through" }
          : code
            ? { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }
            : { fontStyle: "italic" };
    out.push(
      <Text key={k++} style={style}>
        {b ?? b2 ?? s ?? code ?? i ?? i2}
      </Text>,
    );
    last = m.index + m[0].length;
  }
  if (last < joined.length) out.push(joined.slice(last));
  return out;
}

const WEIGHT: Record<string, 400 | 500 | 600 | 700> = {
  regular: 400,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  heavy: 700,
  black: 700,
};
function textStyle(
  a: Attrs,
  ctx: Ctx,
  look: Look,
  defaultSize: string,
  defaultWeight: 400 | 500 | 600 | 700 = 400,
): TS {
  const base = ctx.ty.body.size;
  const sizeAttr = a.size;
  const size =
    typeof sizeAttr === "number"
      ? clampN(sizeAttr, 8, 96)!
      : base * (TEXT_SCALE[String(sizeAttr ?? defaultSize)] ?? TEXT_SCALE[defaultSize] ?? 1);
  const w =
    typeof a.weight === "number"
      ? a.weight >= 650
        ? 700
        : a.weight >= 550
          ? 600
          : a.weight >= 450
            ? 500
            : 400
      : (WEIGHT[String(a.weight ?? "")] ?? (a.bold ? 700 : defaultWeight));
  const file = w === 400 ? ctx.ty.body.nativeFamily : ctx.ty.weights?.[w];
  const s: TS = {
    fontSize: Math.round(size * 10) / 10,
    lineHeight: Math.round(size * (size >= 22 ? 1.22 : size >= 17 ? 1.35 : 1.5)),
    color: liveColor(a.color, look) ?? toneColor(a.tone, look) ?? look.ink,
    ...(file
      ? { fontFamily: file }
      : w !== 400
        ? { fontWeight: String(w) as TextStyle["fontWeight"] }
        : {}),
  };
  if (a.align)
    s.textAlign =
      a.align === "end" || a.align === "right" ? "right" : a.align === "center" ? "center" : "left";
  if (a.italic) s.fontStyle = "italic";
  const deco = [
    a.underline ? "underline" : "",
    a.strike || a.strikethrough || a.lineThrough ? "line-through" : "",
  ]
    .filter(Boolean)
    .join(" ");
  if (deco) s.textDecorationLine = deco as TextStyle["textDecorationLine"];
  if (a.mono) s.fontFamily = Platform.OS === "ios" ? "Menlo" : "monospace";
  if (a.tabularNums || a.tabular) s.fontVariant = ["tabular-nums"];
  if (a.opacity !== undefined) s.opacity = clampN(num(a.opacity), 0, 1);
  if (a.uppercase) s.textTransform = "uppercase";
  if (a.tracking !== undefined || a.letterSpacing !== undefined)
    s.letterSpacing = num(a.tracking ?? a.letterSpacing);
  if (a.highlight) s.backgroundColor = look.dark ? "rgba(250,204,21,0.3)" : "rgba(250,204,21,0.35)";
  return s;
}
function toneColor(tone: unknown, look: Look): string | undefined {
  if (tone === "muted") return look.t.muted;
  if (tone === "accent") return look.t.accent;
  if (tone === "success") return look.t.success;
  if (tone === "danger") return look.t.danger;
  if (tone === "warning") return look.t.warning ?? "#d97706";
  return undefined;
}

// ── elements ────────────────────────────────────────────────────────────────────────────────────

const INLINE = new Set([
  "span",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "del",
  "strike",
  "code",
  "mark",
  "small",
  "a",
  "link",
  "sub",
  "sup",
]);
const TEXTS: Record<string, { size: string; weight: 400 | 500 | 600 | 700; muted?: boolean }> = {
  text: { size: "md", weight: 400 },
  p: { size: "md", weight: 400 },
  paragraph: { size: "md", weight: 400 },
  title: { size: "lg", weight: 700 },
  heading: { size: "lg", weight: 700 },
  h1: { size: "2xl", weight: 700 },
  h2: { size: "xl", weight: 700 },
  h3: { size: "lg", weight: 700 },
  h4: { size: "md", weight: 600 },
  h5: { size: "sm", weight: 600 },
  h6: { size: "sm", weight: 600 },
  subtitle: { size: "md", weight: 600 },
  caption: { size: "sm", weight: 400, muted: true },
  small: { size: "sm", weight: 400, muted: true },
  label: { size: "sm", weight: 500, muted: true },
  bold: { size: "md", weight: 700 },
  strong: { size: "md", weight: 700 },
  mark: { size: "md", weight: 400 },
};
const LAYOUT = new Set([
  "box",
  "div",
  "view",
  "section",
  "row",
  "hstack",
  "col",
  "column",
  "vstack",
  "stack",
  "griditem",
  "grid-item",
  "pressable",
  "touchable",
  "center",
  "footer",
  "header",
  "form",
  "ul",
  "ol",
  "nav",
  "main",
  "article",
  "aside",
  "card-body",
  "frame",
]);
const SVG_TAGS: Record<string, React.ComponentType<any>> = {
  g: S.G,
  rect: S.Rect,
  circle: S.Circle,
  ellipse: S.Ellipse,
  line: S.Line,
  polyline: S.Polyline,
  polygon: S.Polygon,
  path: S.Path,
  text: S.Text,
  tspan: S.TSpan,
  textpath: S.TextPath,
  defs: S.Defs,
  lineargradient: S.LinearGradient,
  radialgradient: S.RadialGradient,
  stop: S.Stop,
  clippath: S.ClipPath,
  marker: S.Marker,
  image: S.Image,
};

/** HTML that has no place in an answer: it is not drawn, and its text doesn't show either. */
const NOT_DRAWN = new Set(["script", "style", "head", "meta", "noscript", "template"]);

/** How many elements have drawn, for checking that a change or a stream draws only what it should. */
export const liveStats = { draws: 0 };

const LiveEl = memo(function LiveEl({
  node,
  env,
  ns,
  cell,
}: {
  node: El;
  env: Env;
  ns: Ns;
  cell?: ViewStyle;
}) {
  liveStats.draws++;
  const ctx = useCtx();
  const look = useLook();
  const deps = new Set<string>();
  const { a, on, write } = evalAttrs(node, env, ctx, deps);
  const hidden = a.visible === false || a.hidden === true || a.if === false;
  const tag = node.name.toLowerCase();
  let out: ReactNode = null;
  let failed = hidden || NOT_DRAWN.has(tag);
  if (!failed) {
    try {
      // Before the watch: what these read while drawing (the words of an SVG text, a big number) counts too.
      out =
        ns === "svg"
          ? svgEl(tag, node, a, on, env, look, ctx, deps)
          : drawEl(tag, node, a, on, write, env, ns, ctx, look, deps);
    } catch (error) {
      ctx.report(`<${node.name}>`, error);
      failed = true;
    }
  }
  useWatch(ctx.program, deps);
  if (failed) return null;
  if (cell && ns === "view") return <View style={cell}>{out}</View>;
  return <>{out}</>;
});

function drawEl(
  tag: string,
  node: El,
  a: Attrs,
  on: Handlers,
  write: ((v: unknown) => void) | undefined,
  env: Env,
  ns: Ns,
  ctx: Ctx,
  look: Look,
  deps: Set<string>,
): ReactNode {
  // Inside text: spans.
  if (ns === "inline" || (INLINE.has(tag) && ns !== "view"))
    return inlineEl(tag, node, a, on, env, ctx, look);
  if (tag === "svg") return <LiveSvg node={node} a={a} env={env} />;
  if (TEXTS[tag] || INLINE.has(tag)) return textEl(tag, node, a, on, env, ctx, look, deps);
  if (tag === "row" || tag === "hstack") return <Box node={node} a={a} on={on} env={env} row />;
  if (tag === "grid") return <Grid node={node} a={a} env={env} />;
  if (tag === "scroll" || (LAYOUT.has(tag) && (a.scroll === "x" || a.scroll === "horizontal")))
    return <Scroll node={node} a={a} env={env} />;
  if (LAYOUT.has(tag))
    return (
      <Box node={node} a={a} on={on} env={env} row={a.direction === "row" || a.row === true} />
    );
  switch (tag) {
    case "icon":
      return <LiveIcon a={a} look={look} />;
    case "carousel":
    case "slides":
      return <Carousel node={node} a={a} env={env} />;
    case "map":
      return <MapEl a={a} write={write} on={on} look={look} />;
    case "file":
    case "attachment":
      return <FileEl a={a} />;
    case "image":
    case "img":
    case "asyncimage":
    case "picture":
    case "photo":
      return <LiveImage a={a} look={look} />;
    case "badge":
    case "chip":
    case "tag":
    case "pill":
      return <Badge node={node} a={a} env={env} look={look} />;
    case "table":
      if (node.children.some((c) => c.type === "el" && /^(tr|thead|tbody)$/i.test(c.name)))
        return <Box node={node} a={{ gap: 0, ...a }} on={on} env={env} row={false} />;
      break;
    case "thead":
    case "tbody":
      return <Box node={node} a={{ gap: 0, ...a }} on={on} env={env} row={false} />;
    case "tr":
      return (
        <Box
          node={node}
          a={{ gap: 3, py: 2, borderBottom: true, align: "start", ...a }}
          on={on}
          env={env}
          row
        />
      );
    case "td":
    case "th": {
      const head = tag === "th";
      return (
        <View style={{ flex: num(a.flex) ?? 1, minWidth: 0 }}>
          {textEl(
            "text",
            node,
            { size: "sm", ...(head ? { weight: "semibold", color: "muted" } : {}), ...a },
            on,
            env,
            ctx,
            look,
            deps,
          )}
        </View>
      );
    }
    case "li":
      return (
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <Text style={textStyle({ color: "muted" }, ctx, look, "md")}>
            {typeof a.marker === "string" ? a.marker : "•"}
          </Text>
          <View style={{ flex: 1, gap: 4 }}>
            {node.children.some((c) => c.type === "el" && !INLINE.has(c.name.toLowerCase())) ? (
              <Kids nodes={node.children} env={env} ns="view" />
            ) : (
              textEl("text", node, a, on, env, ctx, look, deps)
            )}
          </View>
        </View>
      );
    case "divider":
    case "hr":
    case "separator":
      return (
        <View
          style={
            a.vertical
              ? {
                  width: StyleSheet.hairlineWidth * 2,
                  alignSelf: "stretch",
                  backgroundColor: liveColor(a.color, look) ?? look.t.border,
                }
              : {
                  height: StyleSheet.hairlineWidth * 2,
                  alignSelf: "stretch",
                  backgroundColor: liveColor(a.color, look) ?? look.t.border,
                  marginVertical: space(a.my) ?? 4,
                }
          }
        />
      );
    case "spacer":
      return (
        <View
          style={
            a.size !== undefined ? { width: space(a.size), height: space(a.size) } : { flexGrow: 1 }
          }
        />
      );
    case "button":
      return <Button node={node} a={a} on={on} env={env} />;
    case "input":
    case "textfield":
    case "textarea":
      // A model never asks for a password or a code in its own UI: the host has a secure form
      // for that. One in an answer could be a page's instructions phishing through the agent.
      if (asksForSecret(a)) {
        ctx.report(`<${tag}>`, new LiveError("a password field is not drawn in an answer"));
        return null;
      }
      return (
        <Field a={{ ...a, multiline: a.multiline ?? tag === "textarea" }} on={on} write={write} />
      );
    case "slider":
    case "range":
      return <LiveSlider a={a} on={on} write={write} />;
    case "switch":
    case "toggle":
      return <Check a={{ ...a, variant: "switch" }} on={on} write={write} node={node} env={env} />;
    case "checkbox":
    case "check":
      return <Check a={a} on={on} write={write} node={node} env={env} />;
    case "select":
    case "segmented":
    case "segmented-control":
    case "segmentedcontrol":
    case "chips":
    case "radio":
    case "radiogroup":
    case "tabs-control":
      return (
        <Choice
          a={{
            ...a,
            variant:
              a.variant ??
              (tag === "chips"
                ? "chips"
                : tag.startsWith("radio")
                  ? "list"
                  : tag === "select"
                    ? undefined
                    : "segmented"),
          }}
          on={on}
          write={write}
          node={node}
        />
      );
    case "progress":
    case "meter":
      return <Progress a={a} look={look} />;
    case "date":
    case "datepicker":
    case "date-picker":
      return (
        <KitEl
          node={{ ...node, name: "DatePicker" }}
          a={a}
          on={on}
          write={write}
          env={env}
          name="DatePicker"
        />
      );
  }
  const kit = resolveName(node.name);
  if (kit && kit !== "Live")
    return <KitEl node={node} a={a} on={on} write={write} env={env} name={kit} />;
  // An unknown tag lays its children out like a box.
  return <Box node={node} a={a} on={on} env={env} row={false} />;
}

function textEl(
  tag: string,
  node: El,
  a: Attrs,
  on: Handlers,
  env: Env,
  ctx: Ctx,
  look: Look,
  deps: Set<string>,
): ReactNode {
  const spec = TEXTS[tag] ?? TEXTS.text!;
  let size = String(a.size ?? spec.size);
  // <Heading level={2}>, <title size="xl">
  if ((tag === "heading" || tag === "title") && typeof a.level === "number")
    size = ["2xl", "2xl", "xl", "lg", "md", "sm", "sm"][a.level] ?? "lg";
  const style = textStyle(
    { ...a, size, ...(spec.muted && !a.color && !a.tone ? { color: "muted" } : {}) },
    ctx,
    look,
    spec.size,
    spec.weight,
  );
  if (tag === "mark")
    style.backgroundColor = look.dark ? "rgba(250,204,21,0.3)" : "rgba(250,204,21,0.35)";
  style.flexShrink = 1;
  const lines = clampN(num(a.lines ?? a.numberOfLines), 1, 100);
  const own = typeof a.text === "string" || typeof a.text === "number" ? String(a.text) : null;
  const press = on.onPress;
  // A number never breaks in the middle: on a narrow card it gets smaller instead, and whatever
  // sits beside it in a row gives way first.
  const fit =
    a.fit === true ||
    (lines === undefined &&
      a.fit !== false &&
      isValue(own ?? plainWords(node.children, env, ctx, deps)));
  if (fit) style.flexShrink = 0.01;
  return (
    <Text
      style={style}
      numberOfLines={fit ? 1 : lines}
      adjustsFontSizeToFit={fit || undefined}
      minimumFontScale={fit ? 0.5 : undefined}
      accessibilityRole={
        tag.startsWith("h") || tag === "title" || tag === "heading" ? "header" : undefined
      }
      onPress={press ? () => press() : undefined}
    >
      {own ?? <Kids nodes={node.children} env={env} ns="inline" />}
    </Text>
  );
}

/** The words of a text made of nothing but words and {formulas}; null when it holds other elements. */
function plainWords(nodes: Node[], env: Env, ctx: Ctx, deps: Set<string>): string | null {
  let out = "";
  for (const n of nodes) {
    if (n.type !== "text") return null;
    for (const p of splitText(n.text))
      out += typeof p === "string" ? p : show(safeRead(ctx, p.expr, env, deps));
  }
  return out.trim();
}
/** A value rather than a sentence: 128, 2.89초, ₩ 16,898,000, 1 / 3, 25:00, +5.24%. */
const isValue = (s: string | null) =>
  !!s && s.length <= 20 && /\d/.test(s) && (s.match(/[A-Za-z\u3131-\uD7A3]/g)?.length ?? 0) <= 4;

function inlineEl(
  tag: string,
  node: El,
  a: Attrs,
  on: Handlers,
  env: Env,
  ctx: Ctx,
  look: Look,
): ReactNode {
  if (tag === "icon") return <LiveIcon a={{ size: "sm", ...a }} look={look} />;
  if (tag === "br") return "\n";
  const s: TS = {};
  if (tag === "b" || tag === "strong" || tag === "bold")
    Object.assign(
      s,
      ctx.ty.weights?.[700] ? { fontFamily: ctx.ty.weights[700] } : { fontWeight: "700" },
    );
  if (tag === "i" || tag === "em") s.fontStyle = "italic";
  if (tag === "u") s.textDecorationLine = "underline";
  if (tag === "s" || tag === "del" || tag === "strike") s.textDecorationLine = "line-through";
  if (tag === "code")
    Object.assign(s, {
      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
      backgroundColor: look.dark ? withAlpha("#ffffff", 0.1) : withAlpha("#000000", 0.06),
    });
  if (tag === "mark")
    s.backgroundColor = look.dark ? "rgba(250,204,21,0.3)" : "rgba(250,204,21,0.35)";
  if (tag === "small") s.fontSize = ctx.ty.body.size * 0.85;
  if (tag === "a" || tag === "link") Object.assign(s, { textDecorationLine: "underline" });
  if (TEXTS[tag] || tag === "span" || tag === "text") Object.assign(s, partialText(a, ctx, look));
  const href = typeof a.href === "string" ? a.href : null;
  const press =
    on.onPress ??
    (href ? () => ctx.program.run(handlerCode(`open(${JSON.stringify(href)})`)) : undefined);
  const own = typeof a.text === "string" ? a.text : null;
  return (
    <Text style={s} onPress={press}>
      {own ?? <Kids nodes={node.children} env={env} ns="inline" />}
    </Text>
  );
}
/** The attributes of a span that change its look (nothing set means: as the text around it). */
function partialText(a: Attrs, ctx: Ctx, look: Look): TS {
  const s: TS = {};
  if (a.color || a.tone) s.color = liveColor(a.color, look) ?? toneColor(a.tone, look);
  if (a.size !== undefined)
    s.fontSize =
      typeof a.size === "number"
        ? clampN(a.size, 8, 96)
        : ctx.ty.body.size * (TEXT_SCALE[String(a.size)] ?? 1);
  const w = WEIGHT[String(a.weight ?? "")];
  if (w && w !== 400)
    Object.assign(
      s,
      ctx.ty.weights?.[w] ? { fontFamily: ctx.ty.weights[w] } : { fontWeight: String(w) },
    );
  if (a.italic) s.fontStyle = "italic";
  if (a.underline) s.textDecorationLine = "underline";
  if (a.strike) s.textDecorationLine = "line-through";
  if (a.tabularNums) s.fontVariant = ["tabular-nums"];
  return s;
}

/** A box, row or column; with onPress it is pressable. theme / a dark ground switch the colours inside. */
function Box({
  node,
  a,
  on,
  env,
  row,
}: {
  node: El;
  a: Attrs;
  on: Handlers;
  env: Env;
  row: boolean;
}) {
  const ctx = useCtx();
  const look = useLook();
  const tag = node.name.toLowerCase();
  const legacy = resolveName(node.name);
  // The catalog's Box tones (subtle, raised…) as grounds.
  const tone = typeof a.tone === "string" ? a.tone : null;
  const toneBg =
    tone === "subtle" || tone === "raised"
      ? look.fill
      : tone === "accent" || tone === "inverse"
        ? look.t.accent
        : tone === "accentSoft"
          ? withAlpha(look.t.accent, 0.1)
          : tone === "success"
            ? withAlpha(look.t.success, 0.12)
            : tone === "warning"
              ? withAlpha(look.t.warning ?? "#d97706", 0.12)
              : tone === "danger"
                ? withAlpha(look.t.danger, 0.12)
                : undefined;
  const defaultGap =
    legacy === "Box" || legacy === "Row" || legacy === "Column"
      ? row
        ? 8
        : 8
      : row
        ? 8
        : tag === "center"
          ? 8
          : 8;
  const style = boxStyle(
    {
      ...(row && a.wrap === undefined && allFixedSize(node.children) ? { wrap: true } : {}),
      ...(tag === "center" ? { align: "center", justify: "center" } : {}),
      ...(tone && toneBg && !a.bg && !a.background
        ? { bg: toneBg, padding: a.padding ?? "md", radius: a.radius ?? "lg" }
        : {}),
      ...a,
    },
    look,
    row,
    defaultGap,
  );
  if (typeof a.padding === "string" && a.padding in SPACE && legacy)
    style.padding = SPACE[a.padding];
  const bg = style.backgroundColor as string | undefined;
  const theme =
    a.theme === "dark"
      ? true
      : a.theme === "light"
        ? false
        : bg && bg !== "transparent" && /^#/.test(bg)
          ? isDark(bg)
          : null;
  const inner = theme !== null && theme !== look.dark;
  const ink = liveColor(a.color, look);
  const ownLook = Boolean(inner || ink || bg);
  const childDark = theme ?? look.dark;
  const childFilled = Boolean(bg) || look.filled;
  const childInk = ink ?? (inner ? undefined : look.ink);
  const childLook = useMemo(
    () => (ownLook ? lookFor(ctx.kit, childDark, childFilled, childInk) : null),
    [ownLook, ctx.kit, childDark, childFilled, childInk],
  );
  const kids = <Kids nodes={node.children} env={env} ns="view" />;
  const content = childLook ? <LookCtx.Provider value={childLook}>{kids}</LookCtx.Provider> : kids;
  if (on.onPress || on.onLongPress) {
    return (
      <Press
        style={style}
        onPress={on.onPress}
        onLongPress={on.onLongPress}
        label={typeof a.label === "string" ? a.label : undefined}
        selected={a.selected === true}
      >
        {content}
      </Press>
    );
  }
  return <View style={style}>{content}</View>;
}

const FIXED_SIZE = new Set(["icon", "badge", "chip", "tag", "pill", "button"]);
/** Things that cannot get narrower: in a row they go onto the next line rather than off the card. */
function allFixedSize(nodes: Node[]): boolean {
  let any = false;
  for (const n of nodes) {
    if (n.type === "text") {
      if (n.text.trim()) return false;
    } else if (n.type === "each") {
      if (!allFixedSize(n.children)) return false;
      any = true;
    } else if (n.type === "if") {
      if (!allFixedSize([...n.yes, ...n.else])) return false;
      any = true;
    } else if (n.type === "el") {
      if (
        !FIXED_SIZE.has(n.name.toLowerCase()) ||
        n.attrs.some((x) => x.name === "flex" || x.name === "block" || x.name === "fill")
      )
        return false;
      any = true;
    }
  }
  return any;
}

function Grid({ node, a, env }: { node: El; a: Attrs; env: Env }) {
  const look = useLook();
  const [width, setWidth] = useState(0);
  const cols = Math.max(1, Math.min(8, Math.round(num(a.columns ?? a.cols) ?? 2)));
  const gap = space(a.gap ?? 2) ?? 8;
  const cellW = width ? Math.floor((width - gap * (cols - 1)) / cols) : 0;
  const cell = useMemo<ViewStyle>(
    () => (cellW ? { width: cellW } : { width: `${Math.floor(100 / cols) - 2}%` as `${number}%` }),
    [cellW, cols],
  );
  const style = boxStyle({ ...a, gap: undefined, wrap: true }, look, true, 0);
  style.gap = gap;
  style.alignItems = ALIGN[String(a.align ?? "stretch")] ?? "stretch";
  return (
    <View
      style={style}
      onLayout={(e) =>
        setWidth(
          Math.round(
            e.nativeEvent.layout.width -
              ((style.padding as number) ?? 0) * 2 -
              ((style.paddingHorizontal as number) ?? 0) * 2,
          ),
        )
      }
    >
      <Kids nodes={node.children} env={env} ns="view" cell={cell} />
    </View>
  );
}

function Scroll({ node, a, env }: { node: El; a: Attrs; env: Env }) {
  const look = useLook();
  // As in HTML, a scroll area around one column scrolls down; a row of items scrolls sideways.
  const kids = node.children.filter((c) => c.type !== "text" || c.text.trim());
  const onlyColumn =
    kids.length === 1 &&
    kids[0]?.type === "el" &&
    /^(box|col|column|vstack|stack|div|view|section)$/i.test(kids[0].name);
  const vertical =
    a.direction === "column" ||
    a.scroll === "y" ||
    a.scroll === "vertical" ||
    (onlyColumn && a.direction !== "row" && a.scroll !== "x");
  const style = boxStyle({ ...a, scroll: undefined }, look, !vertical, 8);
  const {
    padding,
    paddingHorizontal,
    paddingVertical,
    gap,
    alignItems,
    justifyContent,
    flexDirection,
    ...outer
  } = style;
  return (
    <ScrollView
      horizontal={!vertical}
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      style={vertical ? { ...outer, maxHeight: (outer.maxHeight as number) ?? 360 } : outer}
      contentContainerStyle={{
        padding,
        paddingHorizontal,
        paddingVertical,
        gap,
        alignItems,
        justifyContent,
        flexDirection,
      }}
    >
      <Kids nodes={node.children} env={env} ns="view" />
    </ScrollView>
  );
}

const APressable = Animated.createAnimatedComponent(Pressable);
/** A pressable with a gentle scale. */
function Press({
  style,
  onPress,
  onLongPress,
  disabled,
  label,
  role = "button",
  selected,
  children,
  scaleTo = 0.97,
}: {
  style?: ViewStyle;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  label?: string;
  role?: "button" | "tab" | "radio" | "checkbox" | "switch";
  selected?: boolean;
  children: ReactNode;
  scaleTo?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const host = useContext(LiveHost);
  const spring = (to: number) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 40,
      bounciness: to === 1 ? 6 : 0,
    }).start();
  return (
    <APressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{
        disabled: Boolean(disabled),
        selected,
        checked: role === "checkbox" || role === "switch" ? selected : undefined,
      }}
      disabled={disabled}
      hitSlop={6}
      onPressIn={() => spring(scaleTo)}
      onPressOut={() => spring(1)}
      onPress={() => {
        host.haptic?.(role === "button" ? "light" : "selection");
        onPress?.();
      }}
      onLongPress={onLongPress}
      style={[
        style,
        { transform: [...((style?.transform as any[]) ?? []), { scale }] },
        disabled ? { opacity: 0.45 } : null,
      ]}
    >
      {children}
    </APressable>
  );
}

function LiveIcon({ a, look }: { a: Attrs; look: Look }) {
  const ui = useUI();
  const name = String(a.name ?? a.icon ?? "");
  const size =
    typeof a.size === "number" ? clampN(a.size, 8, 96)! : (ICON[String(a.size ?? "md")] ?? 20);
  const color = liveColor(a.color, look) ?? look.ink;
  const fill = a.fill ? liveColor(a.fill, look) : undefined;
  const strokeWidth = num(a.strokeWidth ?? a.stroke);
  if (!name) return null;
  const host = ui.icons?.({
    name,
    size,
    color,
    label: typeof a.label === "string" ? a.label : undefined,
    ...(fill ? { fill } : {}),
    ...(strokeWidth ? { strokeWidth } : {}),
  });
  if (host) return <>{host}</>;
  return <NativeIcon name={name} size={size} color={color} />;
}

function LiveImage({ a, look }: { a: Attrs; look: Look }) {
  const src = String(a.src ?? a.url ?? a.source ?? "");
  const [failed, setFailed] = useState(!/^https:\/\//.test(src));
  const ratio = ratioOf(a.aspectRatio ?? a.ratio) ?? (a.height ? undefined : 16 / 9);
  const style = boxStyle(
    { radius: "lg", ...a, bg: a.bg ?? (failed ? "subtle" : undefined) },
    look,
    false,
    0,
  );
  return (
    <View
      style={[
        { width: "100%", overflow: "hidden", backgroundColor: look.fill },
        style,
        ratio ? { aspectRatio: ratio } : null,
      ]}
    >
      {failed ? (
        <SoftGround seed={`${a.alt ?? a.query ?? src}`} dark={look.dark} />
      ) : (
        <Image
          source={{ uri: src }}
          accessibilityLabel={typeof a.alt === "string" ? a.alt : undefined}
          resizeMode={a.fit === "contain" ? "contain" : "cover"}
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%" }}
        />
      )}
    </View>
  );
}

/**
 * Pages swiped sideways (pictures, cards): each child is a page, `peek` shows the next one's edge
 * (default for more than one page), dots under them say where you are.
 */
function Carousel({ node, a, env }: { node: El; a: Attrs; env: Env }) {
  const look = useLook();
  const [w, setW] = useState(0);
  const [at, setAt] = useState(0);
  const gap = (num(a.gap) ?? 2) * 4;
  const kids = node.children.filter((c) => c.type !== "text" || c.text.trim());
  const many = kids.length > 1 || kids.some((c) => c.type === "each");
  const share = typeof a.itemWidth === "string" && a.itemWidth.endsWith("%") ? Number.parseFloat(a.itemWidth) / 100 : undefined;
  const page = w ? Math.round(w * Math.max(0.4, Math.min(1, share ?? (a.peek === false || !many ? 1 : 0.86)))) : 0;
  const style = boxStyle({ ...a, gap: undefined }, look, false, 0);
  return (
    <View style={[{ width: "100%" }, style]} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>
      {page ? (
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={page + gap}
          snapToAlignment="start"
          disableIntervalMomentum
          onScroll={(e) => setAt(Math.round(e.nativeEvent.contentOffset.x / (page + gap)))}
          scrollEventThrottle={48}
          contentContainerStyle={{ gap, paddingRight: w - page }}
        >
          <Kids nodes={node.children} env={env} ns="view" cell={{ width: page }} />
        </ScrollView>
      ) : null}
      {a.dots !== false && many ? <Dots at={at} node={node} env={env} look={look} /> : null}
    </View>
  );
}
function Dots({ at, node, env, look }: { at: number; node: El; env: Env; look: Look }) {
  const ctx = useCtx();
  const deps = new Set<string>();
  let n = 0;
  for (const c of node.children) {
    if (c.type === "el") n++;
    else if (c.type === "each") {
      try {
        const v = ctx.program.read(c.list, env, deps);
        n += Array.isArray(v) ? v.length : typeof v === "number" ? Math.min(v, MAX_EACH) : 0;
      } catch {
        /* drawn as nothing */
      }
    }
  }
  useWatch(ctx.program, deps);
  if (n < 2) return null;
  return (
    <View style={{ flexDirection: "row", justifyContent: "center", gap: 5, marginTop: 10 }}>
      {Array.from({ length: Math.min(n, 12) }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: one dot per page
        <View key={i} style={{ width: i === at ? 14 : 6, height: 6, borderRadius: 3, backgroundColor: i === at ? look.ink : look.t.border }} />
      ))}
    </View>
  );
}

/** <map pins={[{lat, lng, label}]} value={chosen} zoom height/>: see live-map.tsx. */
function MapEl({ a, write, on, look }: { a: Attrs; write: ((v: unknown) => void) | undefined; on: Handlers; look: Look }) {
  const host = useContext(LiveHost);
  const pins = readPins(a.pins ?? a.markers ?? a.places).map((p) => (p.color ? { ...p, color: liveColor(p.color, look) ?? p.color } : p));
  const picked = num(a.value ?? a.selected ?? a.focus);
  const select = changer(write, on);
  const c = a.center && typeof a.center === "object" ? readPins([a.center])[0] : undefined;
  return (
    <LiveMap
      pins={pins}
      selected={picked !== undefined && pins[picked] ? picked : null}
      onSelect={select}
      zoom={num(a.zoom)}
      center={c ? { lat: c.lat, lng: c.lng } : undefined}
      height={clampN(num(a.height), 120, 520) ?? 220}
      tile={host.mapTile}
      ink={look.ink}
      accent={liveColor(a.color ?? "accent", look) ?? look.ink}
      surface={look.t.surface ?? "#fff"}
      muted={look.t.muted}
      radius={RADIUS[String(a.radius ?? "lg")] ?? 16}
    />
  );
}

/** <file path="/work/report.pdf"/>: the file itself, as the host draws a sent file. */
function FileEl({ a }: { a: Attrs }) {
  const host = useContext(LiveHost);
  const path = String(a.path ?? a.src ?? a.href ?? "").replace(/^sandbox:/, "");
  if (!path || !host.renderFile) return null;
  return <>{host.renderFile(path, typeof a.name === "string" ? a.name : undefined)}</>;
}

/** Where a picture would be: a quiet gradient of its own, so a mockup still looks finished. */
function SoftGround({ seed, dark }: { seed: string; dark: boolean }) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 3600;
  const hue = h % 360;
  const [from, to] = dark
    ? [`hsl(${hue}, 45%, 26%)`, `hsl(${(hue + 50) % 360}, 55%, 14%)`]
    : [`hsl(${hue}, 60%, 88%)`, `hsl(${(hue + 50) % 360}, 55%, 76%)`];
  return (
    <S.Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      <S.Defs>
        <S.LinearGradient id="soft" x1="0" y1="0" x2="1" y2="1">
          <S.Stop offset="0" stopColor={from} />
          <S.Stop offset="1" stopColor={to} />
        </S.LinearGradient>
      </S.Defs>
      <S.Rect x="0" y="0" width="100" height="100" fill="url(#soft)" />
    </S.Svg>
  );
}

function Badge({ node, a, env, look }: { node: El; a: Attrs; env: Env; look: Look }) {
  const ctx = useCtx();
  const tone = String(a.tone ?? a.color ?? a.variant ?? "default");
  const tint =
    tone === "default" || tone === "secondary" || tone === "neutral"
      ? look.t.muted
      : (liveColor(tone, look) ?? look.t.muted);
  const plain = tint === look.t.muted;
  const solid = a.solid === true || a.variant === "solid";
  const bg = solid ? tint : plain ? look.fill : withAlpha(tint, look.dark ? 0.18 : 0.12);
  const fg = solid ? (isDark(tint) ? "#fff" : "#111") : plain ? look.t.muted : tint;
  const text = typeof a.text === "string" || typeof a.text === "number" ? String(a.text) : null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        alignSelf: "flex-start",
        backgroundColor: bg,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 3,
      }}
    >
      {a.icon ? <LiveIcon a={{ name: a.icon, size: 13, color: fg }} look={look} /> : null}
      <Text
        style={{ ...textStyle({ size: "xs", weight: "medium" }, ctx, look, "xs", 500), color: fg }}
      >
        {text ?? <Kids nodes={node.children} env={env} ns="inline" />}
      </Text>
    </View>
  );
}

/** Pill buttons: primary (ink), secondary (soft), outline, ghost, danger, or any colour. */
function Button({ node, a, on, env }: { node: El; a: Attrs; on: Handlers; env: Env }) {
  const ctx = useCtx();
  const look = useLook();
  const variant = String(a.variant ?? (a.color === "secondary" ? "secondary" : "primary"));
  const size = String(a.size ?? "md");
  const h = size === "sm" ? 36 : size === "lg" ? 54 : 46;
  const custom = variant !== "secondary" ? liveColor(a.color, look) : undefined;
  const bg =
    custom && variant !== "outline" && variant !== "ghost" && variant !== "quiet"
      ? custom
      : variant === "secondary" || variant === "soft"
        ? look.fill
        : variant === "outline" ||
            variant === "ghost" ||
            variant === "quiet" ||
            variant === "plain" ||
            variant === "link"
          ? "transparent"
          : variant === "danger"
            ? look.t.danger
            : look.t.accent;
  const fg =
    variant === "outline" ||
    variant === "ghost" ||
    variant === "quiet" ||
    variant === "plain" ||
    variant === "link"
      ? (custom ?? (variant === "quiet" ? look.t.muted : look.ink))
      : bg === look.fill
        ? look.ink
        : bg === look.t.accent
          ? look.t.onAccent
          : isDark(bg)
            ? "#ffffff"
            : "#111111";
  const label = typeof a.label === "string" || typeof a.label === "number" ? String(a.label) : null;
  const icon = typeof a.icon === "string" ? a.icon : null;
  const kids = node.children.filter((c) => c.type !== "text" || c.text.trim());
  const iconOnly =
    (!label &&
      !kids.some(
        (c) => c.type === "text" || (c.type === "el" && c.name.toLowerCase() !== "icon"),
      )) ||
    a.iconOnly === true;
  const block = a.block === true || a.fill === true || a.full === true || a.width === "fill";
  const childLook = useMemo(() => ({ ...look, ink: fg }), [look, fg]);
  const style: ViewStyle = {
    height: h,
    minWidth: h,
    borderRadius: radiusOf(a.radius) ?? h / 2,
    backgroundColor: bg,
    paddingHorizontal: iconOnly
      ? 0
      : variant === "ghost" || variant === "link"
        ? 8
        : size === "sm"
          ? 14
          : 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flexShrink: 0.01,
    ...(variant === "outline" ? { borderWidth: 1, borderColor: custom ?? look.t.border } : {}),
    ...(block
      ? { alignSelf: "stretch", flexGrow: 1 }
      : { alignSelf: a.self === "stretch" ? "stretch" : "flex-start" }),
    ...(a.flex !== undefined ? { flexGrow: num(a.flex) ?? 1, flexBasis: 0 } : {}),
  };
  const textS = {
    ...textStyle({ size: size === "sm" ? "sm" : "md", weight: "semibold" }, ctx, look, "md", 600),
    color: fg,
    lineHeight: undefined,
  };
  const press = on.onPress;
  return (
    <Press
      style={style}
      onPress={press}
      disabled={a.disabled === true}
      label={label ?? (typeof a.ariaLabel === "string" ? a.ariaLabel : (icon ?? undefined))}
    >
      <LookCtx.Provider value={childLook}>
        {icon ? (
          <LiveIcon a={{ name: icon, size: size === "sm" ? 16 : 18, color: fg }} look={childLook} />
        ) : null}
        {label !== null ? (
          <Text numberOfLines={1} style={textS}>
            {label}
          </Text>
        ) : (
          <ButtonKids nodes={node.children} env={env} textStyle={textS} />
        )}
      </LookCtx.Provider>
    </Press>
  );
}
/** A button's children: icons as they are, words in the button's text style. */
function ButtonKids({
  nodes,
  env,
  textStyle: ts,
}: {
  nodes: Node[];
  env: Env;
  textStyle: TextStyle;
}) {
  const look = useLook();
  return (
    <>
      {nodes.map((n, i) => {
        if (n.type === "el" && n.name.toLowerCase() === "icon")
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed children
          return <IconChild key={i} node={n} env={env} look={look} />;
        if (n.type === "text" && !n.text.trim()) return null;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed children
          <Text key={i} numberOfLines={1} style={ts}>
            <LiveNode node={n} env={env} ns="inline" />
          </Text>
        );
      })}
    </>
  );
}
function IconChild({ node, env, look }: { node: El; env: Env; look: Look }) {
  const ctx = useCtx();
  const deps = new Set<string>();
  const { a } = evalAttrs(node, env, ctx, deps);
  useWatch(ctx.program, deps);
  return <LiveIcon a={{ size: 18, ...a }} look={look} />;
}

/** A field that would take a password, a code or a card: secure entry or such an autofill. */
function asksForSecret(a: Record<string, unknown>): boolean {
  const kind =
    `${a.type ?? ""} ${a.autofill ?? ""} ${a.autoComplete ?? ""} ${a.textContentType ?? ""}`.toLowerCase();
  return (
    a.secure === true ||
    a.secureTextEntry === true ||
    /password|one-time-code|otp|cc-number|credit-card/.test(kind)
  );
}

/** A filled field; `label` sits above. */
function Field({ a, on, write }: { a: Attrs; on: Handlers; write?: (v: unknown) => void }) {
  const ctx = useCtx();
  const look = useLook();
  const [focused, setFocused] = useState(false);
  const [current, change] = useControl(a.value, changer(write, on));
  const value = current === undefined || current === null ? "" : show(current);
  const label = typeof a.label === "string" ? a.label : null;
  const big = a.size === "lg";
  const style = textStyle({ size: big ? "lg" : "md" }, ctx, look, "md");
  const keyboard =
    a.keyboard === "number" || a.type === "number"
      ? "decimal-pad"
      : a.keyboard === "email" || a.type === "email"
        ? "email-address"
        : "default";
  return (
    <View
      style={{
        gap: 6,
        alignSelf: "stretch",
        flexShrink: 1,
        ...(a.flex !== undefined ? { flexGrow: num(a.flex) ?? 1, flexBasis: 0 } : {}),
      }}
    >
      {label ? (
        <Text style={textStyle({ size: "sm", color: "muted" }, ctx, look, "sm")}>{label}</Text>
      ) : null}
      <TextInput
        value={value}
        onChangeText={(t) =>
          change?.(
            a.type === "number" || a.keyboard === "number"
              ? t === ""
                ? ""
                : Number.isFinite(Number(t))
                  ? Number(t)
                  : t
              : t,
          )
        }
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={on.onSubmit ? () => on.onSubmit?.(value) : undefined}
        editable={a.disabled !== true}
        placeholder={typeof a.placeholder === "string" ? a.placeholder : undefined}
        placeholderTextColor={withAlpha(look.t.muted, 0.7)}
        secureTextEntry={a.secure === true || a.type === "password"}
        multiline={a.multiline === true}
        keyboardType={keyboard}
        maxLength={clampN(num(a.maxLength), 0, 100000)}
        accessibilityLabel={
          label ?? (typeof a.placeholder === "string" ? a.placeholder : undefined)
        }
        style={{
          ...style,
          lineHeight: a.multiline ? style.lineHeight : undefined,
          minHeight: a.multiline ? 96 : big ? 54 : 48,
          paddingHorizontal: 16,
          paddingVertical: a.multiline ? 12 : 0,
          textAlignVertical: a.multiline ? "top" : "center",
          borderRadius: radiusOf(a.radius) ?? 14,
          backgroundColor: liveColor(a.bg, look) ?? look.fill,
          borderWidth: 1.5,
          borderColor: focused ? withAlpha(look.t.muted, 0.6) : "transparent",
        }}
      />
    </View>
  );
}

function LiveSlider({ a, on, write }: { a: Attrs; on: Handlers; write?: (v: unknown) => void }) {
  const ctx = useCtx();
  const look = useLook();
  const lock = useGestureLock();
  const [current, change] = useControl(a.value, changer(write, on));
  const min = clampN(num(a.min), -1e9, 1e9) ?? 0;
  const top = clampN(num(a.max), -1e9, 1e9) ?? 100;
  const max = top > min ? top : min + 1;
  const asked = num(a.step);
  // Not more steps than a track has room for, and never none.
  const step = Math.max(
    asked && asked > 0 ? asked : max - min <= 2 ? 0.01 : 1,
    (max - min) / 10000,
  );
  const value = Math.min(max, Math.max(min, Number(current ?? min) || min));
  const color = liveColor(a.color, look) ?? look.t.accent;
  const label = typeof a.label === "string" ? a.label : null;
  const decimals = Math.min(4, (String(asked ?? step).split(".")[1] ?? "").length);
  const disabled = a.disabled === true;
  const track = look.dark ? withAlpha("#ffffff", 0.18) : withAlpha("#000000", 0.12);

  // Under a finger the native track moves by itself, so it is not drawn again. What depends on the
  // value is told the newest value as soon as the last one has been drawn, so nothing queues up:
  // a fast phone follows every step, a slow one skips some and never lags behind the finger.
  const sliding = useRef(false);
  const held = useRef(value);
  if (!sliding.current) held.current = value;
  const send = useRef(change);
  send.current = change;
  const latest = useRef<number | null>(null);
  const sentAt = useRef(0);
  const flush = useCallback((force = false) => {
    if (latest.current === null) return;
    // A change that drew nothing sets no effect off, so waiting has a limit.
    if (!force && sentAt.current && performance.now() - sentAt.current < 250) return;
    const v = latest.current;
    latest.current = null;
    sentAt.current = performance.now();
    send.current?.(v);
  }, []);
  // After every drawing of this slider, which each value it was told leads to.
  useEffect(() => {
    sentAt.current = 0;
    flush();
  });
  const thumb = useMemo(
    () => (
      <Slider
        value={held.current}
        minimumValue={min}
        maximumValue={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => {
          latest.current = Math.round(v * 1e6) / 1e6;
          flush();
        }}
        onSlidingStart={() => {
          sliding.current = true;
          lock(true);
        }}
        onSlidingComplete={(v) => {
          latest.current = Math.round(v * 1e6) / 1e6;
          flush(true);
          sliding.current = false;
          lock(false);
        }}
        minimumTrackTintColor={color}
        maximumTrackTintColor={track}
        thumbTintColor={color}
        accessibilityLabel={label ?? undefined}
        style={{ height: 36, marginHorizontal: Platform.OS === "android" ? -12 : 0 }}
      />
    ),
    // biome-ignore lint/correctness/useExhaustiveDependencies: held.current changes only when the value does and no finger is down
    [held.current, min, max, step, disabled, color, track, label, flush, lock],
  );
  return (
    <View
      style={{
        alignSelf: "stretch",
        gap: 2,
        ...(a.flex !== undefined ? { flexGrow: num(a.flex) ?? 1 } : {}),
      }}
    >
      {label ? (
        <View style={{ flexDirection: "row", alignItems: "baseline" }}>
          <Text style={[textStyle({ size: "sm", color: "muted" }, ctx, look, "sm"), { flex: 1 }]}>
            {label}
          </Text>
          {a.showValue === false ? null : (
            <Text
              style={textStyle(
                { size: "sm", weight: "semibold", tabularNums: true },
                ctx,
                look,
                "sm",
                600,
              )}
            >
              {value.toFixed(decimals)}
              {typeof a.unit === "string" ? a.unit : ""}
            </Text>
          )}
        </View>
      ) : null}
      {thumb}
    </View>
  );
}

/** A round check (or a switch) with its label. */
function Check({
  a,
  on,
  write,
  node,
  env,
}: {
  a: Attrs;
  on: Handlers;
  write?: (v: unknown) => void;
  node: El;
  env: Env;
}) {
  const ctx = useCtx();
  const look = useLook();
  const [current, change] = useControl(a.value ?? a.checked, changer(write, on));
  const value = Boolean(current);
  const toggle = () => change(!value);
  const label = typeof a.label === "string" || typeof a.label === "number" ? String(a.label) : null;
  const hasKids = node.children.some((c) => c.type !== "text" || c.text.trim());
  const color = liveColor(a.color, look) ?? look.t.accent;
  const words =
    label !== null || hasKids ? (
      <Text
        style={[
          textStyle(
            {
              size: a.size ?? "md",
              color:
                value &&
                a.strike !== false &&
                a.variant !== "switch" &&
                a.done !== false &&
                a.strikeDone
                  ? "muted"
                  : undefined,
            },
            ctx,
            look,
            "md",
          ),
          // Beside a switch the words push it to the far edge; beside a check they just take their room.
          a.variant === "switch" ? { flexGrow: 1, flexShrink: 1 } : { flexShrink: 1 },
          value && a.strikeDone ? { textDecorationLine: "line-through" } : null,
        ]}
      >
        {label ?? <Kids nodes={node.children} env={env} ns="inline" />}
      </Text>
    ) : null;
  if (a.variant === "switch") {
    return (
      <Press
        role="switch"
        selected={value}
        onPress={toggle}
        disabled={a.disabled === true}
        label={label ?? undefined}
        scaleTo={0.99}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          minHeight: 44,
          flexShrink: 1,
          alignSelf: words ? "stretch" : "flex-start",
        }}
      >
        {words}
        <Toggle on={value} color={color} look={look} />
      </Press>
    );
  }
  return (
    <Press
      role="checkbox"
      selected={value}
      onPress={toggle}
      disabled={a.disabled === true}
      label={label ?? undefined}
      scaleTo={0.98}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 40,
        flexShrink: 1,
        alignSelf: words ? "stretch" : "flex-start",
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: a.shape === "square" ? 7 : 12,
          borderWidth: 2,
          borderColor: value ? color : withAlpha(look.t.muted, 0.6),
          backgroundColor: value ? color : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {value ? (
          <NativeIcon
            name="check"
            size={15}
            color={color === look.t.accent ? look.t.onAccent : isDark(color) ? "#fff" : "#111"}
          />
        ) : null}
      </View>
      {words}
    </Press>
  );
}
function Toggle({ on, color, look }: { on: boolean; color: string; look: Look }) {
  const v = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(v, {
      toValue: on ? 1 : 0,
      useNativeDriver: true,
      speed: 28,
      bounciness: 4,
    }).start();
  }, [on, v]);
  return (
    <View
      style={{
        width: 50,
        height: 30,
        borderRadius: 15,
        backgroundColor: look.dark ? withAlpha("#ffffff", 0.2) : withAlpha("#000000", 0.14),
        justifyContent: "center",
      }}
    >
      <Animated.View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: 15,
          backgroundColor: color,
          opacity: v,
        }}
      />
      <Animated.View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          marginLeft: 2,
          backgroundColor: color === look.t.accent ? look.t.onAccent : "#ffffff",
          ...(on ? {} : { backgroundColor: "#ffffff" }),
          elevation: 2,
          shadowColor: "#000",
          shadowOpacity: 0.2,
          shadowRadius: 2,
          shadowOffset: { width: 0, height: 1 },
          transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }],
        }}
      />
    </View>
  );
}

type Option = { label: string; value: unknown; icon?: string };
function optionsOf(v: unknown, node: El, env: Env, ctx: Ctx): Option[] {
  if (Array.isArray(v))
    return v.slice(0, 40).map((o) =>
      isPlainObject(o)
        ? {
            label: show(o.label ?? o.title ?? o.text ?? o.value),
            value: o.value ?? o.label,
            ...(typeof o.icon === "string" ? { icon: o.icon } : {}),
          }
        : { label: show(o), value: o },
    );
  // <option value="a">A</option> children
  return node.children
    .filter((c): c is El => c.type === "el" && /^(option|item)$/i.test(c.name))
    .map((c) => {
      const attrs: Record<string, unknown> = {};
      for (const at of c.attrs) {
        if (at.kind === "expr") {
          try {
            attrs[at.name] = ctx.program.read(String(at.value), env);
          } catch {}
        } else attrs[at.name] = at.value;
      }
      const text = c.children
        .map((t) => (t.type === "text" ? t.text : ""))
        .join("")
        .trim();
      return {
        label: show(attrs.label ?? text ?? attrs.value),
        value: attrs.value ?? text,
        ...(typeof attrs.icon === "string" ? { icon: attrs.icon } : {}),
      };
    });
}
/** One of a few: segmented (default), chips, or a list with checks. */
function Choice({
  a,
  on,
  write,
  node,
}: {
  a: Attrs;
  on: Handlers;
  write?: (v: unknown) => void;
  node: El;
}) {
  const ctx = useCtx();
  const look = useLook();
  const options = optionsOf(a.options ?? a.items, node, ctx.program.root, ctx);
  const [current, change] = useControl(a.value, changer(write, on));
  const selected = options.findIndex((o) => o.value === current || show(o.value) === show(current));
  const label = typeof a.label === "string" ? a.label : null;
  const variant = String(a.variant ?? (options.length <= 4 ? "segmented" : "chips"));
  const head = label ? (
    <Text style={textStyle({ size: "sm", color: "muted" }, ctx, look, "sm")}>{label}</Text>
  ) : null;
  if (variant === "chips" || variant === "pills") {
    return (
      <View style={{ gap: 6 }}>
        {head}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {options.map((o, i) => {
            const on_ = i === selected;
            return (
              <Press
                key={`${i}${o.label}`}
                role="radio"
                selected={on_}
                onPress={() => change(o.value)}
                label={o.label}
                style={{
                  height: 38,
                  paddingHorizontal: 16,
                  borderRadius: 19,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  backgroundColor: on_ ? look.t.accent : "transparent",
                  borderWidth: 1,
                  borderColor: on_ ? look.t.accent : look.t.border,
                }}
              >
                {o.icon ? (
                  <LiveIcon
                    a={{ name: o.icon, size: 15, color: on_ ? look.t.onAccent : look.ink }}
                    look={look}
                  />
                ) : null}
                <Text
                  style={{
                    ...textStyle(
                      { size: "sm", weight: on_ ? "semibold" : "medium" },
                      ctx,
                      look,
                      "sm",
                    ),
                    color: on_ ? look.t.onAccent : look.ink,
                  }}
                >
                  {o.label}
                </Text>
              </Press>
            );
          })}
        </View>
      </View>
    );
  }
  if (variant === "list" || variant === "radio" || variant === "dropdown") {
    return (
      <View style={{ gap: 6 }}>
        {head}
        <View style={{ borderRadius: 14, overflow: "hidden", backgroundColor: look.fill }}>
          {options.map((o, i) => (
            <Press
              key={`${i}${o.label}`}
              role="radio"
              selected={i === selected}
              onPress={() => change(o.value)}
              label={o.label}
              scaleTo={0.99}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 16,
                minHeight: 48,
                borderTopWidth: i ? StyleSheet.hairlineWidth : 0,
                borderColor: look.t.border,
              }}
            >
              <Text style={[textStyle({}, ctx, look, "md"), { flex: 1 }]}>{o.label}</Text>
              {i === selected ? <NativeIcon name="check" size={18} color={look.ink} /> : null}
            </Press>
          ))}
        </View>
      </View>
    );
  }
  return (
    <Segmented
      head={head}
      options={options}
      selected={selected}
      change={change}
      size={String(a.size ?? "md")}
    />
  );
}
function Segmented({
  head,
  options,
  selected,
  change,
  size,
}: {
  head: ReactNode;
  options: Option[];
  selected: number;
  change: (v: unknown) => void;
  size: string;
}) {
  const ctx = useCtx();
  const look = useLook();
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const n = Math.max(1, options.length);
  const segW = width ? (width - 6) / n : 0;
  const first = useRef(true);
  useEffect(() => {
    if (!segW || selected < 0) return;
    if (first.current) {
      x.setValue(selected * segW);
      first.current = false;
    } else
      Animated.spring(x, {
        toValue: selected * segW,
        useNativeDriver: true,
        speed: 22,
        bounciness: 3,
      }).start();
  }, [selected, segW, x]);
  const h = size === "sm" ? 34 : size === "lg" ? 46 : 40;
  return (
    <View style={{ gap: 6, alignSelf: "stretch" }}>
      {head}
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{
          flexDirection: "row",
          padding: 3,
          borderRadius: h / 2 + 3,
          backgroundColor: look.dark ? withAlpha("#ffffff", 0.07) : withAlpha("#000000", 0.05),
        }}
      >
        {segW && selected >= 0 ? (
          <Animated.View
            style={{
              position: "absolute",
              top: 3,
              left: 3,
              width: segW,
              height: h,
              borderRadius: h / 2,
              backgroundColor: look.dark ? withAlpha("#ffffff", 0.16) : "#ffffff",
              elevation: look.dark ? 0 : 1,
              shadowColor: "#000",
              shadowOpacity: look.dark ? 0 : 0.08,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
              transform: [{ translateX: x }],
            }}
          />
        ) : null}
        {options.map((o, i) => (
          <Pressable
            key={`${i}${o.label}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: i === selected }}
            accessibilityLabel={o.label}
            onPress={() => change(o.value)}
            style={{
              flex: 1,
              height: h,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 6,
            }}
          >
            {o.icon ? (
              <LiveIcon
                a={{ name: o.icon, size: 15, color: i === selected ? look.ink : look.t.muted }}
                look={look}
              />
            ) : null}
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={{
                ...textStyle(
                  { size: "sm", weight: i === selected ? "semibold" : "medium" },
                  ctx,
                  look,
                  "sm",
                ),
                color: i === selected ? look.ink : look.t.muted,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Progress({ a, look }: { a: Attrs; look: Look }) {
  const ctx = useCtx();
  const max = num(a.max) ?? 100;
  const value = Number(a.value) || 0;
  const ratio = Math.max(0, Math.min(1, value / (max || 1)));
  const color = liveColor(a.color, look) ?? look.t.accent;
  const h = num(a.height) ?? (a.size === "sm" ? 4 : a.size === "lg" ? 10 : 8);
  const anim = useRef(new Animated.Value(ratio)).current;
  useEffect(() => {
    Animated.spring(anim, {
      toValue: ratio,
      useNativeDriver: true,
      speed: 14,
      bounciness: 0,
    }).start();
  }, [ratio, anim]);
  const label = typeof a.label === "string" ? a.label : null;
  return (
    <View style={{ gap: 6, alignSelf: "stretch" }}>
      {label || a.showValue ? (
        <View style={{ flexDirection: "row" }}>
          <Text style={[textStyle({ size: "sm", color: "muted" }, ctx, look, "sm"), { flex: 1 }]}>
            {label ?? ""}
          </Text>
          {a.showValue === false ? null : (
            <Text
              style={textStyle(
                { size: "sm", weight: "semibold", tabularNums: true },
                ctx,
                look,
                "sm",
                600,
              )}
            >{`${Math.round(ratio * 100)}%`}</Text>
          )}
        </View>
      ) : null}
      <View
        style={{
          height: h,
          borderRadius: h / 2,
          overflow: "hidden",
          backgroundColor: look.dark ? withAlpha("#ffffff", 0.12) : withAlpha("#000000", 0.08),
        }}
      >
        <Animated.View
          style={{
            height: h,
            borderRadius: h / 2,
            backgroundColor: color,
            transformOrigin: "left",
            transform: [{ scaleX: anim }],
          }}
        />
      </View>
    </View>
  );
}

// ── SVG ─────────────────────────────────────────────────────────────────────────────────────────

function LiveSvg({ node, a, env }: { node: El; a: Attrs; env: Env }) {
  const look = useLook();
  const box = safeViewBox(a.viewBox);
  const vw = box?.[2] ?? clampN(num(a.width), 1, 4000) ?? 100;
  const vh = box?.[3] ?? clampN(num(a.height), 1, 4000) ?? 100;
  // The view's size is the size of the picture the native side paints into, so it stays sane.
  const ratio = Math.max(0.2, Math.min(8, vw / vh));
  const fixedW = String(a.width ?? "").endsWith("%") ? undefined : clampN(num(a.width ?? a.size), 1, 1600);
  const fixedH = clampN(num(a.height), 1, 1600);
  const style: VS = fixedW
    ? { width: fixedW, height: fixedH ?? Math.min(1600, fixedW / ratio), maxWidth: "100%" }
    : { width: "100%", aspectRatio: ratio };
  if (a.maxWidth) style.maxWidth = length(a.maxWidth);
  if (a.self === "center" || a.align === "center") style.alignSelf = "center";
  const aspect = safeSvgProps(
    "svg",
    { preserveAspectRatio: a.preserveAspectRatio },
    () => undefined,
  );
  const rule = aspect?.preserveAspectRatio as string | undefined;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const labelled = holdsLabels(node.children);
  // Labels that would land on each other are moved clear (see label-board.ts).
  const [board] = useState(() => new LabelBoard(0, 0));
  if (size) board.resize(size.w, size.h);
  const labels = useMemo<LabelScope | null>(() => {
    if (!labelled || !size) return null;
    const m = viewBoxMatrix(box ?? [0, 0, vw, vh], size.w, size.h, rule);
    return { m, vw, vh, inherited: labelStyle(a), board };
    // biome-ignore lint/correctness/useExhaustiveDependencies: the attributes are read through their text form below
  }, [labelled, size?.w, size?.h, box?.join(), vw, vh, rule, JSON.stringify(labelStyle(a))]);
  return (
    <View
      style={style}
      accessible={typeof a.alt === "string" || typeof a.label === "string"}
      accessibilityRole="image"
      accessibilityLabel={
        typeof a.alt === "string" ? a.alt : typeof a.label === "string" ? a.label : undefined
      }
      onLayout={
        labelled
          ? (e) => {
              const { width, height } = e.nativeEvent.layout;
              setSize((old) =>
                old && old.w === width && old.h === height ? old : { w: width, h: height },
              );
            }
          : undefined
      }
    >
      <S.Svg
        width="100%"
        height="100%"
        viewBox={box ? box.join(" ") : `0 0 ${vw} ${vh}`}
        preserveAspectRatio={rule}
        color={look.ink}
        fill={look.ink}
      >
        <Kids nodes={node.children} env={env} ns="svg" />
      </S.Svg>
      {labels ? (
        <View
          pointerEvents="box-none"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden" }}
        >
          <LabelCtx.Provider value={labels}>
            <Kids nodes={node.children} env={env} ns="labels" />
          </LabelCtx.Provider>
        </View>
      ) : null}
    </View>
  );
}

// ── words in a drawing ──────────────────────────────────────────────────────────────────────────
//
// react-native-svg turns text into glyph paths on the UI thread, about 70ms a label on a low-end
// phone, and draws them all again whenever anything in the picture changes. So the words of a
// drawing are ordinary text in a layer above it, placed where the drawing's coordinates say. A
// label that changes then doesn't repaint the picture, and it uses the app's real font.

/** A text path needs the native text; everything else goes in the layer. */
const isLabel = (n: El) =>
  n.name.toLowerCase() === "text" &&
  !n.children.some((c) => c.type === "el" && c.name.toLowerCase() === "textpath");

const labelsIn = new WeakMap<Node[], boolean>();
/** Whether these nodes draw any words, so a drawing without them has no layer at all. */
function holdsLabels(nodes: Node[]): boolean {
  const seen = labelsIn.get(nodes);
  if (seen !== undefined) return seen;
  const found = nodes.some((n) => {
    if (n.type === "el") {
      const tag = n.name.toLowerCase();
      if (tag === "text") return isLabel(n);
      return (tag === "g" || tag === "svg" || tag === "a") && holdsLabels(n.children);
    }
    if (n.type === "each") return holdsLabels(n.children);
    if (n.type === "if") return holdsLabels(n.yes) || holdsLabels(n.else);
    return false;
  });
  labelsIn.set(nodes, found);
  return found;
}

type LabelScope = {
  /** User space to view space. */
  m: Matrix;
  /** The viewBox's size, for percentages. */
  vw: number;
  vh: number;
  /** Text attributes set on a surrounding group. */
  inherited: Attrs;
  /** Keeps this drawing's labels off each other. */
  board?: LabelBoard;
};
const LabelCtx = createContext<LabelScope>({ m: IDENTITY, vw: 100, vh: 100, inherited: {} });

const INHERITED =
  /^(fill|font-?size|font-?weight|font-?style|font-?family|text-?anchor|dominant-?baseline|alignment-?baseline|letter-?spacing|text-?decoration|fill-?opacity)$/i;
function labelStyle(a: Attrs): Attrs {
  const out: Attrs = {};
  for (const k of Object.keys(a)) if (INHERITED.test(k)) out[k] = a[k];
  return out;
}

/** A group passes on its transform, its opacity and its text attributes. */
function SvgLabelGroup({ node, env }: { node: El; env: Env }) {
  const ctx = useCtx();
  const outer = useContext(LabelCtx);
  const deps = new Set<string>();
  const { a } = evalAttrs(node, env, ctx, deps);
  useWatch(ctx.program, deps);
  const local = parseTransform(a.transform);
  const style = labelStyle(a);
  const opacity = num(a.opacity);
  if (opacity !== undefined)
    style.opacity = opacity * ((outer.inherited.opacity as number | undefined) ?? 1);
  const styleKey = JSON.stringify(style);
  const key = local?.join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: compared by their text form
  const scope = useMemo<LabelScope>(
    () => ({
      ...outer,
      m: local ? multiply(outer.m, local) : outer.m,
      inherited: { ...outer.inherited, ...style },
    }),
    [outer, key, styleKey],
  );
  return (
    <LabelCtx.Provider value={scope}>
      <Kids nodes={node.children} env={env} ns="labels" />
    </LabelCtx.Provider>
  );
}

type LabelRun = { text: string; style?: TS };
type LabelLine = { x: number; y: number; runs: LabelRun[] };
/** Wide enough for any label, and how far the baseline sits below the top of its line. */
const LABEL_BOX = 1200;
const baselineIn = (line: number, font: number) => line / 2 + font * 0.36;

function SvgLabel({ node, env }: { node: El; env: Env }) {
  liveStats.draws++;
  const ctx = useCtx();
  const look = useLook();
  const scope = useContext(LabelCtx);
  const deps = new Set<string>();
  const { a, on } = evalAttrs(node, env, ctx, deps);
  const merged = { ...scope.inherited, ...a };
  const color = (v: unknown) => liveColor(v, look, true);
  const props = safeSvgProps("text", merged, color) ?? {};
  const local = parseTransform(a.transform);
  const m = local ? multiply(scope.m, local) : scope.m;
  const scale = Math.hypot(m[0], m[1]) || 1;
  const size = (typeof props.fontSize === "number" ? props.fontSize : 12) as number;
  const coord = (v: unknown, whole: number) =>
    typeof v === "string" && v.endsWith("%")
      ? (Number.parseFloat(v) / 100) * whole
      : ((v as number) ?? 0);
  const em = (v: unknown) =>
    typeof v === "string" && /em$/.test(v.trim()) ? Number.parseFloat(v) * size : (num(v) ?? 0);
  const lines: LabelLine[] = [
    {
      x: coord(props.x, scope.vw) + em(a.dx),
      y: coord(props.y, scope.vh) + em(a.dy),
      runs: [],
    },
  ];
  // Words and spans in order; a span with its own position starts a new line of its own.
  const walk = (nodes: Node[], scoped: Env, style?: TS) => {
    for (const n of nodes) {
      if (n.type === "text") {
        const words = splitText(n.text)
          .map((p) => (typeof p === "string" ? p : show(safeRead(ctx, p.expr, scoped, deps))))
          .join("")
          .replace(/\s+/g, " ");
        if (words.trim()) (lines[lines.length - 1] as LabelLine).runs.push({ text: words, style });
      } else if (n.type === "if") {
        walk(safeRead(ctx, n.cond, scoped, deps) ? n.yes : n.else, scoped, style);
      } else if (n.type === "each") {
        const items = safeRead(ctx, n.list, scoped, deps);
        (Array.isArray(items) ? items.slice(0, MAX_EACH) : []).forEach((item, i) => {
          walk(n.children, rowScope(scoped, n, item, i), style);
        });
      } else if (n.type === "el" && n.name.toLowerCase() === "tspan") {
        const own = evalAttrs(n, scoped, ctx, deps).a;
        const span = safeSvgProps("tspan", own, color) ?? {};
        const last = lines[lines.length - 1] as LabelLine;
        if (own.x !== undefined || own.y !== undefined || own.dy !== undefined)
          lines.push({
            x: own.x !== undefined ? coord(span.x, scope.vw) : (lines[0]?.x ?? 0),
            y: (own.y !== undefined ? coord(span.y, scope.vh) : last.y) + em(own.dy),
            runs: [],
          });
        walk(n.children, scoped, { ...style, ...labelSpan(span, ctx) });
      }
    }
  };
  walk(node.children, env);
  useWatch(ctx.program, deps);
  const font = Math.max(1, Math.round(size * scale * 10) / 10);
  const lineHeight = Math.ceil(font * 1.3);
  const anchor = props.textAnchor === "middle" ? 0.5 : props.textAnchor === "end" ? 1 : 0;
  const baseline = String(props.alignmentBaseline ?? "");
  const down = /^(middle|central|center)$/.test(baseline)
    ? lineHeight / 2
    : /^(hanging|top|text-top|before-edge|text-before-edge)$/.test(baseline)
      ? baselineIn(lineHeight, font) - font * 0.8
      : baselineIn(lineHeight, font);
  const degrees = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  const opacity =
    ((merged.opacity as number | undefined) ?? 1) *
    ((props.fillOpacity as number | undefined) ?? 1);
  const base: TS = {
    position: "absolute",
    width: LABEL_BOX,
    fontSize: font,
    lineHeight,
    color: (typeof props.fill === "string" &&
    !props.fill.startsWith("url(") &&
    props.fill !== "none"
      ? props.fill
      : look.ink) as string,
    textAlign: anchor === 0.5 ? "center" : anchor === 1 ? "right" : "left",
    ...labelSpan(props, ctx),
    ...(opacity < 1 ? { opacity } : {}),
  };
  const placed = lines.map((line) => {
    const [px, py] = transformPoint(m, line.x, line.y);
    const runs = line.runs.map((r, k, all) => {
      const text = k === 0 ? r.text.trimStart() : r.text;
      return { ...r, text: k === all.length - 1 ? text.trimEnd() : text };
    });
    return { px, py, runs };
  });
  // The box these words take, for the board (turned words keep their place).
  const id = useId();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const board = scope.board;
  useEffect(() => board?.subscribe(id, redraw), [board, id]);
  let box: { x: number; y: number; w: number; h: number } | null = null;
  if (board && Math.abs(degrees) <= 0.01) {
    for (const l of placed) {
      if (!l.runs.length) continue;
      const w = labelWidth(l.runs.map((r) => r.text).join(""), font);
      const x = l.px - w * anchor;
      const y = l.py - down;
      if (!box) box = { x, y, w, h: lineHeight };
      else {
        const x1 = Math.max(box.x + box.w, x + w);
        const y1 = Math.max(box.y + box.h, y + lineHeight);
        box.x = Math.min(box.x, x);
        box.y = Math.min(box.y, y);
        box.w = x1 - box.x;
        box.h = y1 - box.y;
      }
    }
  }
  const boxKey = box ? `${box.x.toFixed(1)},${box.y.toFixed(1)},${box.w.toFixed(1)},${box.h.toFixed(1)}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: the box is compared by its text form
  useEffect(() => { board?.set(id, box); }, [board, id, boxKey]);
  const shift = board?.shift(id) ?? { dx: 0, dy: 0 };
  return (
    <>
      {placed.map(({ px: x0, py: y0, runs }, i) => {
        if (!runs.length) return null;
        const px = x0 + shift.dx;
        const py = y0 + shift.dy;
        return (
          <Text
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are in a fixed order
            key={i}
            numberOfLines={1}
            allowFontScaling={false}
            onPress={on.onPress ? () => on.onPress?.() : undefined}
            pointerEvents={on.onPress ? "auto" : "none"}
            style={{
              ...base,
              left: px - LABEL_BOX * anchor,
              top: py - down,
              ...(Math.abs(degrees) > 0.01
                ? {
                    transform: [{ rotate: `${degrees}deg` }],
                    transformOrigin: [LABEL_BOX * anchor, down, 0],
                  }
                : {}),
            }}
          >
            {runs.map((r, k) =>
              r.style ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: runs are in a fixed order
                <Text key={k} style={r.style}>
                  {r.text}
                </Text>
              ) : (
                r.text
              ),
            )}
          </Text>
        );
      })}
    </>
  );
}

/** What a text or span in a drawing changes about the words, from its checked attributes. */
function labelSpan(p: Record<string, unknown>, ctx: Ctx): TS {
  const s: TS = {};
  if (typeof p.fill === "string" && !p.fill.startsWith("url(") && p.fill !== "none")
    s.color = p.fill;
  const w = typeof p.fontWeight === "string" ? Number(p.fontWeight) : 0;
  if (w) {
    const step = w >= 650 ? 700 : w >= 550 ? 600 : w >= 450 ? 500 : 400;
    const file = step === 400 ? ctx.ty.body.nativeFamily : ctx.ty.weights?.[step];
    if (file) s.fontFamily = file;
    else if (step !== 400) s.fontWeight = String(step) as TextStyle["fontWeight"];
  } else if (ctx.ty.body.nativeFamily) s.fontFamily = ctx.ty.body.nativeFamily;
  if (p.fontFamily === "monospace") s.fontFamily = Platform.OS === "ios" ? "Menlo" : "monospace";
  if (p.fontStyle === "italic" || p.fontStyle === "oblique") s.fontStyle = "italic";
  if (p.textDecoration === "underline" || p.textDecoration === "line-through")
    s.textDecorationLine = p.textDecoration;
  if (typeof p.letterSpacing === "number") s.letterSpacing = p.letterSpacing;
  return s;
}

function svgEl(
  tag: string,
  node: El,
  a: Attrs,
  on: Handlers,
  env: Env,
  look: Look,
  ctx: Ctx,
  deps: Set<string>,
): ReactNode {
  // A drawing inside a drawing is drawn as a group.
  const name = tag === "svg" ? "g" : tag;
  const C = SVG_ELEMENTS.has(name) ? SVG_TAGS[name] : undefined;
  // Anything else inside a drawing (HTML, unknown tags) is not drawn.
  if (!C) return null;
  const props = safeSvgProps(name, a, (v) => liveColor(v, look, true));
  if (!props) return null;
  if (name === "text" || name === "tspan") {
    if (props.fill === undefined && name === "text") props.fill = look.ink;
    if (props.fontSize === undefined && name === "text") props.fontSize = 12;
    if (props.fontFamily === undefined && ctx.ty.body.nativeFamily)
      props.fontFamily = ctx.ty.body.nativeFamily;
  }
  if (on.onPress) props.onPress = () => on.onPress?.();
  // react-native-svg reads these straight off their children, so nothing can sit in between.
  if (name === "text" || name === "tspan" || name === "textpath") {
    const words = svgInline(node.children, env, look, ctx, deps);
    return <C {...props}>{words.length === 1 ? words[0] : words}</C>;
  }
  if (name === "lineargradient" || name === "radialgradient")
    return <C {...props}>{svgInline(node.children, env, look, ctx, deps)}</C>;
  if (name === "stop") return <C {...props} />;
  const kids = node.children.length ? (
    <Kids
      nodes={name === "marker" ? withoutMarkers(node.children) : node.children}
      env={env}
      ns="svg"
    />
  ) : undefined;
  return <C {...props}>{kids}</C>;
}

const MARKER_ATTR = /^marker-?(start|mid|end)$/i;
const unmarked = new WeakMap<Node[], Node[]>();
/** What a marker holds, without markers of its own: one that refers to itself would draw forever. */
function withoutMarkers(nodes: Node[]): Node[] {
  const seen = unmarked.get(nodes);
  if (seen) return seen;
  const out = nodes.map((n): Node => {
    if (n.type === "el")
      return {
        ...n,
        attrs: n.attrs.filter((x) => !MARKER_ATTR.test(x.name)),
        children: withoutMarkers(n.children),
      };
    if (n.type === "each") return { ...n, children: withoutMarkers(n.children) };
    if (n.type === "if") return { ...n, yes: withoutMarkers(n.yes), else: withoutMarkers(n.else) };
    return n;
  });
  unmarked.set(nodes, out);
  return out;
}

/**
 * The inside of an SVG text or gradient. react-native-svg reads strings and stops straight off its
 * children, so they cannot sit behind components: they are worked out here, for the holder.
 */
function svgInline(nodes: Node[], env: Env, look: Look, ctx: Ctx, deps: Set<string>): ReactNode[] {
  const out: ReactNode[] = [];
  const walk = (list: Node[], scope: Env) => {
    for (const n of list) {
      if (n.type === "text") {
        const s = splitText(n.text)
          .map((p) => (typeof p === "string" ? p : show(safeRead(ctx, p.expr, scope, deps))))
          .join("")
          .replace(/\s+/g, " ")
          .trim();
        if (s) out.push(s);
      } else if (n.type === "if") {
        walk(safeRead(ctx, n.cond, scope, deps) ? n.yes : n.else, scope);
      } else if (n.type === "each") {
        const items = safeRead(ctx, n.list, scope, deps);
        (Array.isArray(items) ? items.slice(0, MAX_EACH) : []).forEach((item, i) => {
          walk(n.children, rowScope(scope, n, item, i));
        });
      } else if (n.type === "el") {
        const { a, on } = evalAttrs(n, scope, ctx, deps);
        const el = svgEl(n.name.toLowerCase(), n, a, on, scope, look, ctx, deps);
        if (isValidElement(el)) out.push(cloneElement(el, { key: out.length }));
      }
    }
  };
  walk(nodes, env);
  return out;
}

// ── kit components ──────────────────────────────────────────────────────────────────────────────

/**
 * A catalog component (Chart, Table, Formula, Calendar…) drawn by its kit widget, including a
 * host's own. Its props are evaluated here; children fill slots (<Column/>, <Tab>, <Node/>) or
 * become its content; taps and edits come back as Live handlers and writes.
 */
function KitEl({
  node,
  a,
  on,
  write,
  env,
  name,
}: {
  node: El;
  a: Attrs;
  on: Handlers;
  write?: (v: unknown) => void;
  env: Env;
  name: string;
}) {
  const ctx = useCtx();
  const look = useLook();
  const deps = new Set<string>();
  const shape = shapeOf(name);
  const props: Record<string, unknown> = { ...a };
  const handlers = new Map<string, (...args: unknown[]) => void>();
  if (on.onPress) {
    props.action = { event: { name: "__live", context: { h: "onPress" } } };
    handlers.set("onPress", on.onPress);
  }
  // Children: content, slot objects (<Tab label>, <Row …/>, <Node/>), or child ids (Flip front/back).
  const childIds: string[] = [];
  const childNodes = new Map<string, { nodes: Node[]; env: Env }>();
  let content: Node[] = [];
  const visit = (nodes: Node[], scope: Env) => {
    for (const n of nodes) {
      if (n.type === "each") {
        let list: unknown = [];
        try {
          list = ctx.program.read(n.list, scope, deps);
        } catch (error) {
          ctx.report(`each ${n.list}`, error);
        }
        for (const [i, item] of (Array.isArray(list) ? list.slice(0, MAX_EACH) : []).entries())
          visit(n.children, rowScope(scope, n, item, i));
      } else if (n.type === "if") {
        let yes = false;
        try {
          yes = Boolean(ctx.program.read(n.cond, scope, deps));
        } catch {}
        visit(yes ? n.yes : n.else, scope);
      } else if (n.type === "el") {
        const slot = slotFor(name, n.name);
        const isLayout =
          !!resolveName(n.name) && "children" in shapeOf(resolveName(n.name) as string) && !slot;
        if (slot && !isLayout) fillSlot(slot, n, scope);
        else if ("children" in shape) {
          const id = `c${childIds.length}`;
          childIds.push(id);
          childNodes.set(id, { nodes: [n], env: scope });
        } else content.push(n);
      } else if (n.type === "text" && n.text.trim()) {
        if ("children" in shape) {
          const id = `c${childIds.length}`;
          childIds.push(id);
          childNodes.set(id, { nodes: [n], env: scope });
        } else content.push(n);
      }
    }
  };
  const fillSlot = (slot: { prop: string; kind: "objects" | "child" }, n: El, scope: Env) => {
    if (slot.kind === "child") {
      const id = `s${childNodes.size}`;
      childNodes.set(id, { nodes: n.children, env: scope });
      props[slot.prop] = id;
      return;
    }
    const fields = objectShape(name, slot.prop);
    const obj: Record<string, unknown> = {};
    const own = evalAttrs(n, scope, ctx, deps);
    Object.assign(obj, own.a);
    if (own.on.onPress) {
      const h = `h${handlers.size}`;
      handlers.set(h, own.on.onPress);
      obj.action = { event: { name: "__live", context: { h } } };
    }
    const kids = n.children.filter((c) => c.type !== "text" || c.text.trim());
    if ("child" in fields && kids.some((c) => c.type === "el")) {
      const id = `s${childNodes.size}`;
      childNodes.set(id, { nodes: n.children, env: scope });
      obj.child = id;
    } else if (kids.length) {
      const text = kids
        .map((c) =>
          c.type === "text"
            ? splitText(c.text)
                .map((p) => (typeof p === "string" ? p : show(safeRead(ctx, p.expr, scope, deps))))
                .join("")
            : "",
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const key =
        ["label", "text", "prompt", "title", "detail", "value"].find((k) => k in fields) ?? "label";
      if (text && !(key in obj)) obj[key] = text;
    }
    if ("id" in fields && obj.id === undefined)
      obj.id = `${slot.prop}${Array.isArray(props[slot.prop]) ? (props[slot.prop] as unknown[]).length + 1 : 1}`;
    const list =
      Array.isArray(props[slot.prop]) && props[slot.prop] !== a[slot.prop]
        ? (props[slot.prop] as unknown[])
        : [];
    list.push(obj);
    props[slot.prop] = list;
  };
  visit(node.children, env);
  useWatch(ctx.program, deps);
  // Text inside a text-like component is its text prop.
  const TEXT_PROP: Record<string, string> = {
    Markdown: "text",
    Callout: "text",
    CodeBlock: "code",
    Formula: "latex",
    Heading: "text",
    Text: "text",
    Badge: "text",
    Button: "label",
  };
  if (content.length && TEXT_PROP[name] && props[TEXT_PROP[name] as string] === undefined) {
    const raw = content
      .map((c) =>
        c.type === "text"
          ? splitText(c.text)
              .map((p) => (typeof p === "string" ? p : show(safeRead(ctx, p.expr, env, deps))))
              .join("")
          : "",
      )
      .join(" ");
    props[TEXT_PROP[name] as string] =
      name === "Markdown" || name === "CodeBlock" ? dedent(raw) : raw.replace(/\s+/g, " ").trim();
    content = [];
  }
  if ("children" in shape) props.children = childIds;
  if (typeof props.aspectRatio === "string") props.aspectRatio = ratioOf(props.aspectRatio);
  const id = useMemo(() => `live${Math.random().toString(36).slice(2, 8)}`, []);
  const bound = write ? { value: { path: "/__live" } } : {};
  const checked = checkKitProps(name, props, bound);
  const snapshot = {
    id,
    component: name,
    raw: { id, component: name, ...(checked ?? props), ...bound } as any,
    props: checked ?? props,
    scope: "/",
  };
  const runtime = useMemo(() => {
    const proxy = Object.create(ctx.runtime) as UIRuntime;
    return proxy;
  }, [ctx.runtime]);
  // Writes and taps from the widget go to this element's Live code.
  (runtime as any).setValue = (_s: string, path: string, value: unknown) => {
    if (path === "/__live" || path.startsWith("/__live")) write?.(value);
  };
  (runtime as any).dispatch = async (_s: string, _c: string, action: any) => {
    const h = action?.event?.name === "__live" ? String(action.event.context?.h ?? "") : "";
    const fn = handlers.get(h);
    if (fn) fn();
    else if (action?.event?.name === "send" || action?.event?.name === "ask")
      ctx.runtime.options.onAction?.({
        name: action.event.name,
        timestamp: new Date().toISOString(),
        surfaceId: ctx.surfaceId,
        sourceComponentId: id,
        context: action.event.context ?? {},
      });
    else if (action?.functionCall?.call === "openUrl")
      ctx.program.run(
        handlerCode(`open(${JSON.stringify(String(action.functionCall.args?.url ?? ""))})`),
      );
  };
  (runtime as any).read = (_s: string, path: string) => (path === "/__live" ? a.value : undefined);
  const renderChild = (cid: string) => {
    const part = childNodes.get(cid);
    if (!part) return null;
    return (
      <LookCtx.Provider value={look}>
        <View style={{ gap: 8 }}>
          <Kids key={cid} nodes={part.nodes} env={part.env} ns="view" />
        </View>
      </LookCtx.Provider>
    );
  };
  // A kit component the host's policy leaves out draws nothing; nor does a password field.
  if (ctx.allow && !ctx.allow.has(name)) return null;
  if (asksForSecret(props)) {
    ctx.report(`<${name}>`, new LiveError("a password field is not drawn in an answer"));
    return null;
  }
  if (!checked) {
    ctx.report(`<${name}>`, new LiveError("its props don't fit the component"));
    return null;
  }
  const impl = ctx.kit.components[name]?.implementation;
  const fallback = ctx.kit.components[name]?.fallback;
  const Widget =
    ctx.components[impl ?? ""] ??
    ctx.components[name] ??
    ctx.components[fallback ?? ""] ??
    NativeView;
  return (
    <NativeBoundary
      resetKey={snapshot.props}
      onError={() => ctx.report(`<${name}>`, new LiveError("the widget failed to draw"))}
    >
      <Widget
        node={snapshot as any}
        runtime={runtime}
        surfaceId={ctx.surfaceId}
        renderChild={renderChild}
      >
        {childIds.map((cid) => (
          <React.Fragment key={cid}>{renderChild(cid)}</React.Fragment>
        ))}
      </Widget>
    </NativeBoundary>
  );
}
type KitSchema = {
  safeParse(value: unknown):
    | { success: true; data: unknown }
    | {
        success: false;
        error: { issues: { path: (string | number)[]; options?: unknown[]; values?: unknown[] }[] };
      };
};
/**
 * A kit component's props against its catalog schema, so a widget only ever sees what it can draw.
 * A small slip is mended (a number where words go, a missing title); null when nothing can be done.
 */
function checkKitProps(
  name: string,
  props: Record<string, unknown>,
  extra: Record<string, unknown>,
): Record<string, unknown> | null {
  const schema = (componentSchemas as unknown as Record<string, KitSchema>)[name];
  if (!schema) return props;
  // The binding is part of the check, not of the value the widget reads.
  const parsed = (data: unknown) => {
    const out = { ...(data as Record<string, unknown>) };
    for (const key of Object.keys(extra)) delete out[key];
    return out;
  };
  const first = schema.safeParse({ ...props, ...extra });
  if (first.success) return { ...props, ...parsed(first.data) };
  const mended = { ...props };
  for (const issue of first.error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string" || issue.path.length !== 1 || key in extra) return null;
    const v = mended[key];
    const options = issue.values ?? issue.options;
    if (typeof v === "number" || typeof v === "boolean") mended[key] = String(v);
    else if (v === undefined) mended[key] = options?.[0] ?? "";
    else delete mended[key];
  }
  const second = schema.safeParse({ ...mended, ...extra });
  return second.success ? { ...mended, ...parsed(second.data) } : null;
}
function safeRead(ctx: Ctx, expr: string, env: Env, deps: Set<string>): unknown {
  try {
    return ctx.program.read(expr, env, deps);
  } catch (error) {
    ctx.report(`{${expr}}`, error);
    return "";
  }
}
function dedent(s: string): string {
  const lines = s.replace(/^\n+/, "").replace(/\s+$/, "").split("\n");
  const indent = Math.min(
    ...lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)?.[0].length ?? 0),
  );
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join("\n");
}
