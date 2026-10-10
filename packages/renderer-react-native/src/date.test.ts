import { describe, expect, it, vi } from "vitest";
import { localCalendarDate } from "./date.js";

describe("calendar date boundaries", () => {
  for (const timezone of ["America/New_York", "Asia/Seoul"]) {
    it(`keeps the full selected day in ${timezone}`, () => {
      const previous = process.env.TZ;
      process.env.TZ = timezone;
      try {
        const first = localCalendarDate("2026-10-15", "00:00:00");
        const last = localCalendarDate("2026-10-15", "23:59:59");
        const selected = localCalendarDate("2026-10-15");
        expect(first.getDate()).toBe(15);
        expect(last.getDate()).toBe(15);
        expect(first.getHours()).toBe(0);
        expect(last.getHours()).toBe(23);
        expect(selected.getTime()).toBeGreaterThan(first.getTime());
        expect(selected.getTime()).toBeLessThan(last.getTime());
      } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
      }
    });
  }
  it("uses the current date for an empty input", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2030-02-10T03:00:00Z"));
      expect(localCalendarDate().toISOString()).toBe("2030-02-10T03:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });
});
