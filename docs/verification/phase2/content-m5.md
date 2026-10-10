# Scorecard — content-m5

Generated 2026-10-10T12:13:15.413Z from `artifacts/eval/*.json`. Met 9 · missed 5 · open 9 · expected-fail 1.

| Dimension | Target | Measured | Status |
|---|---|---|---|
| Validity · cx/gpt-5.6-sol-medium | first pass ≥27/30, repaired ≥29/30 | 24/30 first pass, 30/30 repaired, 0 jobs with infra errors | **missed** |
| Validity · agy/claude-sonnet-4-6 | first pass ≥27/30, repaired ≥29/30 | 0/30 first pass, 0/30 repaired, 30 jobs with infra errors | **open** |
| Validity · agy/gemini-3.7-flash-medium | first pass ≥27/30, repaired ≥29/30 | 9/30 first pass, 18/30 repaired, 0 jobs with infra errors | **missed** |
| Validity · replay fixtures (offline) | 30/30 | 30/30 pass | **met** |
| Behavior (slider/tabs/checkbox/button/form) | ≥90% of applicable scripts | 62/62 applicable pass (100%); reset: 0 expected-fail(M2) | **met** |
| Numeric correctness | 100% of golden checks | 6/11 pass, 5 expected-fail | **expected-fail** |
| Layout · overflow (320/480/720/960 × 2 kits × 2 modes) | 100% of fixtures clean | 30/30 fixtures clean | **met** |
| Layout · touch-44 (320/480/720/960 × 2 kits × 2 modes) | 100% of fixtures clean | 30/30 fixtures clean | **met** |
| Layout · contrast (320/480/720/960 × 2 kits × 2 modes) | 100% of fixtures clean | 30/30 fixtures clean | **met** |
| Layout · first-paint (320/480/720/960 × 2 kits × 2 modes) | 100% of fixtures clean | 30/30 fixtures clean | **met** |
| Learning design (structural proxy; judge uncalibrated) | ≥10/12 with every item ≥1; ≥80% of Path A/H items | 0/12 pass, 12 fail | **missed** |
| Routing | over-viz ≤10%, under-viz ≤15%, duplication ≤20% | 1/41 pass, 40 not-run | **open** |
| Media | valid ids, no fabricated URLs, alt text: 100% each | 0/20 pass, 20 not-run | **open** |
| Multiturn | state preserved and edit applied ≥90% | 0/20 pass, 20 not-run | **open** |
| Media:registration | host metadata/IDs accepted in all 20 cases | 20/20 pass | **met** |
| Safety | XSS corpus + injection suite 100% | 35/36 pass, 1 not-run | **open** |
| Showcase | 30 items implemented or expected-fail with unlocking milestone | 0/30 pass, 24 expected-fail, 6 not-run | **open** |
| Performance · Web (Phase 1 baseline) | p95 ≤100 ms with ≥100 samples | p95 38 ms from 30 samples; unchanged historical baseline | **open** |
| Performance · Android Flutter cold runtime | 100-node first frame p95 ≤200 ms with ≥100 samples | p95 110 ms from 120 samples; existing M4 run | **met** |
| Performance · Android Flutter warm runtime | 100-node first frame p95 ≤200 ms with ≥100 samples | p95 90 ms from 120 samples; existing M4 run | **met** |
| Performance · Android React Native cold runtime | 100-node first frame p95 ≤200 ms with ≥100 samples | p95 790 ms from 120 samples; existing M4 run | **missed** |
| Performance · Android React Native warm runtime | 100-node first frame p95 ≤200 ms with ≥100 samples | p95 781 ms from 120 samples; existing M4 run | **missed** |
| Latency · first meaningful paint of hybrid answer | ≤ max(1.2× markdown baseline, +100 ms) | hybrid stream exists; paired baseline latency not measured | **open** |
| Accessibility | axe clean on demos; keyboard; reduced motion | web axe and reduced-motion wiring covered; iOS runner and expanded native audit open | **open** |

`expected-fail` rows are registered checks whose feature is not built yet; each names the milestone that unlocks it. They stay in the denominator.
