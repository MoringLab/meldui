import { defineKit } from "@engine/kit-spec";
import { CATALOG_ID, COMPONENT_NAMES } from "@engine/protocol";
export const editorial = defineKit({
  id: "editorial",
  name: "Editorial",
  version: "1.0.0",
  catalogId: CATALOG_ID,
  tokens: {
    light: {
      background: "#f5f1e8",
      surface: "#fffcf4",
      foreground: "#253c31",
      muted: "#54695c",
      accent: "#285d48",
      onAccent: "#ffffff",
      border: "#c6cbbd",
      danger: "#a53227",
      success: "#285d48",
    },
    dark: {
      background: "#17241e",
      surface: "#21332a",
      foreground: "#f4f0e6",
      muted: "#b7c5b8",
      accent: "#b4d8b6",
      onAccent: "#17241e",
      border: "#4c6354",
      danger: "#f4aaa0",
      success: "#b4d8b6",
    },
    typography: {
      body: "system-ui, sans-serif",
      heading: "Georgia, serif",
      baseSize: 16,
      headingWeight: 500,
      headingLineHeight: 1.18,
      native: { heading: { ios: "Georgia", android: "serif" } },
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 36 },
    radius: 6,
    motionMs: 140,
  },
  components: Object.fromEntries(
    COMPONENT_NAMES.map((name) => [
      name,
      { implementation: ["Card", "Heading", "Button"].includes(name) ? `Editorial${name}` : name },
    ]),
  ),
  guide:
    "Build readable, thoughtful interfaces. Use a strong heading, short explanatory paragraphs, and generous group spacing. Favor lists and tables for detailed information. Use cards only for independent tools. Keep native controls recognizable. All state, props and actions follow the core catalog exactly; never use kit-specific component names in model output.",
  examples: ["explanation", "comparison", "calculator"],
});
