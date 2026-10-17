import { describe, expect, it } from "vitest";
import { entitiesIn, entityLinks, parseEntityUrl } from "./entities.js";
import { prepareMarkdown } from "./markdown.js";

describe("entity links", () => {
  it("[[…]] becomes an entity link that survives the Markdown boundary", () => {
    const md = entityLinks("[[구글|Google · 기업 · 1998]]은 ==검색== 회사예요.");
    const [part] = prepareMarkdown(md) as { markdown: string }[];
    const url = /\((entity:[^)]+)\)/.exec(part!.markdown)?.[1] as string;
    expect(parseEntityUrl(url, "구글")).toEqual({
      text: "구글",
      name: "Google",
      hints: ["기업", "1998"],
    });
    expect(part!.markdown).toContain("==검색==");
  });
  it("a plain [[name]] names itself; a half-written one streams as words", () => {
    expect(entitiesIn("[[Apple]] 그리고 [[소나기|소나기 · 소설 · 황순원]]")).toEqual([
      { text: "Apple", name: "Apple", hints: [] },
      { text: "소나기", name: "소나기", hints: ["소설", "황순원"] },
    ]);
    expect(entityLinks("작가 [[황순", true)).toBe("작가 황순");
    expect(entityLinks("작가 [[황순원|황순원 · 작", true)).toBe("작가 황순원");
  });
});

describe("names with a middle dot", () => {
  it("keeps 3·1 운동 whole and splits only on spaced dots", () => {
    expect(entitiesIn("[[3·1 운동|3·1 운동 · 독립운동 · 1919]]")).toEqual([
      { text: "3·1 운동", name: "3·1 운동", hints: ["독립운동", "1919"] },
    ]);
  });
});
