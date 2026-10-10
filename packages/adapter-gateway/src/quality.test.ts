import { expect, it } from "vitest";
import { modelProfile, normalizeAnswerWire, normalizeMessage, repairReport } from "./quality.js";

it("normalization is opt-in, counted, immutable, and never accepts arbitrary rewrites", () => {
  const original = {
    version: "v0.9",
    updateComponents: {
      surfaceId: "main",
      components: [
        {
          id: "x",
          component: "Range",
          label: "Input",
          value: { path: "/x" },
          min: "1",
          max: 10,
          step: 1,
        },
      ],
    },
  };
  expect(normalizeMessage(original).fixes).toHaveLength(0);
  const { value, fixes } = normalizeMessage(original, true);
  expect(fixes).toHaveLength(2);
  expect(value.updateComponents.components[0]).toMatchObject({ component: "Slider", min: 1 });
  expect(original.updateComponents.components[0]!.component).toBe("Range");
  expect(modelProfile("unknown").normalization).toBe("off");
});
it("repair suggestions carry locations/types without sensitive source values", () => {
  expect(
    repairReport([{ code: "UNKNOWN_ATTACHMENT", path: "/a", expected: "host id" }])[0],
  ).toMatchObject({ path: "/a", expected: "host id", got: "redacted invalid value" });
});
it("framing normalization only unwraps fully validated Engine control JSON when enabled", () => {
  const message = {
    engine: "v1",
    block: "media",
    attachments: ["photo-a"],
    layout: "carousel",
    placement: "left",
  };
  const wire = "Intro\n```json\n" + JSON.stringify(message, null, 2) + "\n```\nTail";
  expect(normalizeAnswerWire(wire).value).toBe(wire);
  const normalized = normalizeAnswerWire(wire, true);
  expect(normalized.fixes).toEqual([{ rule: "fenced-control", count: 1 }]);
  expect(normalized.value).toContain(JSON.stringify(message));
  for (const code of [
    '{"example":1}',
    '{"engine":"v9","block":"media"}',
    '{"engine":"v1","block":"media","attachments":["a"],"__proto__":{}}',
  ]) {
    const example = "```json\n" + code + "\n```";
    expect(normalizeAnswerWire(example, true).value).toBe(example);
  }
});
it("numeric normalization handles several literal fields together and refuses an invalid remainder", () => {
  const message = {
    updateComponents: {
      components: [
        {
          id: "s",
          component: "Slider",
          label: "x",
          value: { path: "/x" },
          min: "0",
          max: "100",
          step: "1",
        },
      ],
    },
  };
  const result = normalizeMessage(message, true);
  expect(result.fixes).toHaveLength(3);
  expect(result.value.updateComponents.components[0]).toMatchObject({ min: 0, max: 100, step: 1 });
  message.updateComponents.components[0]!.step = "garbage";
  expect(normalizeMessage(message, true).fixes).toEqual([]);
});
