import { mkdirSync, writeFileSync } from "node:fs";
import fixtures from "../../fixtures/cases.json";
import { readJson } from "./common.js";

/**
 * Builds the 20-sample rating sheet the user fills in by hand. Humans score each rubric item 0-2.
 * The sheet only lists samples; it never contains judge or proxy scores, so ratings stay independent.
 * Default samples: a category-balanced draw of the replay fixtures; pass a JSON file of
 * [{id, summary}] (e.g. later Showcase generations) as argv[2] to rate those instead.
 */
const rubric = readJson("eval/rubric/learning.json");
type Sample = { id: string; summary: string };
const samples: Sample[] = process.argv[2]
  ? readJson(process.argv[2])
  : (() => {
      const byCat = new Map<string, typeof fixtures>();
      for (const f of fixtures) byCat.set(f.category, [...(byCat.get(f.category) ?? []), f]);
      const picked: typeof fixtures = [];
      for (let round = 0; picked.length < 20; round++)
        for (const list of byCat.values()) if (list[round] && picked.length < 20) picked.push(list[round]);
      return picked.map((f) => ({ id: f.id, summary: `${f.title} — ${f.prompt}` }));
    })();
const items = rubric.items.map((i: { id: string }) => i.id);
const header = ["sample_id", "summary", ...items, "notes"];
const esc = (s: string) => `"${s.replaceAll('"', '""')}"`;
mkdirSync("eval/human", { recursive: true });
writeFileSync(
  "eval/human/rating-sheet.csv",
  `${[header.join(","), ...samples.slice(0, 20).map((s) => [s.id, esc(s.summary), ...items.map(() => ""), ""].join(","))].join("\n")}\n`,
);
writeFileSync(
  "eval/human/README.md",
  `# Human rating sheet

Rate each sample on the six rubric items, 0-2 each (see \`eval/rubric/learning.json\` for the anchors).
Open the sample in the lab (\`/?fixture=<sample_id>\`) or the screenshot, fill \`rating-sheet.csv\`, save it as
\`eval/human/ratings.csv\`, then run \`pnpm tsx scripts/eval/judge-compare.ts\`.

Until \`ratings.csv\` contains 20 complete rows the LLM judge is reported as **uncalibrated**.
`,
);
console.log(`Wrote eval/human/rating-sheet.csv (${Math.min(20, samples.length)} samples)`);
