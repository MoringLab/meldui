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
      "반지름 $r_s=\\frac{2GM}{c^2}$이에요.",
    );
    expect(normalizeMathDelimiters("\\[\nE=mc^2\n\\]")).toBe("$$\nE=mc^2\n$$");
    expect(normalizeMathDelimiters("`\\(x\\)` 그대로")).toBe("`\\(x\\)` 그대로");
    expect(normalizeMathDelimiters("```\n\\[a\\]\n```")).toBe("```\n\\[a\\]\n```");
    expect(normalizeMathDelimiters("no math here")).toBe("no math here");
  });

  it("keeps display math in one block after rewriting", () => {
    const blocks = splitMarkdownBlocks(
      normalizeMathDelimiters("앞 문단\n\n\\[\na\n\nb\n\\]\n\n뒤 문단"),
    );
    expect(blocks).toHaveLength(3);
  });
});
