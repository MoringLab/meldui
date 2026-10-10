import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseCsvLine, readJson } from "./common.js";

/**
 * Compares judge scores with the user's hand ratings. Never generates or estimates human ratings.
 * Calibrated only when 20 complete human rows exist and mean absolute error per item is ≤0.5
 * with exact-or-adjacent agreement ≥85%.
 */
const items = readJson("eval/rubric/learning.json").items.map((i: { id: string }) => i.id);
if (!existsSync("eval/human/ratings.csv")) {
  console.log("UNCALIBRATED: eval/human/ratings.csv not found. Rate eval/human/rating-sheet.csv first.");
  process.exit(0);
}
const [head, ...lines] = readFileSync("eval/human/ratings.csv", "utf8").trim().split("\n");
const cols = parseCsvLine(head);
const human = new Map<string, number[]>();
for (const line of lines) {
  const cells = parseCsvLine(line);
  const scores = items.map((i: string) => Number(cells[cols.indexOf(i)]));
  if (scores.every((n: number) => [0, 1, 2].includes(n))) human.set(cells[0], scores);
}
if (human.size < 20) {
  console.log(`UNCALIBRATED: ${human.size}/20 complete human rows.`);
  process.exit(0);
}
const judge = readJson("artifacts/eval/judge.json").results as { id: string; scores?: Record<string, number> }[];
let n = 0;
let abs = 0;
let near = 0;
const perItem = items.map(() => 0);
for (const j of judge) {
  const h = human.get(j.id);
  if (!h || !j.scores) continue;
  items.forEach((item: string, k: number) => {
    const d = Math.abs(h[k] - j.scores![item]);
    abs += d;
    perItem[k] += d;
    near += d <= 1 ? 1 : 0;
    n++;
  });
}
const mae = abs / n;
const calibrated = mae <= 0.5 && near / n >= 0.85;
const report = { compared: n, meanAbsError: mae, withinOne: near / n, perItemMae: Object.fromEntries(items.map((i: string, k: number) => [i, perItem[k] / (n / items.length)])), calibrated };
writeFileSync("artifacts/eval/judge-calibration.json", JSON.stringify(report, null, 1));
console.log(report);
