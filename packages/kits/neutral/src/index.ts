import { defineKit } from "@engine/kit-spec";
import { CATALOG_ID, COMPONENT_NAMES } from "@engine/protocol";
import calculator from "../examples/calculator.json";
import comparison from "../examples/comparison.json";
import dashboard from "../examples/dashboard.json";
import explanation from "../examples/explanation.json";
import form from "../examples/form.json";
import game from "../examples/game.json";
import planner from "../examples/planner.json";
export const neutral = defineKit({
  id: "neutral",
  name: "Neutral",
  version: "1.0.0",
  catalogId: CATALOG_ID,
  tokens: {
    light: {
      background: "#f4f6fa",
      surface: "#ffffff",
      foreground: "#192638",
      muted: "#526277",
      accent: "#245aca",
      onAccent: "#ffffff",
      border: "#cbd4e0",
      danger: "#b42318",
      success: "#236540",
    },
    dark: {
      background: "#101923",
      surface: "#192533",
      foreground: "#f0f4f8",
      muted: "#b5c3d4",
      accent: "#9abaff",
      onAccent: "#101923",
      border: "#3b4f65",
      danger: "#ffaaa2",
      success: "#8bd5a5",
    },
    typography: { body: "system-ui, sans-serif", heading: "system-ui, sans-serif", baseSize: 16 },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
    radius: 12,
    motionMs: 140,
  },
  components: Object.fromEntries(COMPONENT_NAMES.map((name) => [name, { implementation: name }])),
  guide:
    "Build clear, compact tools. Lead with one heading and a short explanation. Group related controls; give every input a label. Use bound input values and computed values for local calculations. Choose a table for exact comparisons and a chart for trends. Avoid nested cards. Fit narrow mobile screens. Show explicit units and useful empty states.",
  examples: ["calculator", "comparison", "form", "planner", "dashboard", "explanation", "game"],
});

/** Validated few-shot examples this kit ships; see loadKitExamples() in @engine/adapter-gateway. */
export const neutralExamples: unknown[] = [
  calculator,
  comparison,
  form,
  planner,
  dashboard,
  explanation,
  game,
];
