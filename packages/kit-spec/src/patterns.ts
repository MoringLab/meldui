import { z } from "zod";
export const PatternSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
    goal: z.string().max(512),
    order: z.array(z.string().max(64)).min(1).max(12),
    guidance: z.string().max(2048),
    components: z.array(z.string().max(64)).max(30),
    required: z.array(z.string().max(128)).max(12).optional(),
    optional: z.array(z.string().max(128)).max(12).optional(),
  })
  .strict();
export type UIPattern = z.infer<typeof PatternSchema>;
export const definePattern = (value: UIPattern) => PatternSchema.parse(value);
/** Authoring guidance, never model-selected executable code. Hosts can register additional patterns. */
export const learningPatterns: UIPattern[] = [
  {
    id: "learning",
    goal: "Explain one relationship through direct manipulation.",
    order: ["goal", "primary visual", "controls", "observations", "formula", "quiz"],
    guidance:
      "Name 1-3 concrete experiments, expected observations and one misconception. Show units and limitations. Wide: visual beside controls, explanation below. Narrow: visual then controls, advanced options in Accordion. Avoid repeating fallback text in Markdown.",
    components: ["SvgScene", "Plot", "ControlPanel", "Stat", "Formula", "Quiz", "Callout"],
    required: ["goal", "primary visual", "labelled controls", "observation", "model limits"],
    optional: ["formula with symbol meanings", "quiz", "go deeper"],
  },
  {
    id: "dashboard",
    goal: "Monitor a small set of related measures.",
    order: ["summary", "primary chart", "filters", "detail table"],
    guidance:
      "Use consistent units and time windows. Wide: metrics row and detail grid. Narrow: one column with a scrollable data table.",
    components: ["StatGroup", "Chart", "ControlPanel", "Table"],
    required: ["units", "period", "data source"],
    optional: ["filter", "comparison period"],
  },
  {
    id: "walkthrough",
    goal: "Understand or perform a sequence one step at a time.",
    order: ["goal", "current step", "progress", "next action"],
    guidance:
      "Keep one active step. Wide: illustration beside the step. Narrow: illustration above instructions; preserve completed progress.",
    components: ["Walkthrough", "Progress", "Image", "Callout"],
    required: ["step titles", "instructions"],
    optional: ["illustration", "warning"],
  },
  {
    id: "practice",
    goal: "Check understanding with immediate local feedback.",
    order: ["question", "choices", "feedback", "explanation"],
    guidance:
      "Use Quiz with a bound selection. Keep all choices visible on narrow screens. Explain the answer and offer another attempt.",
    components: ["Quiz", "Formula", "Callout"],
    required: ["question", "feedback"],
    optional: ["worked example", "hint"],
  },
  {
    id: "game",
    goal: "Explore rules through bounded repeatable play.",
    order: ["rules", "play area", "controls", "score"],
    guidance:
      "Use local actions, deterministic seed and reset. Provide keyboard/button alternatives. No continuous motion on native targets or under reduced motion.",
    components: ["SvgScene", "Button", "Stat", "ControlPanel"],
    required: ["rules", "reset", "feedback"],
    optional: ["seed", "difficulty"],
  },
  {
    id: "itinerary",
    goal: "Compare an ordered journey and its constraints.",
    order: ["summary", "route", "timeline", "constraints"],
    guidance:
      "RouteMap is schematic. Wide: route beside timeline; narrow: route above stops. Ask the host to verify distances and current travel details.",
    components: ["RouteMap", "Timeline", "Callout"],
    required: ["stop labels", "approximation note"],
    optional: ["host verification action", "budget"],
  },
  {
    id: "form",
    goal: "Collect validated input before a host-owned operation.",
    order: ["purpose", "fields", "review", "submit"],
    guidance:
      "Use labelled bound fields, local validation and host actions. Confirmation is separate from authorization. On narrow screens keep one field per row and account for the keyboard.",
    components: ["Form", "TextField", "Select", "Checkbox", "Confirmation"],
    required: ["labels", "validation", "submit action"],
    optional: ["wizard steps", "review"],
  },
  {
    id: "media-led",
    goal: "Explain host-provided media with concise accompanying text.",
    order: ["media", "description", "local navigation", "takeaway"],
    guidance:
      "Use attachment ids only. Media placement can be left/right/above/below; collapse beside-text layouts below 600px. Use a swipe carousel for sequential images with accessible previous/next buttons.",
    components: ["Gallery", "Carousel", "Video", "FileCard", "Markdown"],
    required: ["host media ids", "alt or readable fallback"],
    optional: ["captions", "chapters", "comparison"],
  },
  {
    id: "calculator",
    goal: "Change inputs and compare locally calculated results.",
    order: ["assumptions", "inputs", "result", "comparison"],
    guidance:
      "Bind inputs to data paths. Use pure expressions and explicit rounding/remainder policy.",
    components: ["ControlPanel", "TextField", "Slider", "StatGroup", "Chart", "Formula"],
  },
  {
    id: "comparison",
    goal: "Compare a small number of alternatives on the same criteria.",
    order: ["criteria", "paired visual", "differences", "takeaway"],
    guidance:
      "Keep common scales and labels. Media can sit on either side of Markdown; stack on narrow containers.",
    components: ["Grid", "Card", "Table", "ImageCompare", "Gallery", "Legend"],
  },
  {
    id: "simulator",
    goal: "Explore a simplified dynamic system.",
    order: ["model assumptions", "visual", "playback", "metrics", "history"],
    guidance:
      "Use fixed seed, bounded step budget, reset and speed. Pause when hidden/reduced-motion; supply a readable alternative.",
    components: ["Simulation", "Playback", "Plot", "StatGroup", "Callout"],
  },
];
export function availablePatterns(components: string[]) {
  return learningPatterns
    .map((p) => ({ ...p, components: p.components.filter((c) => components.includes(c)) }))
    .filter((p) => p.components.length);
}
