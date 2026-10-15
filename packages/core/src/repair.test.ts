import { describe, expect, it } from "vitest";
import { AnswerDecoder, closeTruncated } from "./answer.js";
import { normalizeMathDelimiters, splitMarkdownBlocks } from "./markdown.js";

describe("truncated control lines", () => {
  it("closes objects a model left open after a complete value", () => {
    const line =
      '{"engine":"v1","block":"sandbox","mode":"app","source":"<p>{x}</p>","fallbackText":"반지름은 질량에 비례해요."';
    expect(closeTruncated(line)).toMatchObject({ block: "sandbox", source: "<p>{x}</p>" });
    expect(
      closeTruncated('{"engine":"v1","block":"media","attachments":["i1","i2"]'),
    ).toMatchObject({
      attachments: ["i1", "i2"],
    });
  });

  it("never repairs a line cut inside a string, or one that is not a control line", () => {
    expect(closeTruncated('{"engine":"v1","block":"sandbox","source":"<p>unfinish')).toBeNull();
    expect(closeTruncated('{"title":"x"')).toBeNull();
    expect(closeTruncated('{"engine":"v1"}]')).toBeNull();
    expect(closeTruncated('{"version":"v0.9","createSurface":{')).toBeNull();
    expect(closeTruncated('{"engine":"v1","block":"media","attachments":["i1",')).toBeNull();
  });

  it("decodes a repaired line, and shows a broken one's fallback text instead of a gap", () => {
    const repaired = new AnswerDecoder();
    const items = [
      ...repaired.push('{"engine":"v1","block":"sandbox","mode":"app","source":"<b>a</b>"\n'),
      ...repaired.finish(),
    ];
    expect(items).toEqual([
      { kind: "json", value: { engine: "v1", block: "sandbox", mode: "app", source: "<b>a</b>" } },
    ]);

    const broken = new AnswerDecoder();
    const out = [
      ...broken.push(
        '{"engine":"v1","block":"sandbox","fallbackText":"질량을 바꿔 보는 시뮬레이션","source":"<b>a\n',
      ),
      ...broken.finish(),
    ];
    expect(out[0]).toMatchObject({ kind: "invalid" });
    expect(
      out
        .filter((i) => i.kind === "text")
        .map((i) => (i as { text: string }).text)
        .join(""),
    ).toContain("질량을 바꿔 보는 시뮬레이션");
  });
});

describe("math delimiters", () => {
  it("rewrites \\( \\) and \\[ \\] to dollar math outside code", () => {
    expect(normalizeMathDelimiters("반지름 \\(r_s=\\frac{2GM}{c^2}\\)이에요.")).toBe(
      "반지름 $r_s=\\frac{2GM}{c^2}$\u200A이에요.",
    );
    expect(normalizeMathDelimiters("\\[\nE=mc^2\n\\]")).toBe("$$\nE=mc^2\n$$");
    expect(normalizeMathDelimiters("`\\(x\\)` 그대로")).toBe("`\\(x\\)` 그대로");
    expect(normalizeMathDelimiters("```\n\\[a\\]\n```")).toBe("```\n\\[a\\]\n```");
    expect(normalizeMathDelimiters("no math here")).toBe("no math here");
    // Markdown only closes $ before a space or punctuation: a Korean particle gets a hair space.
    expect(normalizeMathDelimiters("질량 \\(M\\)을 키우면")).toBe("질량 $M$\u200A을 키우면");
    expect(normalizeMathDelimiters("값$x$이")).toBe("값\u200A$x$\u200A이");
    expect(normalizeMathDelimiters("$5와 $10")).toBe("$5와 $10");
    expect(normalizeMathDelimiters("$$\nE=mc^2\n$$")).toBe("$$\nE=mc^2\n$$");
  });

  it("keeps display math in one block after rewriting", () => {
    const blocks = splitMarkdownBlocks(
      normalizeMathDelimiters("앞 문단\n\n\\[\na\n\nb\n\\]\n\n뒤 문단"),
    );
    expect(blocks).toHaveLength(3);
  });
});

describe("JSON slips", () => {
  it("quotes half-quoted and unquoted keys and drops trailing commas, outside strings only", async () => {
    const { repairJsonSyntax } = await import("./answer.js");
    expect(JSON.parse(repairJsonSyntax('{"op":"add",args":[1,2]}'))).toEqual({
      op: "add",
      args: [1, 2],
    });
    expect(JSON.parse(repairJsonSyntax('{op:"mul", "args":[1, true, null,],}'))).toEqual({
      op: "mul",
      args: [1, true, null],
    });
    const text = '{"text":"a,b: c, {x: 1}","k":[{"v":1}]}';
    expect(repairJsonSyntax(text)).toBe(text);
    const decoder = new AnswerDecoder();
    const items = [
      ...decoder.push(
        '{"version":"v0.9","updateDataModel":{"surfaceId":"m",path":"/","value":{}}}\n',
      ),
      ...decoder.finish(),
    ];
    expect(items).toEqual([
      {
        kind: "json",
        value: { version: "v0.9", updateDataModel: { surfaceId: "m", path: "/", value: {} } },
      },
    ]);
  });
});

describe("component salvage", () => {
  it("keeps every component that parses when one in the batch is broken", async () => {
    const { salvageComponents } = await import("./answer.js");
    const line =
      '{"version":"v0.9","updateComponents":{"surfaceId":"main","components":[{"id":"root","component":"Column","children":["a","b","c"]},{"id":"a","component":"Text","text":"ok"},{"id":"b","component":"Chart","values":{"call":"computeArray","args":{"formula":"x"}}]}},{"id":"c","component":"Text","text":"also ok"}]}}';
    expect(() => JSON.parse(line)).toThrow();
    const value = salvageComponents(line) as {
      updateComponents: { surfaceId: string; components: { id: string }[] };
    };
    expect(value.updateComponents.surfaceId).toBe("main");
    expect(value.updateComponents.components.map((c) => c.id)).toEqual(["root", "a", "c"]);
    const decoder = new AnswerDecoder();
    const items = [...decoder.push(`${line}\n`), ...decoder.finish()];
    expect(items.map((i) => i.kind)).toEqual(["invalid", "json"]);
  });
});

describe("component salvage at the end of a batch", () => {
  it("finishes the last component when a brace before the batch's closers was dropped", async () => {
    const { salvageComponents } = await import("./answer.js");
    const line =
      '{"version":"v0.9","updateComponents":{"surfaceId":"main","components":[{"id":"a","component":"Text","text":"ok"},{"id":"chart","component":"Chart","title":"잔액","kind":"line","values":{"call":"computeArray","args":{"formula":"map(range(3), $index)"}}]}}';
    const value = salvageComponents(line) as {
      updateComponents: { components: { id: string; values?: unknown }[] };
    };
    expect(value.updateComponents.components.map((c) => c.id)).toEqual(["a", "chart"]);
    expect(value.updateComponents.components[1]?.values).toEqual({
      call: "computeArray",
      args: { formula: "map(range(3), $index)" },
    });
  });
});
