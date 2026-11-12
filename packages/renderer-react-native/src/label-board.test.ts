import { describe, expect, it } from "vitest";
import { labelWidth, placeLabels } from "./label-board.js";

describe("labels in a drawing", () => {
  it("moves the later of two labels on the same spot clear of the first", () => {
    const shifts = placeLabels(
      [
        ["a", { x: 40, y: 50, w: 60, h: 16 }],
        ["b", { x: 44, y: 54, w: 60, h: 16 }],
      ],
      300,
      200,
    );
    expect(shifts.has("a")).toBe(false);
    const b = shifts.get("b")!;
    const y = 54 + b.dy;
    expect(y >= 66 || y + 16 <= 50).toBe(true);
  });
  it("leaves labels that only touch alone", () => {
    const shifts = placeLabels(
      [
        ["a", { x: 0, y: 0, w: 50, h: 16 }],
        ["b", { x: 0, y: 15, w: 50, h: 16 }],
      ],
      300,
      200,
    );
    expect(shifts.size).toBe(0);
  });
  it("stacks a column of values that all start on one line", () => {
    const boxes: [string, { x: number; y: number; w: number; h: number }][] = [0, 1, 2].map((i) => [
      `v${i}`,
      { x: 100, y: 80, w: 40, h: 16 },
    ]);
    const shifts = placeLabels(boxes, 300, 200);
    const ys = boxes.map(([id, b]) => b.y + (shifts.get(id)?.dy ?? 0)).sort((p, q) => p - q);
    expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(16);
    expect(ys[2]! - ys[1]!).toBeGreaterThanOrEqual(16);
  });
  it("measures Hangul wider than Latin", () => {
    expect(labelWidth("가나다", 12)).toBeGreaterThan(labelWidth("abc", 12));
  });
});
