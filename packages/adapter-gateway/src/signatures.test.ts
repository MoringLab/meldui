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
      "Slider{label:T,value:N,disabled?:B,error?:T,min?:num,max?:num,step?:num,unit?:T}",
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

describe("sandbox wording", () => {
  it("does not forbid the HTML it allows in sandbox blocks", () => {
    const base = { capabilities: capabilitiesFor("react-native"), variant: "signatures" as const };
    const allowed = buildSystemPrompt({ ...base, kit: neutral, policy: { allowSandbox: true } });
    expect(allowed).toContain("Outside a sandbox block never emit HTML");
    expect(allowed).not.toContain("Never emit HTML, JavaScript, CSS");
    const denied = buildSystemPrompt({ ...base, kit: neutral, policy: { allowSandbox: false } });
    expect(denied).toContain("Never emit HTML, JavaScript, CSS");
    expect(denied).not.toContain("Sandbox:");
  });
});

describe("routing", () => {
  it("leaves the Markdown-or-surface choice to the host when asked", () => {
    const base = {
      capabilities: capabilitiesFor("react-native"),
      kit: neutral,
      variant: "signatures" as const,
    };
    expect(buildSystemPrompt(base)).toContain("Choose the format per request");
    expect(buildSystemPrompt({ ...base, routing: false })).not.toContain(
      "Choose the format per request",
    );
  });
});

describe("markup syntax", () => {
  const base = {
    kit: neutral,
    capabilities: capabilitiesFor("react-native"),
    variant: "signatures" as const,
  };
  it("teaches tags instead of JSON lines, and is shorter", () => {
    const json = buildSystemPrompt(base);
    const tags = buildSystemPrompt({ ...base, syntax: "markup" });
    expect(tags).toContain("{@state qty = 1}");
    expect(tags).toContain('<Tab id="a"');
    expect(tags).not.toContain('"createSurface"');
    expect(tags).not.toContain("fallbackText");
    expect(tags.length).toBeLessThan(json.length);
  });
});
