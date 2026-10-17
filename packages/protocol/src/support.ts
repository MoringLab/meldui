import { ANSWER_WIRE_VERSION } from "./answer.js";
import { CATALOG_ID, type Capabilities, COMPONENT_NAMES, EXPRESSION_OPS } from "./index.js";

export type Platform = Capabilities["platform"];
/**
 * What each renderer declares. A component listed under `unsupported` must name a `fallbacks`
 * entry that the platform does implement, and the prompt advertises only supported components.
 * The conformance tests check every renderer against this table.
 */
export const PLATFORM_SUPPORT: Record<
  Platform,
  { unsupported: string[]; fallbacks: Record<string, string>; unsupportedOps: string[] }
> = {
  // Diagram, Collection, Quote and Converter are drawn by the React Native renderer (and hosts).
  web: {
    unsupported: ["Diagram", "Collection", "Quote", "Converter"],
    fallbacks: { Diagram: "Text", Collection: "Text", Quote: "Text", Converter: "Text" },
    unsupportedOps: [],
  },
  "react-native": {
    unsupported: ["Simulation"],
    fallbacks: { Simulation: "Text" },
    unsupportedOps: [],
  },
  flutter: {
    unsupported: [
      "Audio",
      "Simulation",
      "Box",
      "Pager",
      "Flip",
      "Menu",
      "Device",
      "QuizSet",
      "Diagram",
      "Collection",
      "Quote",
      "Converter",
    ],
    fallbacks: {
      Simulation: "Text",
      Audio: "FileCard",
      DocumentPreview: "FileCard",
      Box: "Column",
      Pager: "Tabs",
      Flip: "Accordion",
      Menu: "Button",
      Device: "Card",
      QuizSet: "Quiz",
      Diagram: "Text",
      Collection: "Text",
      Quote: "Text",
      Converter: "Text",
    },
    // The Dart evaluator has not been ported these yet; prompts for Flutter do not offer them.
    unsupportedOps: ["concat", "set", "object", "slice", "join", "includes", "abs"],
  },
};

export function capabilitiesFor(
  platform: Platform,
  extra: { clientActions?: string[]; catalogIds?: string[] } = {},
): Required<Capabilities> {
  const support = PLATFORM_SUPPORT[platform];
  return {
    catalogIds: extra.catalogIds ?? [CATALOG_ID],
    platform,
    clientActions: extra.clientActions ?? [],
    components: COMPONENT_NAMES.filter((n) => !support.unsupported.includes(n)),
    fallbacks: support.fallbacks,
    expressionOps: EXPRESSION_OPS.filter((op) => !support.unsupportedOps.includes(op)),
    answerWire: [ANSWER_WIRE_VERSION],
    features: {
      continuousPlayback: platform === "web",
      directSceneDrag: platform === "web",
      sceneHover: platform === "web",
      isolatedSandbox: platform === "web",
      // Formula strings (args.formula / setValue formula); the Dart evaluator has no parser yet.
      formulas: platform !== "flutter",
      advancedCharts: platform === "web",
    },
  };
}

/** Restrict a generated catalog to the components the target actually supports. */
export function filterCatalog<T extends { components: Record<string, unknown> }>(
  catalog: T,
  names: string[],
): T {
  return {
    ...catalog,
    components: Object.fromEntries(
      Object.entries(catalog.components).filter(([n]) => names.includes(n)),
    ),
  };
}
