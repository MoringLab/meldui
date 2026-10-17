import { describe, expect, it } from "vitest";
import { inlineRuns } from "./inline.js";
import { prepareMarkdown } from "./markdown.js";

describe("inline marks in Text", () => {
  it("splits bold and highlight, Korean particles included", () => {
    expect(inlineRuns("==질량==이 커지면 **반지름**도")).toEqual([
      { text: "질량", mark: true },
      { text: "이 커지면 " },
      { text: "반지름", bold: true },
      { text: "도" },
    ]);
  });
  it("nests one level and leaves unclosed or spaced markers alone", () => {
    expect(inlineRuns("**굵게 ==강조==**")).toEqual([
      { text: "굵게 ", bold: true },
      { text: "강조", bold: true, mark: true },
    ]);
    expect(inlineRuns("a == b and 1==2")).toEqual([{ text: "a == b and 1==2" }]);
    expect(inlineRuns("==열림")).toEqual([{ text: "==열림" }]);
  });
});

describe("highlights at the start of a line", () => {
  const md = (s: string) =>
    prepareMarkdown(s, 65536, false)
      .map((p) => ("markdown" in p ? p.markdown : ""))
      .join("");
  it("keeps ==…== a highlight in paragraphs, lists and quotes", () => {
    expect(md("==시작==부터 써요")).toBe("==시작==부터 써요\n");
    expect(md("문장이에요\n==다음 줄==이에요")).toBe("문장이에요\n==다음 줄==이에요\n");
    expect(md("- ==첫째== 항목")).toBe("* ==첫째== 항목\n");
    expect(md("> ==인용== 강조")).toBe("> ==인용== 강조\n");
    expect(md("1. ==번호== 항목")).toBe("1. ==번호== 항목\n");
  });
  it("leaves a lone == escaped", () => {
    expect(md("== 혼자")).toBe("\\== 혼자\n");
  });
});
