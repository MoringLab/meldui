import { buildCatalogSchema, CATALOG_ID, componentProps, defineComponent } from "@engine/protocol";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { compileSvg, createUIRuntime, HostBridge, sceneShapes } from "./index.js";

const source =
  '<svg viewBox="0 0 640 400"><g id="wheel"><circle cx="100" cy="220" r="50" fill="none" stroke="foreground"/></g><path d="M 100 220 L 200 120" stroke="accent"/></svg>';
it("compiles standard SVG to a portable part and changes a whole group locally", () => {
  const result = compileSvg(source, {
    title: "Bicycle",
    description: "Move the wheel",
    parts: { wheel: { label: "Rear wheel", explode: { path: "/explode", x: -80, y: 20 } } },
  });
  const r = createUIRuntime();
  r.accept({ version: "v0.9", createSurface: { surfaceId: "main", catalogId: CATALOG_ID } });
  r.accept({
    version: "v0.9",
    updateDataModel: { surfaceId: "main", path: "/", value: { explode: 0 } },
  });
  const before = sceneShapes(result.scene.nodes, r, "main");
  r.setValue("main", "/explode", 1);
  expect(before[0].attrs.transform).toBe("translate(0,0)");
  expect(sceneShapes(result.scene.nodes, r, "main")[0].attrs.transform).toBe("translate(-80,20)");
  expect(result.parts).toEqual([{ id: "wheel", label: "Rear wheel" }]);
  r.dispose();
});
describe("SVG input boundary", () => {
  for (const markup of [
    "<script>alert(1)</script>",
    '<image href="https://evil.test/a"/>',
    '<rect onload="x()"/>',
    "<foreignObject/>",
    '<path style="fill:url(https://evil.test)"/>',
    '<rect width="NaN"/>',
    '<g id="dup"/><g id="dup"/>',
  ])
    it(markup, () =>
      expect(() =>
        compileSvg(`<svg viewBox="0 0 10 10">${markup}</svg>`, {
          title: "test",
          description: "test",
        }),
      ).toThrow(),
    );
  it("rejects DTD entities and unknown parts", () => {
    expect(() =>
      compileSvg('<!DOCTYPE svg [<!ENTITY a "test">]>' + source, { title: "x", description: "x" }),
    ).toThrow();
    expect(() =>
      compileSvg(source, { title: "x", description: "x", parts: { missing: {} } }),
    ).toThrow("SVG_UNKNOWN_PART");
  });
});
it("registers an additive bound custom component without losing default components", () => {
  const d = defineComponent({
    name: "PartInspector",
    description: "Inspect a selected mechanical part.",
    schema: z.object({ title: componentProps.text, children: componentProps.children.optional() }),
    examples: [{ title: "Wheel" }],
  });
  const r = createUIRuntime({ customComponents: [d] });
  r.accept({ version: "v0.9", createSurface: { surfaceId: "m", catalogId: CATALOG_ID } });
  r.accept({
    version: "v0.9",
    updateDataModel: { surfaceId: "m", path: "/", value: { part: "Fork" } },
  });
  expect(
    r.accept({
      version: "v0.9",
      updateComponents: {
        surfaceId: "m",
        components: [
          { id: "root", component: "Column", children: ["inspect"] },
          { id: "inspect", component: "PartInspector", title: { path: "/part" } },
        ],
      },
    }),
  ).toEqual([]);
  expect(r.resolve("m", { path: "/part" })).toBe("Fork");
  expect(
    buildCatalogSchema({ PartInspector: d.schema }, "urn:custom").components.PartInspector,
  ).toBeTruthy();
  r.dispose();
});
it("requires real host confirmation, validates tool args and restricts shared state", async () => {
  let calls = 0;
  const bridge = new HostBridge({
    readable: ["/filter"],
    writable: ["/filter"],
    state: { "/filter": "all" },
    tools: {
      reserve: {
        description: "Save a reservation",
        requiresConfirmation: true,
        input: z.object({ id: z.string() }),
        handler: () => {
          calls++;
          return { ok: true };
        },
      },
    },
  });
  await expect(bridge.call("reserve", { id: "x" })).rejects.toThrow("HOST_CONFIRMATION_REQUIRED");
  expect(calls).toBe(0);
  expect(() => bridge.write("/secret", "x")).toThrow("HOST_STATE_DENIED");
  bridge.write("/filter", "selected");
  expect(bridge.context()).toEqual({ "/filter": "selected" });
  await expect(bridge.call("unknown", {})).rejects.toThrow("HOST_TOOL_DENIED");
  bridge.dispose();
});
it("interpolates portable keyframes using a bounded local state path", () => {
  const result = compileSvg(source, {
    title: "Move",
    description: "Interpolate",
    parts: {
      wheel: { keyframes: { path: "/phase", from: { x: 0, angle: 0 }, to: { x: 100, angle: 90 } } },
    },
  });
  const runtime = createUIRuntime();
  runtime.accept({ version: "v0.9", createSurface: { surfaceId: "main", catalogId: CATALOG_ID } });
  runtime.setValue("main", "/phase", 0.5);
  expect(sceneShapes(result.scene.nodes, runtime, "main")[0].attrs.transform).toBe(
    "translate(50,0) rotate(45,0,0) scale(1,1)",
  );
  runtime.dispose();
});

it("accepts portable numeric units, dashed strokes and text weight while explaining rejected attrs", () => {
  const out = compileSvg(
    '<svg viewBox="0 0 100 100"><path d="M0 0 L90 90" stroke="blue" stroke-width="2px" stroke-dasharray="4 2" fill-opacity="0.5"/><text font-weight="bold">Label</text></svg>',
    { title: "x", description: "x" },
  );
  expect(out.scene.nodes[0].attrs.strokeWidth).toBe(2);
  expect(out.scene.nodes[0].attrs.strokeDasharray).toBe("4 2");
  try {
    compileSvg('<svg><circle class="external"/></svg>', { title: "x", description: "x" });
    throw Error("should reject");
  } catch (e) {
    expect((e as any).path).toBe("/svg/attributes/class");
  }
});

it("ignores a host tool result that arrives after cancellation", async () => {
  let complete!: (value: unknown) => void;
  const bridge = new HostBridge({
    tools: {
      load: {
        description: "Load",
        input: z.object({}),
        handler: () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      },
    },
  });
  const controller = new AbortController();
  const result = bridge.call("load", {}, controller.signal);
  controller.abort();
  complete({ value: 1 });
  await expect(result).rejects.toThrow("HOST_BRIDGE_CLOSED");
  bridge.dispose();
});
