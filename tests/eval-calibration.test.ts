import { expect, it } from "vitest";
import { ratingScores } from "../scripts/eval/common.js";

it("blank, missing or invalid human ratings cannot become zero scores", () => {
  expect(ratingScores(["", " ", "0"], [0, 1, 2])).toBeUndefined();
  expect(ratingScores(["0", "1", "2"], [0, 1, 2])).toEqual([0, 1, 2]);
  expect(ratingScores(["0", "1", "2"], [-1, 1, 2])).toBeUndefined();
  expect(ratingScores(["0", "3", "2"], [0, 1, 2])).toBeUndefined();
});

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

it("repeating one judge sample cannot calibrate twenty distinct human samples", () => {
  const root = process.cwd(),
    dir = mkdtempSync(path.join(tmpdir(), "engine-calibration-"));
  const items = JSON.parse(readFileSync("eval/rubric/learning.json", "utf8")).items.map(
    (i: { id: string }) => i.id,
  );
  try {
    mkdirSync(path.join(dir, "eval/human"), { recursive: true });
    mkdirSync(path.join(dir, "eval/rubric"), { recursive: true });
    mkdirSync(path.join(dir, "artifacts/eval"), { recursive: true });
    writeFileSync(
      path.join(dir, "eval/rubric/learning.json"),
      JSON.stringify({ items: items.map((id: string) => ({ id })) }),
    );
    // Synthetic test scores live only in this disposable directory, never the actual evaluation.
    writeFileSync(
      path.join(dir, "eval/human/ratings.csv"),
      [
        "id," + items.join(","),
        ...Array.from({ length: 20 }, (_, i) => `sample-${i},${items.map(() => 1).join(",")}`),
      ].join("\n"),
    );
    writeFileSync(
      path.join(dir, "artifacts/eval/judge.json"),
      JSON.stringify({
        results: Array.from({ length: 20 }, () => ({
          id: "sample-0",
          scores: Object.fromEntries(items.map((id: string) => [id, 1])),
        })),
      }),
    );
    execFileSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(path.join(root, "node_modules/tsx/dist/loader.mjs")).href,
        path.join(root, "scripts/eval/judge-compare.ts"),
      ],
      { cwd: dir },
    );
    const report = JSON.parse(
      readFileSync(path.join(dir, "artifacts/eval/judge-calibration.json"), "utf8"),
    );
    expect(report.matchedSamples).toBe(1);
    expect(report.calibrated).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
