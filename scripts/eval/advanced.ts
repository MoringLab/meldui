import media from "../../fixtures/media/cases.json" with { type: "json" };
import cases from "../../fixtures/showcase/cases.json" with { type: "json" };
import {
  AnswerSession,
  AttachmentRegistry,
  createUIRuntime,
} from "../../packages/core/src/index.js";
import type { Row } from "./common.js";
import { compoundFutureValue, normalPdf, sirRun } from "./golden.js";
export function evaluateAdvanced(): Row[] {
  const rows: Row[] = [];
  const load = (id: string) => {
    const runtime = createUIRuntime(),
      registry = new AttachmentRegistry();
    for (const a of media[0].attachments) registry.attach(a as any);
    const session = new AnswerSession(runtime, {
      attachments: registry,
      policy: { allowSandbox: true },
    });
    session.push(cases.find((f) => f.id === id)!.wire);
    session.end();
    return { runtime, session, node: (id: string) => runtime.getNodeSnapshot("main", id) };
  };
  for (const fixture of cases) {
    const { runtime, session } = load(fixture.id);
    const bad =
      runtime.diagnostics.some((d) => d.severity === "error") ||
      runtime.surfaceIds.some((sid) =>
        [...runtime.getSurface(sid)!.componentsModel.values].some(
          (n) => runtime.getNodeSnapshot(sid, n.id).error,
        ),
      );
    rows.push({
      layer: "showcase:replay",
      id: fixture.id,
      status: bad ? "fail" : "pass",
      detail: `${fixture.path}: declared state and bindings, not generation or human learning quality`,
    });
    if (fixture.path === "A")
      rows.push({
        layer: "learning:showcase-proxy",
        id: fixture.id,
        status: "not-run",
        detail: "Renderer/behavior fixtures are available. Human rubric remains uncalibrated.",
      });
    runtime.dispose();
  }
  const check = (id: string, run: (v: ReturnType<typeof load>) => boolean) => {
    const value = load(id);
    try {
      rows.push({
        layer: "numeric",
        id: `showcase:${id}`,
        status: run(value) ? "pass" : "fail",
        detail: "independent golden reference; replay calculation",
      });
    } catch (e) {
      rows.push({ layer: "numeric", id: `showcase:${id}`, status: "fail", detail: String(e) });
    } finally {
      value.runtime.dispose();
    }
  };
  check(
    "16",
    ({ node }) => Math.abs(node("future").props.value - compoundFutureValue(1000, 5, 20)) < 1e-8,
  );
  check(
    "20",
    ({ node }) =>
      ["person1", "person2", "person3"].reduce((s, id) => s + node(id).props.value, 0) === 63001,
  );
  check(
    "18",
    ({ node }) =>
      Math.abs(node("visual").props.values[60] - normalPdf(0)) < 1e-10 &&
      Math.abs(node("probability").props.value - 0.682689492) < 0.0001,
  );
  check(
    "17",
    ({ node }) =>
      Math.abs(node("stay").props.value - 1 / 3) < 0.05 &&
      node("stay").props.value + node("switch").props.value === 1,
  );
  check("14", ({ node }) => {
    const gold = sirRun({ s: 999, i: 1, r: 0 }, 0.2, 0.1, 100);
    return (
      gold.every((s, i) => Math.abs(s.i - node("visual").props.values[i]) < 1e-8) &&
      Math.abs(node("conservation").props.value - 1000) < 1e-7
    );
  });
  return rows;
}
