import { describe, expect, it } from "vitest";
import { compileMarkup } from "./markup.js";
import { readableText } from "./readable.js";

const read = (src: string) => readableText(compileMarkup(src, { final: true }));

describe("readableText", () => {
  it("writes a collection as a list", () => {
    expect(
      read(
        `<Collection layout="strip" title="애플 제품" items={[{"image":"i1","title":"iPhone","subtitle":"스마트폰"},{"image":"i2","title":"Mac"}]} />`,
      ),
    ).toBe("애플 제품\n- iPhone — 스마트폰\n- Mac");
  });

  it("writes a diagram as boxes and arrows", () => {
    expect(
      read(
        `<Diagram title="관계" nodes={[{"id":"a","label":"최서희","sub":"주인공"},{"id":"b","label":"길상"}]} edges={[{"from":"a","to":"b","label":"부부"}]} />`,
      ),
    ).toBe("관계\n- 최서희 — 주인공\n- 길상\n최서희 → 길상: 부부");
  });

  it("writes a table as rows and reads bound state", () => {
    const text = read(
      `{@state price = 39900}\n<Table caption="가격" columns={[{"key":"n","label":"상품"},{"key":"p","label":"가격"}]} rows={[{"n":"후드","p":"39,900원"}]} />\n<Stat label="합계" value={price} unit="원" />`,
    );
    expect(text).toBe("가격\n상품 | 가격\n후드 | 39,900원\n합계: 39900 원");
  });

  it("gives buttons nothing and keeps nested text in order", () => {
    expect(read(`<Box direction="row"><Text>안녕</Text><Button label="눌러" /></Box>`)).toBe(
      "안녕",
    );
  });
});

describe("markup bindings", () => {
  it("binds an expression on a text-or-number prop", () => {
    const c = compileMarkup(
      `{@state price = 3}\n<Stat label="a" value={price} />\n<Stat label="b" value={price * 2} />`,
      { final: true },
    );
    expect(c.components[1]?.value).toEqual({ path: "/price" });
    expect(c.components[2]?.value).toMatchObject({ call: "computeString" });
  });
});
