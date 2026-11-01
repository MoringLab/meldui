import type { ViewStyle } from "react-native";

// Free styling (colours, sizes, spacing) as a reply writes it → what a native view takes. Anything
// unreadable is ignored, so a typo costs a colour, never the surface.

type Palette = {
  foreground: string;
  muted: string;
  accent: string;
  background: string;
  surface: string;
  border: string;
  success: string;
  danger: string;
  warning?: string;
};

/** A colour role or a literal colour; undefined when it is neither. */
export function colorOf(value: unknown, t: Palette, dark: boolean): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const roles: Record<string, string> = {
    primary: t.foreground,
    foreground: t.foreground,
    secondary: t.muted,
    muted: t.muted,
    tertiary: t.muted,
    accent: t.accent,
    info: dark ? "#60A5FA" : "#2563EB",
    success: t.success,
    warning: t.warning ?? "#D97706",
    danger: t.danger,
    surface: t.surface,
    "surface-secondary": t.surface,
    background: t.background,
    border: t.border,
  };
  if (roles[value]) return roles[value];
  return /^(#[0-9a-f]{3,8}|rgba?\(.+\))$/i.test(value) ? value : undefined;
}

/** Whether words on this colour should be light (for #rgb and #rrggbb; rgb() counts as mid). */
export function isDark(color: string): boolean {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})/i.exec(color)?.[1];
  if (!hex) return false;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const n = Number.parseInt(full, 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 < 0.6;
}

/** dp, a fraction up to 1, "120px", "50%" or a computed number in a string. */
export function lengthOf(value: unknown): number | `${number}%` | undefined {
  if (typeof value === "number") return value <= 1 ? (`${value * 100}%` as `${number}%`) : value;
  if (typeof value !== "string") return undefined;
  if (value.endsWith("%")) return Number.isFinite(Number.parseFloat(value)) ? (value as `${number}%`) : undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

/** A spacing token through the kit, or steps of 4dp. */
export function spaceOf(value: unknown, token: (key: unknown, fallback?: number) => number, fallback: number) {
  return typeof value === "number" ? value * 4 : token(value, fallback);
}

/** padding={3}, padding="sm" or padding={{ x: 3, top: 1 }}. */
export function insetOf(value: unknown, token: (key: unknown, fallback?: number) => number, fallback: number): ViewStyle {
  if (!value || typeof value !== "object") return { padding: spaceOf(value, token, fallback) };
  const v = value as Record<string, unknown>;
  const at = (k: string, side: string) =>
    v[side] !== undefined ? spaceOf(v[side], token, 0) : v[k] !== undefined ? spaceOf(v[k], token, 0) : fallback;
  return { paddingTop: at("y", "top"), paddingBottom: at("y", "bottom"), paddingLeft: at("x", "left"), paddingRight: at("x", "right") };
}

const CORNER: Record<string, number> = { none: 0, sm: 0.5, md: 1, lg: 1.6, xl: 2, "2xl": 2.6, "3xl": 3.2 };

/** One corner: a token relative to the kit's radius, or dp. `full` is left to the caller. */
export function cornerOf(value: unknown, base: number): number | undefined {
  if (typeof value === "number") return value;
  const k = CORNER[String(value)];
  return k === undefined ? undefined : k * base;
}

export function cornersOf(value: unknown, base: number): ViewStyle {
  if (!value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  return {
    borderTopLeftRadius: cornerOf(v.topLeft, base) ?? 0,
    borderTopRightRadius: cornerOf(v.topRight, base) ?? 0,
    borderBottomLeftRadius: cornerOf(v.bottomLeft, base) ?? 0,
    borderBottomRightRadius: cornerOf(v.bottomRight, base) ?? 0,
  };
}
