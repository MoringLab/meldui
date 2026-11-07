// A month laid out for the Calendar component: weeks of days, what happens on each day, and
// which shaded ranges pass through it. Dates are plain YYYY-MM-DD strings (no time zones).

export type CalendarEvent = {
  date: string;
  end?: string;
  title: string;
  time?: string;
  color?: string;
};
export type CalendarRange = { start: string; end: string; label?: string; color?: string };
export type MonthDay = {
  date: string;
  day: number;
  /** In the month shown (the other days only fill the first and last week). */
  inMonth: boolean;
  events: CalendarEvent[];
  /** Ranges through this day, with whether the day starts or ends each (for rounded ends). */
  ranges: { range: CalendarRange; first: boolean; last: boolean }[];
};

const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
};

/** The weeks of `month` (YYYY-MM), each seven days, starting on Sunday or Monday. */
export function monthWeeks(
  month: string,
  events: CalendarEvent[] = [],
  ranges: CalendarRange[] = [],
  weekStart: "sun" | "mon" = "sun",
): MonthDay[][] {
  const first = parse(`${month}-01`);
  const lead = (first.getUTCDay() - (weekStart === "mon" ? 1 : 0) + 7) % 7;
  const start = new Date(first.getTime() - lead * 86_400_000);
  const nextMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
  // Each event on every day it spans (at most 62 days, so a wrong end cannot fill the grid).
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const from = parse(e.date);
    const to = e.end && e.end > e.date ? parse(e.end) : from;
    for (let t = from.getTime(), n = 0; t <= to.getTime() && n < 62; t += 86_400_000, n++) {
      const key = dayKey(new Date(t));
      byDay.set(key, [...(byDay.get(key) ?? []), e]);
    }
  }
  const weeks: MonthDay[][] = [];
  for (let t = start.getTime(); t < nextMonth.getTime(); ) {
    const week: MonthDay[] = [];
    for (let i = 0; i < 7; i++, t += 86_400_000) {
      const d = new Date(t);
      const date = dayKey(d);
      week.push({
        date,
        day: d.getUTCDate(),
        inMonth: d.getUTCMonth() === first.getUTCMonth(),
        events: (byDay.get(date) ?? []).sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "")),
        ranges: ranges
          .filter((r) => r.start <= date && date <= r.end)
          .map((range) => ({
            range,
            first: date === range.start || i === 0,
            last: date === range.end || i === 6,
          })),
      });
    }
    weeks.push(week);
  }
  return weeks;
}
