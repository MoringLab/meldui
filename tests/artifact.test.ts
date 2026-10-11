import { expect, it } from "vitest";
import fixtures from "../fixtures/cases.json";
import { AnswerSession, createUIRuntime } from "../packages/core/src/index.js";

it("rejects stale or invalid artifact edits and preserves user inputs", () => {
  const answer = new AnswerSession(createUIRuntime());
  for (const message of fixtures[0].messages) answer.pushMessage(message);
  answer.end();
  const id = answer.blocks.find((b) => b.kind === "surface")!.id;
  answer.runtime.setValue("main", "/a", 12);
  expect(() => answer.updateArtifact(id, 2, { messages: [] })).toThrow("ARTIFACT_REVISION");
  const before = answer.runtime.getNodeSnapshot("main", "root");
  expect(() =>
    answer.updateArtifact(id, 0, {
      messages: [
        {
          version: "v0.9",
          updateComponents: { surfaceId: "main", components: [{ id: "root", component: "Nope" }] },
        },
      ],
    }),
  ).toThrow();
  expect(answer.runtime.getNodeSnapshot("main", "root")).toEqual(before);
  expect(answer.runtime.read("main", "/a")).toBe(12);
  answer.runtime.dispose();
});

it("commits a validated artifact revision while preserving edited values and history", () => {
  const answer = new AnswerSession(createUIRuntime());
  for (const message of fixtures[0].messages) answer.pushMessage(message);
  answer.end();
  const id = answer.blocks.find((b) => b.kind === "surface")!.id;
  answer.runtime.setValue("main", "/a", 12);
  answer.updateArtifact(id, 0, {
    messages: [{ version: "v0.9", updateDataModel: { surfaceId: "main", path: "/a", value: 20 } }],
  });
  expect(answer.runtime.read("main", "/a")).toBe(12);
  expect((answer.blocks.find((b) => b.id === id) as any).revision).toBe(1);
  const restored = AnswerSession.restore(answer.serialize(), createUIRuntime());
  expect((restored.blocks.find((b) => b.id === id) as any).revision).toBe(1);
  restored.runtime.dispose();
  answer.runtime.dispose();
});
