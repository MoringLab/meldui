import { describe, expect, it } from "vitest";
import media from "../fixtures/media/cases.json" with { type: "json" };
import fixtures from "../fixtures/showcase/cases.json" with { type: "json" };
import {
  AnswerSession,
  AttachmentRegistry,
  createSimulation,
  createUIRuntime,
} from "../packages/core/src/index.js";

const load = (id: string) => {
  const runtime = createUIRuntime(),
    session = new AnswerSession(runtime, {
      attachments: (() => {
        const registry = new AttachmentRegistry();
        for (const item of media[0].attachments) registry.attach(item as any);
        return registry;
      })(),
      policy: { allowSandbox: true },
    });
  session.push(fixtures.find((f) => f.id === id)!.wire);
  session.end();
  return { runtime, session, node: (id: string) => runtime.getNodeSnapshot("main", id) };
};
describe("Showcase replay and independent domain checks", () => {
  for (const f of fixtures)
    it(`${f.id} ${f.title} keeps every declared node valid`, () => {
      const { runtime, session } = load(f.id);
      for (const sid of runtime.surfaceIds)
        for (const n of runtime.getSurface(sid)!.componentsModel.values)
          expect(runtime.getNodeSnapshot(sid, n.id).error, `${f.id}/${n.id}`).toBeUndefined();
      expect(runtime.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(session.blocks.length).toBeGreaterThan(0);
      runtime.dispose();
    });
  it("compound future value matches closed form after input change", () => {
    const { runtime, node } = load("16");
    for (const rate of [0, 5, 12]) {
      runtime.setValue("main", "/a", rate);
      expect(node("future").props.value).toBeCloseTo(1000 * (1 + rate / 100) ** 20, 8);
      expect(node("visual").props.values.at(-1)).toBeCloseTo(node("future").props.value, 8);
    }
    runtime.dispose();
  });
  it("weighted integer shares conserve every currency unit", () => {
    const { runtime, node } = load("20");
    for (const total of [1, 10001, 63001]) {
      runtime.setValue("main", "/a", total);
      for (const weight of [1, 3, 6]) {
        runtime.setValue("main", "/b", weight);
        expect(
          ["person1", "person2", "person3"].reduce((s, id) => s + node(id).props.value, 0),
        ).toBe(total);
      }
    }
    runtime.dispose();
  });
  it("SIR conserved state and transmission input change infection peak", () => {
    const { runtime, node } = load("14");
    let previous = 0;
    for (const ratio of [0.5, 2, 4]) {
      runtime.setValue("main", "/a", ratio);
      expect(node("conservation").props.value).toBeCloseTo(1000, 7);
      const peak = Math.max(...node("visual").props.values);
      expect(peak).toBeGreaterThanOrEqual(previous);
      previous = peak;
    }
    runtime.dispose();
  });
  it("normal PDF and midpoint area match independent reference", () => {
    const { runtime, node } = load("18");
    for (const sd of [0.5, 1, 2]) {
      runtime.setValue("main", "/a", sd);
      const values = node("visual").props.values;
      expect(values[60]).toBeCloseTo(1 / (sd * Math.sqrt(2 * Math.PI)), 10);
      expect(node("probability").props.value).toBeCloseTo(0.682689492, 4);
    }
    runtime.dispose();
  });
  it("Monty Hall stays near theoretical odds and is seeded", () => {
    const { runtime, node } = load("17");
    runtime.setValue("main", "/a", 900);
    expect(node("stay").props.value).toBeCloseTo(1 / 3, 1);
    expect(node("stay").props.value + node("switch").props.value).toBe(1);
    runtime.dispose();
  });
  it("three-door game reveals a different goat door and resets without a model call", async () => {
    const { runtime, node } = load("17");
    for (let door = 0; door < 3; door++) {
      await runtime.dispatch("main", `door-${door}`, node(`door-${door}`).raw!.action as any);
      await runtime.dispatch("main", "reveal", node("reveal").raw!.action as any);
      const opened = Number(String(node("opened").props.text).match(/(\d+)번/)![1]) - 1;
      expect(opened).not.toBe(door);
      await runtime.dispatch("main", "switch-door", node("switch-door").raw!.action as any);
      expect(runtime.read("main", "/finalDoor")).toBe(3 - door - opened);
      await runtime.dispatch("main", "next-game", node("next-game").raw!.action as any);
      expect(runtime.read("main", "/revealed")).toBe(false);
      expect(runtime.read("main", "/trialIndex")).toBe(door + 1);
    }
    runtime.dispose();
  });
  it("stock trade is atomic and conserves wealth", async () => {
    const { runtime, node } = load("13");
    const before = node("wealth").props.value;
    await runtime.dispatch("main", "buy", node("buy").raw!.action as any);
    expect(node("holdings").props.value).toBe(1);
    expect(node("wealth").props.value).toBeCloseTo(before, 9);
    await runtime.dispatch("main", "sell", node("sell").raw!.action as any);
    expect(node("holdings").props.value).toBe(0);
    expect(node("cash").props.value).toBe(1000);
    runtime.dispose();
  });
  it("nBody uses bounded Verlet with conserved energy, cellular conserves material", () => {
    const orbit = createSimulation("nBody", 42, { count: 8 }),
      before = orbit.metrics().energy;
    for (let i = 0; i < 240; i++) orbit.step();
    expect(Math.abs((orbit.metrics().energy - before) / before)).toBeLessThan(0.01);
    orbit.dispose();
    const cell = createSimulation("cellular", 42),
      count = cell.metrics().count;
    for (let i = 0; i < 100; i++) cell.step();
    expect(cell.metrics().count).toBe(count);
    cell.pour();
    expect(cell.metrics().count).toBeGreaterThanOrEqual(count);
    expect(cell.reset().step).toBe(0);
    cell.dispose();
  });
});
it("trusted simulation snapshot resumes RNG and dynamics exactly", () => {
  for (const kind of ["nBody", "cellular", "agents"] as const) {
    const first = createSimulation(kind, 42),
      second = createSimulation(kind, 42);
    for (let i = 0; i < 15; i++) first.step();
    second.restore(first.snapshot());
    expect(second.step()).toEqual(first.step());
    expect(() => second.restore({ ...first.snapshot(), seed: 7 })).toThrow("SIMULATION_SNAPSHOT");
    first.dispose();
    second.dispose();
  }
});
