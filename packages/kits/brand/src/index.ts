import { defineKit } from "@engine/kit-spec";
import { CATALOG_ID, COMPONENT_NAMES } from "@engine/protocol";
import calculator from "../examples/calculator.json";
import dashboard from "../examples/dashboard.json";
import form from "../examples/form.json";
import planner from "../examples/planner.json";

/**
 * A kit that replaces real implementations: Button and Card map to `BrandButton` / `BrandCard`,
 * which the host registers on each platform from its own design system (see docs/KITS.md).
 * The catalog and every prop meaning stay identical to the core kits.
 */
export const brand = defineKit({
  id: "brand",
  name: "Brand",
  version: "1.0.0",
  catalogId: CATALOG_ID,
  tokens: {
    light: {
      background: "#fff8f3",
      surface: "#ffffff",
      foreground: "#2b1a14",
      muted: "#6d4c3f",
      accent: "#c2410c",
      onAccent: "#ffffff",
      border: "#e7cdbf",
      danger: "#b91c1c",
      success: "#166534",
    },
    dark: {
      background: "#1d120d",
      surface: "#2a1b14",
      foreground: "#fff1e8",
      muted: "#d9b8a6",
      accent: "#fdba74",
      onAccent: "#1d120d",
      border: "#5a3a2b",
      danger: "#fca5a5",
      success: "#86efac",
    },
    typography: {
      body: "ui-rounded, system-ui, sans-serif",
      heading: "ui-rounded, system-ui, sans-serif",
      baseSize: 17,
      headingWeight: 800,
      lineHeight: 1.5,
      headingLineHeight: 1.15,
      scale: [2.4, 1.85, 1.45, 1.2, 1, 0.875],
      native: { heading: { ios: "Avenir Next", android: "sans-serif-medium" } },
    },
    spacing: { xs: 6, sm: 10, md: 18, lg: 28, xl: 40 },
    radius: 20,
    motionMs: 220,
  },
  components: Object.fromEntries(
    COMPONENT_NAMES.map((name) => [
      name,
      // Unregistered host implementations fall through to the built-in view of the same component.
      { implementation: ["Button", "Card"].includes(name) ? `Brand${name}` : name },
    ]),
  ),
  hostImplementations: ["BrandButton", "BrandCard"],
  guide:
    "Speak in a warm, direct brand voice. Lead with a bold heading and one sentence of context. Prefer a single primary action per screen; secondary actions are quiet buttons. Group related fields in a card and keep everything else flat. Use friendly, concrete labels with units. All state, props and actions follow the core catalog exactly; never use kit-specific component names in model output.",
  examples: ["calculator", "form", "planner", "dashboard"],
});

/** Validated few-shot examples this kit ships; see loadKitExamples() in @engine/adapter-gateway. */
export const brandExamples: unknown[] = [calculator, form, planner, dashboard];
