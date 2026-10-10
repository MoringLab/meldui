import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import split from "../eval/split.json" with { type: "json" };
import { loadKitExamples, selectExamples } from "../packages/adapter-gateway/src/index.js";
import {
  checkKitConformance,
  resolveTypography,
  validateKit,
} from "../packages/kit-spec/src/index.js";
import { brand, brandExamples } from "../packages/kits/brand/src/index.js";
import { editorial, editorialExamples } from "../packages/kits/editorial/src/index.js";
import { neutral, neutralExamples } from "../packages/kits/neutral/src/index.js";
import {
  COMPONENT_NAMES,
  PLATFORM_SUPPORT,
  type Platform,
} from "../packages/protocol/src/index.js";

const kits = [
  { kit: neutral, examples: neutralExamples },
  { kit: editorial, examples: editorialExamples },
  { kit: brand, examples: brandExamples },
];
const hostRegistered: Record<Platform, string[]> = {
  web: ["BrandButton", "BrandCard"],
  "react-native": ["BrandButton", "BrandCard"],
  flutter: ["BrandButton", "BrandCard"],
};
const platforms: Platform[] = ["web", "react-native", "flutter"];

describe("kit conformance", () => {
  for (const { kit, examples } of kits) {
    for (const platform of platforms)
      it(`${kit.id} conforms on ${platform}`, () => {
        expect(
          checkKitConformance(kit, { platform, registered: hostRegistered[platform] }),
        ).toEqual([]);
      });
    it(`${kit.id} still renders when the host registers nothing (falls back)`, () => {
      expect(checkKitConformance(kit, { platform: "web", registered: [] })).toEqual([]);
    });
    it(`${kit.id} resolved typography is stable`, () => {
      expect({
        ios: resolveTypography(kit, "ios"),
        android: resolveTypography(kit, "android"),
      }).toMatchSnapshot();
    });
    it(`${kit.id} examples validate, replay and stay out of the held-out split`, () => {
      const loaded = loadKitExamples(validateKit(kit), examples);
      expect(loaded.length).toBe(kit.examples.length);
      const heldout = new Set(
        Object.entries(split.original)
          .filter(([, v]) => v === "heldout")
          .map(([k]) => k),
      );
      for (const e of loaded) {
        expect(heldout.has(String(e.source).replace("fixture:", ""))).toBe(false);
        expect(e.fallbackText.length).toBeGreaterThan(10);
      }
    });
  }
  it("conformance catches a missing implementation", () => {
    // A component the platform lacks natively, with no fallback, cannot render.
    const broken = {
      ...brand,
      components: { ...brand.components, Ghost: { implementation: "Nope" } },
    };
    delete (broken.components as Record<string, unknown>).Button;
    expect(checkKitConformance(broken, { platform: "web" }).some((i) => i.rule === "mapping")).toBe(
      true,
    );
  });
  it("conformance catches unreadable contrast", () => {
    const bad = {
      ...neutral,
      tokens: { ...neutral.tokens, light: { ...neutral.tokens.light, muted: "#cccccc" } },
    };
    expect(checkKitConformance(bad, { platform: "web" }).some((i) => i.rule === "contrast")).toBe(
      true,
    );
  });
});

describe("example selection", () => {
  const library = loadKitExamples(neutral, neutralExamples);
  it("picks by keyword and category within 2-4 and the token budget", () => {
    const picked = selectExamples(library, { prompt: "월 소득으로 저축률 계산기 만들어줘" });
    expect(picked[0].id).toBe("calculator");
    expect(picked.length).toBeGreaterThanOrEqual(2);
    expect(picked.length).toBeLessThanOrEqual(4);
    expect(picked.reduce((n, e) => n + e.tokens, 0)).toBeLessThanOrEqual(6000);
  });
  it("matches English whole words only", () => {
    const picked = selectExamples(library, { prompt: "Compare three phone plans in a table" });
    expect(picked[0].id).toBe("comparison");
  });
  it("is deterministic and falls back to the kit's leading examples", () => {
    const a = selectExamples(library, { prompt: "zzz qqq" });
    const b = selectExamples(library, { prompt: "zzz qqq" });
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
    expect(a.map((e) => e.id)).toEqual(library.slice(0, 2).map((e) => e.id));
  });
  it("respects a tight budget but never returns nothing", () => {
    expect(selectExamples(library, { prompt: "계산", tokenBudget: 1 }).length).toBe(1);
  });
});

describe("renderer declarations match PLATFORM_SUPPORT", () => {
  const sources: Record<Platform, [string, RegExp]> = {
    web: ["packages/renderer-react/src/renderer.tsx", /case "(\w+)":/g],
    "react-native": ["packages/renderer-react-native/src/renderer.tsx", /case "(\w+)":/g],
    flutter: ["dart/engine_flutter/lib/src/renderer.dart", /case '(\w+)':/g],
  };
  for (const platform of platforms)
    it(`${platform} renderer handles every component it declares`, () => {
      const [file, re] = sources[platform];
      const handled = new Set([...readFileSync(file, "utf8").matchAll(re)].map((m) => m[1]));
      const declared = COMPONENT_NAMES.filter(
        (n) => !PLATFORM_SUPPORT[platform].unsupported.includes(n),
      );
      expect(declared.filter((n) => !handled.has(n))).toEqual([]);
    });
});
