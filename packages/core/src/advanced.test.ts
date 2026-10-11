import { MediaDeclarationSchema, SceneNodeSchema } from "@engine/protocol";
import { describe, expect, it } from "vitest";
import { AnswerSession } from "./answer.js";
import { evaluateExpression, seededRandom } from "./expression.js";
import { createUIRuntime } from "./index.js";
import { createSimulation } from "./simulations.js";
import { Ticker } from "./ticker.js";
import { sceneShapes } from "./visuals.js";

const op = (op: string, ...args: any[]) => ({ op, args }),
  ref = (ref: string) => ({ ref });
describe("bounded portable visual computation", () => {
  it("calculates a recurrence, lazy mapping and scoped reduction", () => {
    const run = (expr: any) => evaluateExpression(expr, () => undefined);
    expect(run(op("scan", 1000, op("mul", ref("$acc"), 1.05), 20))).toHaveLength(21);
    expect(
      (run(op("scan", 1000, op("mul", ref("$acc"), 1.05), 20)) as number[]).at(-1),
    ).toBeCloseTo(1000 * 1.05 ** 20, 8);
    expect(run(op("map", op("range", 10), op("pow", ref("$item"), 2)))).toEqual([
      0, 1, 4, 9, 16, 25, 36, 49, 64, 81,
    ]);
    expect(run(op("reduce", op("array", 2, 3, 5), op("add", ref("$acc"), ref("$item")), 0))).toBe(
      10,
    );
    expect(run(op("filter", op("array", 1, 2, 3), op("gt", ref("$item"), 1)))).toEqual([2, 3]);
    expect(() => run(op("range", 1001))).toThrow("ITERATION_LIMIT");
    expect(() => run(op("map", op("range", 1000), op("range", 1000)))).toThrow("ITERATION_LIMIT");
    expect(() => run(op("sqrt", -1))).toThrow("EXPECTED_NUMBER");
  });
  it("has random access RNG and manual clock pause/disposal semantics", () => {
    expect(seededRandom(42, 0)).toBe(seededRandom(42, 0));
    expect(seededRandom(42, 1)).not.toBe(seededRandom(42, 0));
    const writes: any[] = [];
    const t = new Ticker((v) => writes.push(v));
    t.step();
    expect(t.frame).toBe(0);
    t.playing = true;
    t.visible = false;
    t.step();
    expect(t.frame).toBe(0);
    t.step(0.1, true);
    expect(t.time).toBe(0.1);
    t.reducedMotion = true;
    t.visible = true;
    t.step();
    expect(t.frame).toBe(1);
    t.dispose();
    t.step(0.1, true);
    expect(writes).toHaveLength(1);
  });
  it.each([
    "nBody",
    "cellular",
    "agents",
  ] as const)("%s is seeded, bounded, snapshot-independent and disposable", (module) => {
    const a = createSimulation(module, 42),
      b = createSimulation(module, 42);
    for (let i = 0; i < 20; i++) {
      a.step();
      b.step();
    }
    expect(a.snapshot()).toEqual(b.snapshot());
    const first = a.snapshot();
    first.particles[0]!.x = 99;
    expect(a.snapshot().particles[0]!.x).not.toBe(99);
    expect(() => a.step(5)).toThrow("SIMULATION_STEP_BUDGET");
    a.dispose();
    expect(() => a.step()).toThrow("SIMULATION_DISPOSED");
    b.dispose();
  });
  it("rejects active scene tags, style injection and expanded scene complexity", () => {
    expect(SceneNodeSchema.safeParse({ type: "foreignObject" }).success).toBe(false);
    expect(
      SceneNodeSchema.safeParse({
        type: "path",
        attrs: { d: "M0,0 L1,1", fill: "url(https://bad)" },
      }).success,
    ).toBe(false);
    const r = createUIRuntime();
    expect(() =>
      sceneShapes(
        [
          {
            type: "repeat",
            items: Array(301).fill(0),
            children: [{ type: "circle", attrs: { r: 3 } }],
          },
        ],
        r,
        "main",
      ),
    ).toThrow("SCENE_REPEAT_LIMIT");
    r.dispose();
  });
  it("keeps media composition in history and rejects model layout code", () => {
    const r = createUIRuntime();
    r.attach({
      id: "photo",
      meta: { mime: "image/png", name: "Photo", size: 1 },
      url: "https://host.example/photo.png",
    });
    const session = new AnswerSession(r);
    session.push(
      JSON.stringify({
        engine: "v1",
        block: "media",
        attachments: ["photo"],
        layout: "carousel",
        markdown: "Read this",
        placement: "left",
        mediaFraction: 0.5,
      }) + "\n",
    );
    session.end();
    expect(session.blocks[0]).toMatchObject({
      kind: "media",
      placement: "left",
      markdown: "Read this",
    });
    const restored = AnswerSession.restore(session.serialize(), createUIRuntime());
    expect(restored.blocks[0]).toMatchObject({ placement: "left", mediaFraction: 0.5 });
    expect(
      MediaDeclarationSchema.safeParse({
        engine: "v1",
        block: "media",
        attachments: ["photo"],
        placement: "absolute",
        style: "position:fixed",
      }).success,
    ).toBe(false);
    r.dispose();
  });
});

