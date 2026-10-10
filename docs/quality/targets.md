# Quality targets fixed in M1 (2026-10-10)

The Phase 2 brief leaves a few targets as "set in M1". They are fixed here, with the reasoning, before any behavior change so later results cannot move the goalposts. A target may be tightened later with a dated entry; it may not be loosened without recording why.

| Dimension | Target | Justification |
|---|---|---|
| Validity on the original 30 | first pass ≥27/30, repaired ≥29/30 (per route) | From the brief. Baseline: GPT 24/30 and 30/30 (neutral); Claude route unavailable (429); Gemini 9/30 and 18/30. |
| Validity on the Showcase dev set | first pass ≥90%, repaired ≥96% of dev items (per route) | Same ratios as the original 30 so numbers are comparable; applies once an item leaves `expected-fail`. Held-out reported separately, never tuned on. |
| Behavior | ≥90% of applicable scripts | From the brief. Applicable = the control exists in the fixture. `reset` is `expected-fail(M2)` until a reset action exists. |
| Numeric correctness | 100% of golden checks | A wrong number is a defect, not a rate. Tolerances (SIR, seeded Monty Hall) are explicit in the test, not widened per run. |
| Layout | 100% at 320/480/720/960 container widths, both kits, light and dark; touch targets ≥44 px; contrast (axe `color-contrast`); non-empty first paint | From the brief. Baseline shows slider inputs 16 px tall and viewport-based media queries, both fixed in M2/M3. |
| Learning design | ≥10/12 with every item ≥1 (brief); ≥80% of Path A and H Showcase dev items meet it | 80% leaves room for items that are legitimately not explorables. The judge is **uncalibrated** until the user rates 20 samples by hand; the structural proxy is reported separately and never substituted for human ratings. |
| Routing | over-visualization ≤10%, under-visualization ≤15%, duplication ≤20% | Over/under from the brief. Duplication 20%: a fallback line and a one-sentence takeaway legitimately restate part of a surface, so 0% is not realistic; required `fallbackText` is excluded from the count. Revisit after the first hybrid measurement. |
| Media | valid ids, no fabricated URLs, alt text present: 100% each | A fabricated URL or missing alt is a rule violation (Rules 5 and 9). |
| Safety | XSS corpus, attachment-injection suite, sandbox isolation: 100% | Any single bypass is a vulnerability. |
| Performance | web p95 ≤100 ms; Android p95 ≤200 ms; ≥100 samples per condition | With 30 samples p95 is the 2nd-worst value; ≥100 samples needed for a stable tail. |
| Latency | hybrid first meaningful paint ≤ max(1.2× markdown-only baseline, baseline +100 ms) | A relative bound alone is too tight for fast baselines; an absolute bound alone is too loose for slow ones. |

## Dev / held-out split

`eval/split.json` is generated once by `scripts/eval/split.ts` (seed 20261010, stratified by prompt type so each stratum is split about 70/30; strata with fewer than 2 prompts stay in dev). Existing ids are never reassigned; new prompts are appended. Result: original 20/10, routing 27/13, media 12/8, multi-turn 12/8, Showcase 21/9. Media and multi-turn hold out 40% because their strata are tiny; the overall split is about 68/32.
Tune examples, prompts and repair rules on **dev only**. Never edit a held-out prompt to make it pass; add fresh held-out prompts periodically instead.
