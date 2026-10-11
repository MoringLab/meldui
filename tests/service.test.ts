import { expect, it } from "vitest";
import cases from "../fixtures/service/cases.json";
import { AnswerSession, createUIRuntime } from "../packages/core/src/index.js";

for (const f of cases)
  it(`service ${f.id} is a composed bound answer`, () => {
    const runtime = createUIRuntime();
    for (const id of ["photo-a", "photo-b"])
      runtime.attachments.attach({
        id,
        name: id,
        mime: "image/png",
        kind: "image",
        alt: "Synthetic image",
      });
    const answer = new AnswerSession(runtime);
    answer.push(f.wire);
    answer.end();
    for (const sid of runtime.surfaceIds)
      for (const component of runtime.getSurface(sid)!.componentsModel.values)
        expect(runtime.getNodeSnapshot(sid, component.id).error, component.id).toBeUndefined();
    expect(runtime.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    if (f.id === "purchase") {
      expect(runtime.getNodeSnapshot("main", "count").props.value).toBe(3);
      runtime.setValue("main", "/budget", 100000);
      expect(runtime.getNodeSnapshot("main", "count").props.value).toBe(1);
      expect(runtime.getNodeSnapshot("main", "price").props.value).toBe(99000);
    }
    if (f.id === "progress-ring") {
      runtime.setValue("main", "/progress", 100);
      expect(runtime.read("main", "/progress")).toBe(100);
    }
    runtime.dispose();
  });
