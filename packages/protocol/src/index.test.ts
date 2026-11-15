import { describe, expect, it } from "vitest";
import { componentSchemas } from "./index.js";

describe("Collection cards", () => {
  const parse = (items: unknown[]) =>
    componentSchemas.Collection.safeParse({ id: "c", component: "Collection", items });
  it("takes a rating, reviews, a detail and a next step, with or without a picture", () => {
    expect(
      parse([
        {
          title: "온더테이블",
          rating: 4.8,
          reviews: 320,
          subtitle: "한식 · 성수",
          about: "대표 메뉴",
          action: { label: "예약하기", ask: "예약해 줘" },
        },
      ]).success,
    ).toBe(true);
    expect(parse([{ image: "https://x.test/a.jpg", title: "A" }]).success).toBe(true);
  });
  it("refuses an item with neither picture nor title, and a rating past 5", () => {
    expect(parse([{ subtitle: "only a line" }]).success).toBe(false);
    expect(parse([{ title: "A", rating: 7 }]).success).toBe(false);
  });
});
