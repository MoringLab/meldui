import { describe, expect, it } from "vitest";
import { citationPosition } from "./citation-layout.js";

const line = { x: 0, y: 58, width: 190, height: 29, rtl: false };
const pill = { width: 40, height: 24 };

describe("citationPosition", () => {
  it("follows the actual final line without scaling it to the widest line", () => {
    expect(citationPosition(line, pill, 348)).toEqual({ left: 196, top: 60.5 });
  });

  it("uses the available space exactly and wraps only when the pill cannot fit", () => {
    expect(citationPosition({ ...line, width: 302 }, pill, 348)?.left).toBe(308);
    expect(citationPosition({ ...line, width: 303 }, pill, 348)).toBeNull();
    expect(citationPosition(line, pill, 220)).toBeNull();
  });

  it("includes list indentation and a taller line at larger font sizes", () => {
    expect(citationPosition({ ...line, x: 20, height: 40 }, pill, 348)).toEqual({
      left: 216,
      top: 66,
    });
  });

  it("places RTL citations after the reading end, without going outside the field", () => {
    expect(citationPosition({ ...line, x: 100, rtl: true }, pill, 348)?.left).toBe(54);
    expect(citationPosition({ ...line, x: 30, rtl: true }, pill, 348)).toBeNull();
  });

  it("waits for both actual line and compact pill measurements", () => {
    expect(citationPosition(null, pill, 348)).toBeNull();
    expect(citationPosition(line, null, 348)).toBeNull();
    expect(citationPosition(line, pill, 0)).toBeNull();
  });
});
