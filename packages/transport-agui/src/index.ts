import { MessageSchema, type UIMessage, type UserAction } from "@engine/protocol";

/** Engine's documented AG-UI CUSTOM binding, not an AG-UI mandatory event. */
export function toAGUI(message: UIMessage) {
  return { type: "CUSTOM" as const, name: "engine.a2ui", value: MessageSchema.parse(message) };
}
/** Ignore unrelated agent events; validate the UI boundary before returning it. */
export function fromAGUI(event: unknown): UIMessage | undefined {
  if (!event || typeof event !== "object") return undefined;
  const value = event as Record<string, unknown>;
  if (value.type !== "CUSTOM" || value.name !== "engine.a2ui") return undefined;
  return MessageSchema.parse(value.value);
}
/** Carry a user event through a host-owned agent context. */
export function actionContext(action: UserAction) {
  return { description: "A2UI user action", value: JSON.stringify({ version: "v0.9", action }) };
}

import type { AnswerSession } from "@engine/core";
import { ControlLineSchema } from "@engine/protocol";
/** Versioned project binding; TEXT_MESSAGE_CONTENT stays literal Markdown. */
export function toAGUIControl(control: unknown) {
  return {
    type: "CUSTOM" as const,
    name: "engine.control.v1",
    value: ControlLineSchema.parse(control),
  };
}
export class AGUIAnswerBridge {
  private textId: string | undefined;
  constructor(private readonly session: AnswerSession) {}
  accept(input: unknown) {
    if (!input || typeof input !== "object") return false;
    const event = input as Record<string, any>;
    if (event.type === "TEXT_MESSAGE_START") {
      if (typeof event.messageId !== "string" || event.messageId.length > 128)
        throw Error("AGUI_MESSAGE_ID");
      this.session.finishMarkdown();
      this.textId = event.messageId;
      return true;
    }
    if (event.type === "TEXT_MESSAGE_CONTENT") {
      if (
        event.messageId !== this.textId ||
        typeof event.delta !== "string" ||
        event.delta.length > 65536
      )
        throw Error("AGUI_TEXT_ORDER");
      this.session.pushMarkdown(event.delta);
      return true;
    }
    if (event.type === "TEXT_MESSAGE_END") {
      if (event.messageId !== this.textId) throw Error("AGUI_TEXT_ORDER");
      this.session.finishMarkdown();
      this.textId = undefined;
      return true;
    }
    if (event.type === "CUSTOM" && event.name === "engine.control.v1") {
      this.session.push(JSON.stringify(ControlLineSchema.parse(event.value)) + "\n");
      return true;
    }
    const message = fromAGUI(input);
    if (message) {
      this.session.pushMessage(message);
      return true;
    }
    return false;
  }
}
