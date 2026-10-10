import { existsSync, readFileSync } from "node:fs";

export type Status = "pass" | "fail" | "expected-fail" | "not-run" | "na";
export type Row = {
  layer: string;
  id: string;
  status: Status;
  detail?: string;
  /** Milestone that unlocks an expected-fail row. */
  unlockedBy?: string;
  split?: "dev" | "heldout";
  value?: number;
};
export const readJson = <T = any>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
export const split = (set: string, id: string): "dev" | "heldout" | undefined =>
  (existsSync("eval/split.json") ? readJson("eval/split.json") : {})[set]?.[id];
export function summarize(rows: Row[]) {
  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  return {
    total: rows.length,
    pass: count("pass"),
    fail: count("fail"),
    expectedFail: count("expected-fail"),
    notRun: count("not-run"),
    na: count("na"),
  };
}

/** Minimal RFC 4180 row parser (quoted fields, doubled quotes). */
export function parseCsvLine(line: string) {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") out.push(cell), (cell = "");
    else cell += ch;
  }
  out.push(cell);
  return out;
}
export function ratingScores(cells: string[], indices: number[]): number[] | undefined {
  const raw = indices.map((i) => cells[i]?.trim());
  if (raw.some((v) => !v || !/^[012]$/.test(v))) return;
  return raw.map(Number);
}
