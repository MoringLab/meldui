import { capabilitiesFor } from "@engine/protocol";
import { describe, expect, it } from "vitest";
import { GatewayAdapter } from "./index.js";
import { appPreview, planPresentation, renderToolResult, renderTools } from "./presentation.js";

const request = { model: "test", format: "hybrid" as const, messages: [], tools: renderTools };
function adapter(parts: unknown[]) {
  return new GatewayAdapter({
    baseUrl: "http://local/v1",
    apiKey: "test",
    fetch: async () =>
      new Response(
        parts.map((p) => "data: " + JSON.stringify(p) + "\n\n").join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      ),
  });
}
describe("complete tool execution boundaries", () => {
  it("assembles fragmented args and executes only one completed registered call", async () => {
    const events = [];
    const gateway = adapter([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "a", function: { name: "renderAnswer", arguments: '{"lines":[' } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { arguments: '"Hello"]}' } }] },
            finish_reason: "tool_calls",
          },
        ],
      },
    ]);
    for await (const event of gateway.stream(request)) events.push(event);
    const calls = events.filter((e) => e.type === "tool-call");
    expect(calls).toHaveLength(1);
    expect(renderToolResult(calls[0] as any)).toBe("Hello\n");
    expect(events.at(-1)).toEqual({ type: "complete", status: "completed" });
  });
  it("never executes partial or unregistered tool calls", async () => {
    for (const [name, args, finish] of [
      ["renderAnswer", '{"lines":[', "length"],
      ["evil", "{}", "tool_calls"],
    ]) {
      const events = [];
      for await (const e of adapter([
        {
          choices: [
            {
              delta: { tool_calls: [{ index: 0, id: "x", function: { name, arguments: args } }] },
              finish_reason: finish,
            },
          ],
        },
      ]).stream(request))
        events.push(e);
      expect(events.some((e) => e.type === "tool-call")).toBe(false);
      expect(events.at(-1)).toEqual({ type: "complete", status: "failed" });
    }
  });
  it("does not execute scripts in a partial CSS/HTML preview", () => {
    expect(
      appPreview('{"title":"A","css":"button{}","html":"<button>Go</button>","javascript":"alert(')
        ?.source,
    ).toBe("<style>button{}</style><button>Go</button>");
    expect(appPreview('{"css":"unterminated')).toBeUndefined();
  });
  it("enforces target and host policy on a presentation choice", async () => {
    const model = {
      stream: async function* () {
        yield {
          type: "text" as const,
          text: JSON.stringify({
            renderer: "code",
            purpose: "3D",
            interactions: [],
            assumptions: [],
            requiresData: false,
          }),
        };
        yield { type: "complete" as const, status: "completed" as const };
      },
    };
    expect(
      (
        await planPresentation(model, request, {
          prompt: "3D",
          capabilities: capabilitiesFor("react-native"),
        })
      ).renderer,
    ).toBe("scene");
    expect(
      (
        await planPresentation(model, request, {
          prompt: "3D",
          capabilities: capabilitiesFor("web"),
          policy: { mode: "markdown-only" },
        })
      ).renderer,
    ).toBe("markdown");
  });
});

it("preserves the real infrastructure reason when presentation selection fails", async () => {
  const model = {
    stream: async function* () {
      yield {
        type: "diagnostic" as const,
        diagnostic: {
          code: "GATEWAY_HTTP_429",
          message: "rate limited",
          severity: "error" as const,
        },
      };
      yield { type: "complete" as const, status: "failed" as const };
    },
  };
  await expect(
    planPresentation(model, request, { prompt: "test", capabilities: capabilitiesFor("web") }),
  ).rejects.toThrow("GATEWAY_HTTP_429");
});
it("keeps authored control IDs and child references intact", () => {
  const wire = renderToolResult({
    type: "tool-call",
    id: "call",
    name: "renderScene",
    args: {
      title: "Diagram",
      description: "Local controls",
      svg: '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="3"/></svg>',
      data: { amount: 0 },
      parts: {},
      controls: [
        { id: "nested", component: "Column", children: ["slider"] },
        {
          id: "slider",
          component: "Slider",
          label: "Amount",
          min: 0,
          max: 1,
          value: { path: "/amount" },
        },
      ],
    },
  });
  expect(wire).toContain('"children":["slider"]');
  expect(wire).not.toContain("control-slider");
});
