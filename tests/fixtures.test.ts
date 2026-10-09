import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/cases.json";
import { createUIRuntime } from "../packages/core/src/index.js";
import { validateKit } from "../packages/kit-spec/src/index.js";
import { editorial } from "../packages/kits/editorial/src/index.js";
import { neutral } from "../packages/kits/neutral/src/index.js";
import { buildCatalogSchema, COMPONENT_NAMES } from "../packages/protocol/src/index.js";

describe("portable fixtures", () => {
  for (const fixture of fixtures)
    it(`${fixture.id}: renders and evaluates local interactions`, () => {
      const runtime = createUIRuntime();
      for (const message of fixture.messages) runtime.accept(message);
      runtime.finish();
      expect(runtime.diagnostics).toEqual([]);
      for (const component of runtime.getSurface("main")!.componentsModel.values)
        expect(runtime.getNodeSnapshot("main", component.id).error, component.id).toBeUndefined();
      for (const step of fixture.interactions) {
        runtime.setValue("main", step.path, step.value);
        expect(runtime.getNodeSnapshot("main", step.node).props[step.prop]).toEqual(step.expected);
      }
      runtime.dispose();
    });
  it("covers every catalog component and both complete kits", () => {
    const names = new Set(
      fixtures.flatMap((f) =>
        f.messages.flatMap((m) => m.updateComponents?.components.map((c) => c.component) ?? []),
      ),
    );
    expect([...names].sort()).toEqual([...COMPONENT_NAMES].sort());
    expect(COMPONENT_NAMES).toHaveLength(25);
    expect(validateKit(neutral).catalogId).toBe(validateKit(editorial).catalogId);
  });
  it("exports only resolvable local schema references", () => {
    const schema = buildCatalogSchema();
    const walk = (value: any) => {
      if (!value || typeof value !== "object") return;
      if (value.$ref) {
        expect(value.$ref.startsWith("#/")).toBe(true);
        let target: any = schema;
        for (const segment of value.$ref.slice(2).split("/"))
          target = target?.[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
        expect(target, value.$ref).toBeDefined();
      }
      for (const child of Object.values(value)) walk(child);
    };
    walk(schema);
  });
});
