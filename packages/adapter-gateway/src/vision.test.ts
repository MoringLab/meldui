import { readFile } from "node:fs/promises";
import { AttachmentRegistry } from "@engine/core";
import { expect, it } from "vitest";
import { visionMessages } from "./vision.js";

it("only explicitly permitted registered images are resolved, with bounded verified bytes", async () => {
  const registry = new AttachmentRegistry();
  registry.attach({ id: "hidden", kind: "image", mime: "image/png", name: "Hidden" });
  let calls = 0;
  expect(
    await visionMessages(registry, async () => {
      calls++;
      throw Error("called");
    }),
  ).toEqual([]);
  expect(calls).toBe(0);
  registry.attach(
    { id: "visible", kind: "image", mime: "image/png", name: "Visible" },
    { vision: true },
  );
  const result = await visionMessages(registry, async (id) => {
    expect(id).toBe("visible");
    return { bytes: await readFile("fixtures/media/assets/coast.png"), mime: "image/png" };
  });
  expect(JSON.stringify(result)).toContain("data:image/png;base64,");
  expect(JSON.stringify(registry.views())).not.toContain("base64");
  await expect(
    visionMessages(registry, async () => ({
      bytes: new Uint8Array(3 * 1024 * 1024),
      mime: "image/png",
    })),
  ).rejects.toThrow("VISION_BYTE_LIMIT");
});
