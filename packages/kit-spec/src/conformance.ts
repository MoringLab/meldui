import { COMPONENT_NAMES, PLATFORM_SUPPORT, type Platform } from "@engine/protocol";
import { resolveTypography, type ThemeColors, type UIKit } from "./index.js";

const HEX = /^#[0-9a-fA-F]{6}$/;
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
/** WCAG 2.x contrast ratio between two #rrggbb colors. */
export function contrast(a: string, b: string) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const PAIRS: [keyof ThemeColors, keyof ThemeColors, number][] = [
  ["foreground", "background", 4.5],
  ["foreground", "surface", 4.5],
  ["muted", "background", 4.5],
  ["muted", "surface", 4.5],
  ["onAccent", "accent", 4.5],
  ["accent", "background", 3],
  ["danger", "surface", 4.5],
  ["success", "surface", 4.5],
];

export type ConformanceIssue = { rule: string; detail: string };
/**
 * Portable kit checks that do not need a renderer: token coverage and contrast, typography sanity,
 * and a complete implementation-or-fallback mapping for the catalog on a given platform.
 * `registered` lists implementation names the host registers on that platform.
 */
export function checkKitConformance(
  kit: UIKit,
  { platform, registered = [] }: { platform: Platform; registered?: string[] },
): ConformanceIssue[] {
  const issues: ConformanceIssue[] = [];
  const add = (rule: string, detail: string) => issues.push({ rule, detail });
  for (const mode of ["light", "dark"] as const) {
    const colors = kit.tokens[mode];
    for (const [name, value] of Object.entries(colors))
      if (!HEX.test(value)) add("token-format", `${mode}.${name} must be #rrggbb, got ${value}`);
    for (const [fg, bg, min] of PAIRS) {
      const ratio = contrast(colors[fg] ?? "#000000", colors[bg] ?? "#ffffff");
      if (ratio < min)
        add("contrast", `${mode} ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
    }
  }
  const ty = resolveTypography(kit);
  ty.heading.sizes.forEach((size, i) => {
    if (i > 0 && size > ty.heading.sizes[i - 1])
      add("typography", `heading level ${i + 1} is larger than level ${i}`);
    if (ty.heading.lineHeights[i] < size)
      add("typography", `heading level ${i + 1} line height is smaller than its size`);
  });
  if (ty.body.lineHeight < ty.body.size * 1.3)
    add("typography", "body line height below 1.3× size hurts readability");
  const support = PLATFORM_SUPPORT[platform];
  // Built-in default views exist for every supported catalog component under its own name.
  const builtIn = new Set(COMPONENT_NAMES.filter((n) => !support.unsupported.includes(n)));
  const builtInVariants = new Set(["EditorialCard", "EditorialHeading", "EditorialButton"]);
  const available = (name: string | undefined) =>
    !!name &&
    (builtIn.has(name as never) || builtInVariants.has(name) || registered.includes(name));
  for (const name of COMPONENT_NAMES) {
    const def = kit.components[name];
    if (!def) {
      add("mapping", `${name} has no implementation or fallback`);
      continue;
    }
    if (support.unsupported.includes(name)) continue;
    // Renderers resolve implementation → component name → declared fallback, so a built-in
    // component always renders even when the host has not registered a replacement.
    let ok = available(def.implementation) || builtIn.has(name);
    for (let next = def.fallback; !ok && next; next = kit.components[next]?.fallback)
      ok = available(next) || available(kit.components[next]?.implementation);
    if (!ok)
      add(
        "mapping",
        `${name}: neither "${def.implementation}" nor its fallback chain is available on ${platform}`,
      );
  }
  for (const needed of kit.hostImplementations) {
    const users = Object.entries(kit.components).filter(([, d]) => d.implementation === needed);
    if (!users.length) add("host-implementation", `${needed} is required but no component uses it`);
    for (const [name] of users)
      if (!builtIn.has(name as never))
        add(
          "host-implementation",
          `${name} uses host-only ${needed} but has no built-in view to fall back to on ${platform}`,
        );
  }
  return issues;
}
