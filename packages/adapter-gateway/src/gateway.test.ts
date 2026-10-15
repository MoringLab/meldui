import { describe, expect, it } from "vitest";
import { neutral } from "../../kits/neutral/src/index.js";
import { capabilitiesFor } from "../../protocol/src/index.js";
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
  it("enforces host output and latency budgets at the gateway boundary", async () => {
    let sent: any;
    const limited = new GatewayAdapter({
      baseUrl: "http://local/v1",
      apiKey: "test",
      timeoutMs: 10000,
      fetch: async (_url, init) => {
        sent = JSON.parse(String(init!.body));
        await new Promise<void>((resolve) => {
          const fallback = setTimeout(resolve, 100);
          init!.signal!.addEventListener(
            "abort",
            () => {
              clearTimeout(fallback);
              resolve();
            },
            { once: true },
          );
        });
        expect(init!.signal!.aborted).toBe(true);
        throw new DOMException("Timed out", "TimeoutError");
      },
    });
    const events = [];
    for await (const event of limited.stream({ ...request, maxTokens: 128, latencyBudgetMs: 10 }))
      events.push(event);
    expect(sent.max_tokens).toBe(128);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "diagnostic",
        diagnostic: expect.objectContaining({ code: "GATEWAY_TIMEOUT" }),
      }),
    );
  });
  it("native authoring exposes only implemented Chart features and semantic media layout", () => {
    const prompt = buildSystemPrompt({
      kit: neutral,
      capabilities: capabilitiesFor("react-native"),
      attachments: [{ id: "photo-a", kind: "image" }],
    });
    const catalog = JSON.parse(prompt.split("Catalog: ")[1]!.split("\n\n")[0]!);
    expect(catalog.components.Chart.properties.kind.enum).toEqual(["line", "bar", "scatter"]);
    expect(catalog.components.Chart.properties.bands).toBeUndefined();
    expect(prompt).toContain('"advancedCharts":false');
    expect(prompt).toContain('"placement":"left|right|above|below"');
    expect(prompt).not.toContain('kind:"line"|"bar"|"scatter"|"area"');
  });
  it("never advertises components outside allowedComponents", () => {
    const prompt = buildSystemPrompt({
      kit: neutral,
      capabilities: capabilitiesFor("react-native"),
      policy: { allowedComponents: ["Column", "Text", "Table", "Stat"] },
    });
    expect(prompt).not.toContain("explorable learning");
    for (const name of ["ControlPanel", "Formula", "Quiz", "SvgScene", "RouteMap", "Playback"])
      expect(prompt).not.toMatch(new RegExp(`\\b${name}\\b`));
    expect(prompt).toContain("numberFormat(x,0,true) groups thousands");
    // Without formula support (Flutter) the expression tree is described instead.
    const tree = buildSystemPrompt({ kit: neutral, capabilities: capabilitiesFor("flutter") });
    expect(tree).toContain("numberFormat takes value, decimal places and an optional true");
    expect(tree).not.toContain("args:{formula:");
    const markdownOnly = buildSystemPrompt({
      kit: neutral,
      capabilities: capabilitiesFor("react-native"),
      policy: { mode: "markdown-only" },
    });
    expect(markdownOnly).not.toContain("primary visual");
  });
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
