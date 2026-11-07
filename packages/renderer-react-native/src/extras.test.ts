import { describe, expect, it } from "vitest";
import { monthWeeks } from "./month.js";
import { sanitizeSvg, svgAspect } from "./svg-markup.js";

describe("sanitizeSvg", () => {
  it("keeps shapes, text and gradients", () => {
    const out = sanitizeSvg(
      '<svg viewBox="0 0 100 50" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><rect width="100" height="50" fill="url(#g)"/><text x="10" y="30" font-size="12">안녕 &amp; hi</text></svg>',
    );
    expect(out).toContain('<linearGradient id="g">');
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain("안녕 &amp; hi</text>");
  });
  it("drops scripts, styles, links, images, handlers and outside addresses", () => {
    const out = sanitizeSvg(
      '<svg viewBox="0 0 10 10"><script>alert(1)</script><style>*{fill:red}</style><a href="https://x.com"><rect width="5" height="5"/></a><image href="https://x.com/a.png"/><circle r="3" onclick="alert(1)" fill="url(https://x.com/p)" stroke="#000"/><foreignObject><div>x</div></foreignObject></svg>',
    )!;
    expect(out).not.toMatch(/script|style|alert|href|image|foreignObject|x\.com|onclick/);
    expect(out).toContain('<circle r="3" stroke="#000"/>');
  });
  it("needs an svg root with something in it", () => {
    expect(sanitizeSvg("<rect width='1' height='1'/>")).toBeNull();
    expect(sanitizeSvg("<svg></svg>")).toBeNull();
    expect(sanitizeSvg("<svg><circle r='1'/></svg>")).toBe('<svg><circle r="1"/></svg>');
  });
  it("reads the aspect from viewBox or size", () => {
    expect(svgAspect('<svg viewBox="0 0 200 100">')).toBe(2);
    expect(svgAspect('<svg width="30" height="60">')).toBe(0.5);
    expect(svgAspect("<svg>")).toBe(1);
  });
});

describe("monthWeeks", () => {
  it("lays out a month in full weeks with events and ranges", () => {
    const weeks = monthWeeks(
      "2026-11",
      [
        { date: "2026-11-07", title: "치과", time: "15:00" },
        { date: "2026-11-10", end: "2026-11-12", title: "출장" },
      ],
      [{ start: "2026-11-14", end: "2026-11-16", label: "여행" }],
      "sun",
    );
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    // 1 Nov 2026 is a Sunday.
    expect(weeks[0]![0]!.date).toBe("2026-11-01");
    const days = weeks.flat();
    expect(days.find((d) => d.date === "2026-11-07")!.events.map((e) => e.title)).toEqual(["치과"]);
    expect(days.filter((d) => d.events.some((e) => e.title === "출장")).map((d) => d.day)).toEqual([
      10, 11, 12,
    ]);
    // The range crosses a week: its first day of each week is rounded.
    const r15 = days.find((d) => d.date === "2026-11-15")!.ranges[0]!;
    expect([r15.first, r15.last]).toEqual([true, false]);
    expect(days.find((d) => d.date === "2026-11-14")!.ranges[0]!.last).toBe(true);
  });
  it("starts weeks on Monday when asked", () => {
    const weeks = monthWeeks("2026-11", [], [], "mon");
    expect(weeks[0]![0]!.date).toBe("2026-10-26");
    expect(weeks.at(-1)!.at(-1)!.date >= "2026-11-30").toBe(true);
  });
});
