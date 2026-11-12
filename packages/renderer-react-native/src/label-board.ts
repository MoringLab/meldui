// Words in a drawing never sit on top of each other. A model places labels by coordinates it
// computed in its head, and two of them often land in the same spot (a value over its neighbour's,
// a legend over an axis title). Each label of a drawing tells the board the box it would take; the
// board moves the later of two colliding labels the shortest way clear (up or down, then sideways),
// and only the labels that moved draw again.

export type LabelBox = { x: number; y: number; w: number; h: number };
type Shift = { dx: number; dy: number };

const NONE: Shift = { dx: 0, dy: 0 };
const PAD = 1.5;

/** How wide `text` draws at `font` px, near enough (Hangul and CJK about a square, Latin about half). */
export function labelWidth(text: string, font: number): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    w +=
      code > 0x2e7f
        ? font * 0.98
        : ch === " "
          ? font * 0.28
          : /[il.,:;'|!]/.test(ch)
            ? font * 0.28
            : /[A-Z0-9mwMW%]/.test(ch)
              ? font * 0.64
              : font * 0.54;
  }
  return w;
}

const overlap = (a: LabelBox, b: LabelBox) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? { w, h } : null;
};

/** Worth moving: more than a sliver of the smaller box is covered. */
const collides = (a: LabelBox, b: LabelBox) => {
  const o = overlap(a, b);
  if (!o || o.h <= 2 || o.w <= 2) return false;
  return o.w * o.h > 0.12 * Math.min(a.w * a.h, b.w * b.h);
};

const moved = (b: LabelBox, s: Shift): LabelBox => ({ ...b, x: b.x + s.dx, y: b.y + s.dy });

/** Where each label goes, first come first placed (the order the drawing lists them). */
export function placeLabels(boxes: [string, LabelBox][], width: number, height: number): Map<string, Shift> {
  const out = new Map<string, Shift>();
  const placed: LabelBox[] = [];
  const inside = (b: LabelBox) => b.y >= -1 && b.y + b.h <= height + 1 && b.x >= -b.w * 0.25 && b.x + b.w <= width + b.w * 0.25;
  const free = (b: LabelBox) => !placed.some((p) => collides(b, p));
  for (const [id, box] of boxes) {
    let shift = NONE;
    if (!free(box)) {
      // Candidates: just clear of each label it hits, above or below, then left or right.
      const hits = placed.filter((p) => collides(box, p));
      const tries: Shift[] = [];
      for (const p of hits) {
        tries.push({ dx: 0, dy: p.y + p.h + PAD - box.y }, { dx: 0, dy: p.y - PAD - (box.y + box.h) });
      }
      for (const p of hits) {
        tries.push({ dx: p.x + p.w + PAD - box.x, dy: 0 }, { dx: p.x - PAD - (box.x + box.w), dy: 0 });
      }
      // Clear of a second label after the first move (a column of values).
      for (const t of tries.slice(0, hits.length * 2)) {
        const b = moved(box, t);
        for (const p of placed.filter((q) => collides(b, q))) {
          tries.push({ dx: 0, dy: t.dy + (t.dy >= 0 ? p.y + p.h + PAD - b.y : p.y - PAD - (b.y + b.h)) });
        }
      }
      const fits = tries
        .filter((t) => Math.abs(t.dy) <= box.h * 3 && Math.abs(t.dx) <= Math.max(box.w, 40))
        .map((t) => ({ t, b: moved(box, t) }))
        .filter(({ b }) => inside(b) && free(b))
        .sort((a, b) => Math.hypot(a.t.dx, a.t.dy * 1.2) - Math.hypot(b.t.dx, b.t.dy * 1.2));
      shift = fits[0]?.t ?? NONE;
    }
    if (shift !== NONE) out.set(id, shift);
    placed.push(moved(box, shift));
  }
  return out;
}

/** One drawing's labels: their boxes in, their shifts out. */
export class LabelBoard {
  private boxes = new Map<string, LabelBox>();
  private shifts = new Map<string, Shift>();
  private listeners = new Map<string, () => void>();
  private due = false;

  constructor(
    private width: number,
    private height: number,
  ) {}

  resize(width: number, height: number) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.schedule();
  }

  /** A label's box where its coordinates put it (null: it draws nothing now). */
  set(id: string, box: LabelBox | null) {
    const old = this.boxes.get(id);
    if (!box) {
      if (!old) return;
      this.boxes.delete(id);
    } else {
      if (old && old.x === box.x && old.y === box.y && old.w === box.w && old.h === box.h) return;
      this.boxes.set(id, box);
    }
    this.schedule();
  }

  shift(id: string): Shift {
    return this.shifts.get(id) ?? NONE;
  }

  subscribe(id: string, fn: () => void) {
    this.listeners.set(id, fn);
    return () => {
      this.listeners.delete(id);
      this.set(id, null);
    };
  }

  private schedule() {
    if (this.due) return;
    this.due = true;
    // Once every label of this render has said where it is.
    Promise.resolve().then(() => {
      this.due = false;
      const next = placeLabels([...this.boxes], this.width, this.height);
      const changed: string[] = [];
      for (const id of new Set([...this.shifts.keys(), ...next.keys()])) {
        const a = this.shifts.get(id) ?? NONE;
        const b = next.get(id) ?? NONE;
        if (Math.abs(a.dx - b.dx) > 0.5 || Math.abs(a.dy - b.dy) > 0.5) changed.push(id);
      }
      this.shifts = next;
      for (const id of changed) this.listeners.get(id)?.();
    });
  }
}
