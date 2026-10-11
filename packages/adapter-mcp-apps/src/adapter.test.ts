import { HostBridge } from "@engine/core";
import { expect, it } from "vitest";
import { z } from "zod";
import { connectMeldUIApp, createMeldUIAppBridge, meldUIResource } from "./index.js";

it("performs the real SDK handshake and validates calls across its transport", async () => {
  const endpoints: any[] = [
    {
      async start() {},
      async close() {},
      async send(message: any) {
        queueMicrotask(() => endpoints[1].onmessage?.(message));
      },
    },
    {
      async start() {},
      async close() {},
      async send(message: any) {
        queueMicrotask(() => endpoints[0].onmessage?.(message));
      },
    },
  ];
  const host = new HostBridge({
    tools: {
      double: {
        description: "Double a number",
        input: z.object({ value: z.number() }).strict(),
        handler: ({ value }) => ({ value: value * 2 }),
      },
    },
  });
  const bridge = createMeldUIAppBridge(host);
  await bridge.connect(endpoints[0]);
  const app = await connectMeldUIApp({
    transport: endpoints[1],
    autoResize: false,
    onResult: () => {},
  });
  expect(
    (await app.callServerTool({ name: "double", arguments: { value: 6 } })).structuredContent,
  ).toEqual({ value: { value: 12 } });
  await expect(
    app.callServerTool({ name: "double", arguments: { value: "bad" } }),
  ).rejects.toThrow();
  await app.close();
  await bridge.close();
  host.dispose();
  expect(() => meldUIResource("https://unapproved.test", "<p>no</p>")).toThrow();
});
