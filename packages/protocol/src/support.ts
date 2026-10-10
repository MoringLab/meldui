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
  web: { unsupported: [], fallbacks: {}, unsupportedOps: [] },
  "react-native": { unsupported: [], fallbacks: {}, unsupportedOps: [] },
  flutter: {
    unsupported: ["Audio"],
    fallbacks: { Audio: "FileCard", DocumentPreview: "FileCard" },
    unsupportedOps: [],
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
