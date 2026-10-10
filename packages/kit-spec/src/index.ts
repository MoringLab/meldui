import { CATALOG_ID, COMPONENT_NAMES } from "@engine/protocol";
import { z } from "zod";

const colors = z
  .object({
    background: z.string(),
    surface: z.string(),
    foreground: z.string(),
    muted: z.string(),
    accent: z.string(),
    onAccent: z.string(),
    border: z.string(),
    danger: z.string(),
    success: z.string(),
  })
  .strict();
/**
 * Typography tokens. `body`/`heading` are web font stacks. `native` names registered font families
 * for React Native / Flutter (system font when absent). Everything after `baseSize` is optional so
 * existing kits keep validating; defaults match the previous hard-coded values.
 */
const nativeFamily = z.union([
  z.string(),
  z.object({ ios: z.string().optional(), android: z.string().optional() }),
]);
const typographySchema = z.object({
  body: z.string(),
  heading: z.string(),
  baseSize: z.number().min(14),
  bodyWeight: z.number().int().min(100).max(900).default(400),
  headingWeight: z.number().int().min(100).max(900).default(600),
  lineHeight: z.number().min(1).max(2.2).default(1.55),
  headingLineHeight: z.number().min(1).max(2).default(1.2),
  /** Multipliers of baseSize for Heading levels 1-6. */
  scale: z
    .array(z.number().min(0.75).max(4))
    .length(6)
    .default([2.25, 1.75, 1.375, 1.125, 1, 0.875]),
  native: z.object({ body: nativeFamily.optional(), heading: nativeFamily.optional() }).default({}),
});
export const KitSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.literal("1.0.0"),
  catalogId: z.string(),
  tokens: z.object({
    light: colors,
    dark: colors,
    typography: typographySchema,
    spacing: z.object({
      xs: z.number(),
      sm: z.number(),
      md: z.number(),
      lg: z.number(),
      xl: z.number(),
    }),
    radius: z.number().min(0),
    motionMs: z.number().min(0).max(300),
  }),
  components: z.record(z.object({ implementation: z.string(), fallback: z.string().optional() })),
  /** Implementation names the host must register itself; each needs a fallback so an unregistered host still renders. */
  hostImplementations: z.array(z.string()).default([]),
  guide: z.string().min(20),
  examples: z.array(z.string()),
});
export type UIKit = z.infer<typeof KitSchema>;
/** Authoring shape: optional tokens may be omitted and take their defaults. */
export type UIKitInput = z.input<typeof KitSchema>;
export type ThemeColors = z.infer<typeof colors>;

/** Validate the portable part of a kit before a host registers its code. */
export function validateKit(input: unknown): UIKit {
  const kit = KitSchema.parse(input);
  if (kit.catalogId === CATALOG_ID)
    for (const name of COMPONENT_NAMES) {
      const component = kit.components[name];
      if (!component)
        throw new Error(`Kit ${kit.id} has no implementation or fallback for ${name}`);
    }
  for (const [name, definition] of Object.entries(kit.components)) {
    if (definition.fallback && !kit.components[definition.fallback])
      throw new Error(`Unknown fallback for ${name}`);
    const seen = new Set([name]);
    let next = definition.fallback;
    while (next) {
      if (seen.has(next)) throw new Error("Fallback cycle");
      seen.add(next);
      next = kit.components[next]?.fallback;
    }
  }
  return kit;
}
/** Author a kit with an immediately checked manifest. */
export function defineKit(kit: UIKitInput): UIKit {
  return validateKit(kit);
}

export type ResolvedTypography = {
  body: { family: string; nativeFamily?: string; size: number; weight: number; lineHeight: number };
  small: { size: number; lineHeight: number };
  heading: {
    family: string;
    nativeFamily?: string;
    weight: number;
    /** Font sizes for levels 1-6, rounded to whole units. */
    sizes: number[];
    /** Absolute line heights (size × heading line-height), rounded. */
    lineHeights: number[];
  };
};
/** The single place typography tokens become concrete numbers; the Dart port mirrors this. */
export function resolveTypography(
  kit: UIKit,
  os: "ios" | "android" = "android",
): ResolvedTypography {
  const t = kit.tokens.typography;
  const pick = (family: z.infer<typeof nativeFamily> | undefined) =>
    typeof family === "string" || family === undefined ? family : family[os];
  const sizes = t.scale.map((m) => Math.round(t.baseSize * m));
  const small = Math.max(12, Math.round(t.baseSize * 0.875));
  return {
    body: {
      family: t.body,
      nativeFamily: pick(t.native.body),
      size: t.baseSize,
      weight: t.bodyWeight,
      lineHeight: Math.round(t.baseSize * t.lineHeight),
    },
    small: { size: small, lineHeight: Math.round(small * t.lineHeight) },
    heading: {
      family: t.heading,
      nativeFamily: pick(t.native.heading),
      weight: t.headingWeight,
      sizes,
      lineHeights: sizes.map((size) => Math.round(size * t.headingLineHeight)),
    },
  };
}

export const EXAMPLE_CATEGORIES = [
  "calculator",
  "compare",
  "form",
  "planner",
  "dashboard",
  "explain",
  "game",
  "media",
  "simulation",
] as const;
/** A validated few-shot example a kit ships in its `examples/` folder. */
export const KitExampleSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().max(200),
  category: z.enum(EXAMPLE_CATEGORIES),
  keywords: z.array(z.string().min(1).max(40)).min(1).max(40),
  source: z.string().max(200).optional(),
  intro: z.string().max(600).optional(),
  fallbackText: z.string().min(10).max(4000),
  messages: z.array(z.unknown()).min(2).max(200),
  outro: z.string().max(600).optional(),
});
export type KitExample = z.infer<typeof KitExampleSchema>;

export * from "./conformance.js";
export * from "./patterns.js";
