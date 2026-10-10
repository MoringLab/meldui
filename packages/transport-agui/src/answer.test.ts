import { AnswerSession, createUIRuntime } from "@engine/core";
import { expect, it } from "vitest";
import { AGUIAnswerBridge, toAGUIControl } from "./index.js";

it("joins ordered AG-UI text and validated media controls without interpreting prose as UI", () => {
  const runtime = createUIRuntime(),
    session = new AnswerSession(runtime),
    bridge = new AGUIAnswerBridge(session);
  bridge.accept({ type: "TEXT_MESSAGE_START", messageId: "a" });
  bridge.accept({
    type: "TEXT_MESSAGE_CONTENT",
    messageId: "a",
    delta: '**Hello** {"version":"v0.9"}',
  });
  bridge.accept({ type: "TEXT_MESSAGE_END", messageId: "a" });
  bridge.accept(
    toAGUIControl({
      engine: "v1",
      block: "media",
      attachments: ["photo"],
      markdown: "Side explanation",
      placement: "left",
    }),
  );
  expect(session.blocks.map((b) => b.kind)).toEqual(["markdown", "media"]);
  expect(runtime.surfaceIds).toEqual([]);
  expect(() =>
    bridge.accept({ type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "late" }),
  ).toThrow("AGUI_TEXT_ORDER");
  runtime.dispose();
});
