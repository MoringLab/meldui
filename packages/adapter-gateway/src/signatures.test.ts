import { describe, expect, it } from "vitest";
import { neutral } from "../../kits/neutral/src/index.js";
import { buildCatalogSchema, capabilitiesFor, filterCatalog } from "../../protocol/src/index.js";
import { buildSystemPrompt, catalogSignatures } from "./index.js";

const allowed = [
  "Column",
  "Row",
  "Heading",
  "Text",
  "Table",
  "Stat",
  "Slider",
  "Tabs",
  "Button",
  "Chart",
];

describe("catalog signatures", () => {
  it("states every prop of every allowed component on one line", () => {
    const catalog = filterCatalog(structuredClone(buildCatalogSchema()) as never, allowed) as {
      components: Record<string, unknown>;
    };
    const lines = catalogSignatures(catalog).split("\n");
    expect(lines).toHaveLength(allowed.length + 1);
    expect(lines).toContain(
      "Slider{label:T,value:N,disabled?:B,error?:T,min?:num,max?:num,step?:num}",
    );
    expect(lines.find((l) => l.startsWith("Column{"))).toMatch(/^Column\{children:ids,/);
    expect(lines.find((l) => l.startsWith("Table{"))).toContain("rows:A");
    expect(lines.find((l) => l.startsWith("Button{"))).toContain("action:Action");
    expect(lines.find((l) => l.startsWith("Tabs{"))).toContain("tabs:{id:str,label:T,child:str}[]");
  });

  it("makes the prompt several times smaller than the compact schema", () => {
    const options = {
      kit: neutral,
      capabilities: capabilitiesFor("react-native"),
      policy: { allowedComponents: allowed },
    };
    const compact = buildSystemPrompt({ ...options, variant: "compact" });
    const signatures = buildSystemPrompt({ ...options, variant: "signatures" });
    expect(signatures.length * 3).toBeLessThan(compact.length);
    expect(signatures).toContain("Components:\nTypes:");
    expect(signatures).not.toContain("Authoring patterns");
  });
});

describe("kit icons", () => {
  const options = {
    capabilities: capabilitiesFor("react-native"),
    policy: { allowedComponents: ["Column", "Icon", "Callout"] },
    variant: "signatures" as const,
  };
  it("lists the kit's icon names, or the built-in set without one", () => {
    const own = buildSystemPrompt({
      ...options,
      kit: { ...neutral, icons: ["tag", "shopping-bag"] },
    });
    expect(own).toContain(
      "Icon names (Icon.name and the icon prop of Callout, Stat and Badge): tag,shopping-bag.",
    );
    expect(buildSystemPrompt({ ...options, kit: neutral })).toContain(
      ": check,info,arrow,plus,star,close.",
    );
  });
  it("accepts any well-formed icon name and an untitled callout", () => {
    const catalog = buildCatalogSchema() as {
      components: Record<string, { properties: Record<string, unknown> }>;
    };
    expect(catalog.components.Icon.properties.name).toMatchObject({ type: "string" });
    expect(catalog.components.Callout.properties).toHaveProperty("icon");
  });
});
