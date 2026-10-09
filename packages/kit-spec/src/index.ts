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
export const KitSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.literal("1.0.0"),
  catalogId: z.string(),
  tokens: z.object({
    light: colors,
    dark: colors,
    typography: z.object({ body: z.string(), heading: z.string(), baseSize: z.number().min(14) }),
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
  guide: z.string().min(20),
  examples: z.array(z.string()),
});
export type UIKit = z.infer<typeof KitSchema>;
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
export function defineKit(kit: UIKit): UIKit {
  return validateKit(kit);
}
