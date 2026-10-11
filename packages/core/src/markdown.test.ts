import { describe, expect, it } from "vitest";
import { splitMarkdownBlocks } from "./markdown.js";

describe("splitMarkdownBlocks", () => {
  it("splits at blank lines but keeps fences, math and indented continuations whole", () => {
    const text = [
      "# 제목",
      "",
      "첫 문단이에요.",
      "",
      "```py",
      "a = 1",
      "",
      "b = 2",
      "```",
      "",
      "$$",
      "x",
      "",
      "y",
      "$$",
      "",
      "- 하나",
      "",
      "  이어지는 내용",
      "- 둘",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n");
    expect(splitMarkdownBlocks(text)).toEqual([
      "# 제목",
      "첫 문단이에요.",
      "```py\na = 1\n\nb = 2\n```",
      "$$\nx\n\ny\n$$",
      "- 하나\n\n  이어지는 내용\n- 둘",
      "| a | b |\n|---|---|\n| 1 | 2 |",
    ]);
  });

  it("keeps finished blocks identical while text streams in", () => {
    const full = "가나다 라마.\n\n두 번째 문단이에요.\n\n```\ncode\n\nmore\n```\n\n끝.";
    let previous: string[] = [];
    for (let i = 1; i <= full.length; i++) {
      const blocks = splitMarkdownBlocks(full.slice(0, i));
      // Every block except the last one is final and must not change afterwards.
      for (const [index, block] of previous.slice(0, -1).entries())
        expect(blocks[index]).toBe(block);
      previous = blocks;
    }
  });

  it("does not split documents with reference definitions", () => {
    expect(splitMarkdownBlocks("[a][x]\n\n문단\n\n[x]: https://example.com")).toHaveLength(1);
    expect(splitMarkdownBlocks("  \n")).toEqual([]);
  });
});
