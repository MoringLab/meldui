import { describe, expect, it } from "vitest";
import { neutral } from "../../kits/neutral/src/index.js";
import { buildSystemPrompt, GatewayAdapter } from "./index.js";

const message = {
  version: "v0.9",
  createSurface: { surfaceId: "한글😀", catalogId: "urn:engine:catalog:core:1" },
};
function adapter(content: string, status = 200) {
  const encoder = new TextEncoder();
  const sse = `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3 }, model: "gateway-reported-model" })}\r\n\r\ndata: [DONE]\n\n`;
  const bytes = encoder.encode(sse);
  return new GatewayAdapter({
    baseUrl: "http://gateway.invalid/v1",
    apiKey: "test-only",
    fetch: async () =>
      new Response(
        status === 200
          ? new ReadableStream({
              start(controller) {
                for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
                controller.close();
              },
            })
          : null,
        { status, headers: { "content-type": "text/event-stream" } },
      ),
  });
}
const request = {
  model: "requested-model",
  messages: [{ role: "user" as const, content: "test" }],
};
describe("gateway boundaries", () => {
  it("uses a host catalog and rejects mismatched capabilities", () => {
    const catalog = { catalogId: "urn:host:custom", components: { HostText: { type: "object" } } };
    const kit = { ...neutral, catalogId: catalog.catalogId };
    const capabilities = {
      catalogIds: [catalog.catalogId],
      platform: "web" as const,
      clientActions: [],
    };
    const prompt = buildSystemPrompt({ catalog, kit, capabilities });
    expect(prompt).toContain('"catalogId":"urn:host:custom"');
    expect(prompt).toContain('"HostText"');
    expect(prompt).not.toContain("A Form needs");
    expect(() => buildSystemPrompt({ kit, capabilities })).toThrow("CATALOG_MISMATCH");
  });
  it("decodes split UTF-8 SSE and preserves reported identity and usage", async () => {
    const events = [];
    for await (const event of adapter(JSON.stringify(message)).stream(request)) events.push(event);
    expect(events.find((e) => e.type === "message")).toEqual({ type: "message", message });
    expect(events.find((e) => e.type === "usage")).toMatchObject({
      model: "gateway-reported-model",
      inputTokens: 2,
      outputTokens: 3,
    });
    expect(events.at(-1)).toEqual({ type: "complete", status: "completed" });
  });
  it("quarantines an invalid line and still yields a valid message", async () => {
    const events = [];
    for await (const event of adapter(`invalid\n${JSON.stringify(message)}\n`).stream(request))
      events.push(event);
    expect(events.filter((e) => e.type === "message")).toHaveLength(1);
    expect(events.find((e) => e.type === "diagnostic")).toMatchObject({
      diagnostic: { code: "INVALID_JSON" },
    });
  });
  it("does not expose a credential or gateway body on authentication errors", async () => {
    const events = [];
    for await (const event of adapter("", 401).stream(request)) events.push(event);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "diagnostic",
        diagnostic: expect.objectContaining({ code: "GATEWAY_HTTP_401" }),
      }),
    );
    expect(JSON.stringify(events)).not.toContain("test-only");
    expect(events.at(-1)).toEqual({ type: "complete", status: "failed" });
  });
});