it("normalizes tuple schema dialect without weakening positive dimensions", () => {
  const component = {
    type: "circle",
    attrs: { fill: "gradient:warm", clipId: "viewport", cx: 1, cy: 2, r: 3 },
  };
  expect(SceneNodeSchema.safeParse(component).success).toBe(true);
  expect(
    SceneNodeSchema.safeParse({ ...component, attrs: { fill: "url(https://evil.test)" } }).success,
  ).toBe(false);
});
it("n-ary arithmetic consumes every operand instead of silently ignoring extras", () => {
  expect(evaluateExpression({ op: "mul", args: [2, 3, 4] }, () => null)).toBe(24);
  expect(evaluateExpression({ op: "add", args: [2, 3, 4] }, () => null)).toBe(9);
});
it("deferred scene expressions refresh only their referenced data subscriptions", () => {
  const runtime = createUIRuntime();
  runtime.accept({
    version: "v0.9",
    createSurface: { surfaceId: "main", catalogId: "urn:engine:catalog:core:1" },
  });
  runtime.accept({
    version: "v0.9",
    updateDataModel: { surfaceId: "main", value: { x: 1, y: 1 } },
  });
  runtime.accept({
    version: "v0.9",
    updateComponents: {
      surfaceId: "main",
      components: [
        {
          id: "root",
          component: "SvgScene",
          title: "Bound scene",
          description: "A movable circle",
          viewBox: [0, 0, 500, 300],
          nodes: [
            {
              type: "circle",
              attrs: {
                cx: { call: "computeNumber", args: { expr: { ref: "/x" } }, returnType: "number" },
                cy: 20,
                r: 3,
              },
            },
          ],
        },
      ],
    },
  });
  const stop = runtime.subscribeNode("main", "root", "/", () => {});
  const before = runtime.getNodeSnapshot("main", "root");
  runtime.setValue("main", "/y", 2);
  expect(runtime.getNodeSnapshot("main", "root")).toBe(before);
  runtime.setValue("main", "/x", 2);
  expect(runtime.getNodeSnapshot("main", "root")).not.toBe(before);
  stop();
  runtime.dispose();
});

describe("numberFormat grouping", () => {
  const run = (args: unknown[]) =>
    evaluateExpression({ op: "numberFormat", args } as never, () => undefined);
  it("groups thousands only when asked", () => {
    expect(run([308400, 0])).toBe("308400");
    expect(run([308400, 0, true])).toBe("308,400");
    expect(run([-1234567.5, 1, true])).toBe("-1,234,567.5");
    expect(run([999, 2, true])).toBe("999.00");
  });
});
