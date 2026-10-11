import { describe, expect, it } from "vitest";
import { extractCitations } from "./citations.js";

describe("extractCitations", () => {
  it("removes markers after claims and keeps first-use order", () => {
    expect(
      extractCitations("무신사 후드는 39,900원이에요 [w2]. 나이키는 69,000원 [w1][w2]."),
    ).toEqual({
      text: "무신사 후드는 39,900원이에요. 나이키는 69,000원.",
      ids: ["w2", "w1"],
    });
    expect(extractCitations("메모에 적어 두었어요 [m1]").ids).toEqual(["m1"]);
  });

  it("leaves code, links and ordinary brackets alone", () => {
    const text = "`arr[i1]` 와 [링크](https://a.example) 그리고 [참고]\n```\nx = y[a1]\n```";
    expect(extractCitations(text)).toEqual({ text, ids: [] });
  });

  it("holds back a half-received marker while streaming", () => {
    expect(extractCitations("가격은 39,900원이에요 [w", true).text).toBe("가격은 39,900원이에요");
    expect(extractCitations("가격은 39,900원이에요 [w1", true).text).toBe("가격은 39,900원이에요");
    expect(extractCitations("배열 [", false).text).toBe("배열 [");
  });
});
