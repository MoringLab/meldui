# Scorecard — baseline-m1

Generated 2026-10-10T09:50:02.775Z from `artifacts/eval/*.json`. Met 5 · missed 6 · open 3 · expected-fail 7.

| Dimension | Target | Measured | Status |
|---|---|---|---|
| Validity · cx/gpt-5.6-sol-medium | first pass ≥27/30, repaired ≥29/30 | 24/30 first pass, 30/30 repaired, 0 jobs with infra errors | **missed** |
| Validity · agy/claude-sonnet-4-6 | first pass ≥27/30, repaired ≥29/30 | 0/30 first pass, 0/30 repaired, 30 jobs with infra errors | **open** |
| Validity · agy/gemini-3.7-flash-medium | first pass ≥27/30, repaired ≥29/30 | 9/30 first pass, 18/30 repaired, 0 jobs with infra errors | **missed** |
| Validity · replay fixtures (offline) | 30/30 | 30/30 pass | **met** |
| Behavior (slider/tabs/checkbox/button/form) | ≥90% of applicable scripts | 27/27 applicable pass (100%); reset: 15 expected-fail(M2) | **met** |
| Numeric correctness | 100% of golden checks | 6/11 pass, 5 expected-fail | **expected-fail** |
| Layout · overflow (320/480/720/960 × 2 kits × 2 modes) | 100% of fixtures clean | 30/30 fixtures clean | **met** |
| Layout · touch-44 (320/480/720/960 × 2 kits × 2 modes) | 100% of fixtures clean | 20/30 fixtures clean | **missed** |
| Layout · contrast (320/480/720/960 × 2 kits × 2 modes) | 100% of fixtures clean | 30/30 fixtures clean | **met** |
| Layout · first-paint (320/480/720/960 × 2 kits × 2 modes) | 100% of fixtures clean | 30/30 fixtures clean | **met** |
| Learning design (structural proxy; judge uncalibrated) | ≥10/12 with every item ≥1; ≥80% of Path A/H items | 0/12 pass, 12 fail | **missed** |
| Routing | over-viz ≤10%, under-viz ≤15%, duplication ≤20% | 0/40 pass, 40 expected-fail | **expected-fail** |
| Media | valid ids, no fabricated URLs, alt text: 100% each | 0/20 pass, 20 expected-fail | **expected-fail** |
| Multiturn | state preserved and edit applied ≥90% | 0/20 pass, 20 expected-fail | **expected-fail** |
| Safety | XSS corpus + injection suite 100% | 0/4 pass, 4 expected-fail | **expected-fail** |
| Showcase | 30 items implemented or expected-fail with unlocking milestone | 0/30 pass, 30 expected-fail | **expected-fail** |
| Performance · Web 100-node first frame | p95 ≤100 ms with ≥100 samples | p95 38 ms from 30 samples (too few for a stable p95; M4 re-measures) | **open** |
| Performance · Android · React Native 100-node first frame | p95 ≤200 ms with ≥100 samples | p95 796 ms from 30 samples (too few for a stable p95; M4 re-measures) | **missed** |
| Performance · Android · Flutter 100-node first frame | p95 ≤200 ms with ≥100 samples | p95 317 ms from 30 samples (too few for a stable p95; M4 re-measures) | **missed** |
| Latency · first meaningful paint of hybrid answer | ≤ max(1.2× markdown baseline, +100 ms) | needs hybrid stream (M2) | **expected-fail** |
| Accessibility | axe clean on demos; keyboard; reduced motion | axe in Playwright e2e passes; reduced-motion wiring open (M3) | **open** |

`expected-fail` rows are registered checks whose feature is not built yet; each names the milestone that unlocks it. They stay in the denominator.
