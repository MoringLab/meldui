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
