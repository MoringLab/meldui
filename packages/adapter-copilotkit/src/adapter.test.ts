import { AnswerSession, createUIRuntime, HostBridge } from "@engine/core";
import { expect, it } from "vitest";
import { z } from "zod";
import { acceptCopilotKitActivity, copilotKitTools } from "./index.js";

it("uses validated frontend tools and executes only complete activity code", async () => {
  const bridge = new HostBridge({
    tools: {
      double: {
        description: "Double",
        input: z.object({ n: z.number() }),
        handler: ({ n }) => n * 2,
      },
    },
  });
  const tool = copilotKitTools(bridge)[0];
  expect(await tool.handler({ n: 4 })).toBe(8);
  await expect(tool.handler({ n: "bad" })).rejects.toThrow();
  const session = new AnswerSession(createUIRuntime(), { policy: { allowSandbox: true } });
  acceptCopilotKitActivity(
    session,
    "card",
    { css: "p{}", html: "<p>Hi</p>", jsFunctions: "alert(1)" },
    false,
  );
  expect(session.blocks[0].kind).toBe("sandbox");
  expect((session.blocks[0] as any).phase).toBe("preview");
  expect((session.blocks[0] as any).source).not.toContain("alert");
  acceptCopilotKitActivity(
    session,
    "card",
    { css: "p{}", html: "<p>Hi</p>", jsFunctions: "console.log(1)" },
    true,
  );
  expect(session.blocks).toHaveLength(1);
  expect((session.blocks[0] as any).phase).toBe("complete");
  session.runtime.dispose();
  bridge.dispose();
});
