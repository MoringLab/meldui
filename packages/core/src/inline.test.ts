import { describe, expect, it } from "vitest";
import { inlineRuns } from "./inline.js";

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
