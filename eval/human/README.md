# Human rating sheet

Rate each sample on the six rubric items, 0-2 each (see `eval/rubric/learning.json` for the anchors).
Open the sample in the lab (`/showcase.html?id=<sample_id>`) or the screenshot, fill `rating-sheet.csv`, save it as
`eval/human/ratings.csv`, then run `pnpm tsx scripts/eval/judge-compare.ts`.

Until `ratings.csv` contains 20 complete rows the LLM judge is reported as **uncalibrated**.
