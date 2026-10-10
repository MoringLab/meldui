# Phase 2 continuation — 2026-10-11

This record covers the remaining M5 extensions, M6–M11 and the additional request for general swipe galleries and Markdown/media side layouts. Earlier M1, M4, M5 and Phase 1 records are preserved. Feature implementation is complete for the declared preview scopes; the quality/release gates below remain open. No performance benchmark was run, no public publication was attempted and no human ratings were invented.

## Delivered behavior

| Milestone | Concrete implementation | Verification / scope |
| --- | --- | --- |
| M0–M3 compatibility | Ordered answer composer, host modes/budgets, capability/fallback negotiation, history migration, typography/reduced motion, example loader and three kits | Original 30 messages preserved; kit/state/history regressions and visually distinct Brand Button/Card/Heading |
| M4 | Prior bounded native investigation preserved | No new benchmark; historical RN gate remains open |
| M5 | Safe GFM/math/code, host replacement, attachment IDs/resolvers, optional attribute-free formatting, policy enforcement, image zoom, chapters/captions and native highlighting/theme changes | XSS/policy corpus, responsive media E2E, Android image/input flows; Flutter Audio/document FileCard alternatives are explicit |
| M6 | Per-route prompt/normalization/repair/brief profiles, limited structured output, server-only authorized vision bytes, route health/backoff and controlled dev/held-out probes | Infrastructure failures are not repaired; generation and semantic success are distinct; live vision remains untested |
| M7–M8 | Eleven authoring patterns; learning controls; bounded math/arrays/RNG/ticker; SvgScene, Plot, approximate RouteMap; advanced web Chart | TS/Dart parity and independent numerical references; native continuous drag/playback and advanced Chart features are not advertised |
| M9 | Trusted web nBody/cellular/agents with step/reset/snapshot/metrics/dispose, seeded evolution/food/population and bounded history | Determinism/conservation/restore and local simulation/browser interaction; native text fallback |
| M10 | Separate static HTML/app modes; opt-in Docker/Chromium provider, network-none/resource bounds/watchdog/validated bridge and stale-proof refusal | 11/11 adversarial checks on the exact local fingerprint; actual screenshot/input/stop viewer test and five reference apps with changed readouts; mobile unsupported |
| M11 | Independent authenticated/CSRF-protected SQLite service and SDK reservation consumer | Persistence, explicit host confirmation nonce, user-scoped idempotency/conflict, rollback, cancellation/audit and injected errors; demo identity only |

Media blocks and catalog galleries accept registered attachment IDs, semantic `placement: left/right/above/below`, bounded media fraction and `layout: carousel`. Web scroll snap, RN horizontal paging and Flutter PageView support physical swipes, accessible previous/next buttons, counters and enlargement. Side-by-side blocks stack below 600px. Input/kit changes keep runtime state; gallery/modal position is ephemeral rather than part of history. [Contract and JSON example](../../hybrid/MEDIA-LAYOUT.md).

The 30-item [Showcase](http://127.0.0.1:5173/showcase.html) supplies Korean/English prompts, reference replays, learning/visual examples and policy fallbacks. A/B/C/H scope is declared per item. They are authored fixtures, not proof that a model generated or scientifically validated them. Approximate maps request real host verification. The reservation app is at [reservation.html](http://127.0.0.1:5173/reservation.html).

## Verification and change from baseline

| Check | Earlier recorded baseline | Current evidence |
| --- | --- | --- |
| TypeScript unit/integration | M5 248 tests | 315 tests / 17 files |
| Browser E2E | M5 42 tests | 66 passes across three browsers; three Docker opt-in tests skipped in ordinary CI |
| Flutter SDK/app | M5 257 + 1 | 325 + 1; analysis passed |
| Original structural fixtures | 30/30 | 30/30, original file unchanged |
| Showcase replay | 6 partial, 24 expected-fail | 30/30 reference replays; generated/semantic acceptance remains separate |
| Independent numerical checks | 6 pass, 5 expected-fail | 11/11 (compound interest, integer share conservation, normal density/integration, seeded Monty Hall, SIR conservation included) |
| Applicable browser behavior | 62 applicable passes | 62/62, including 18 resets; non-applicable rows stay in the denominator |
| Layout | Original widths/kit matrix | 320/480/720/960 × neutral/editorial × light/dark for original and hybrid cases; actual final status in scorecard |
| Brand identity | Two kits | Three-kit screenshot diff plus actual host Button/Card/Heading implementations |
| Sandbox | Deferred | 11/11 attack checks, five real reference apps with changed readouts and one real viewer interaction/stop test |
| Package consumers | 11 SDK tarballs | 12 tarballs/independent consumer/npm dry-runs, including sandbox |
| pub.dev preparation | Previous staging dry-run | Current isolated staging analysis/tests/dry-run; four warnings (owner URL plus three exact-version constraints) |

`pnpm check` passed lint/build/typecheck/tests/E2E; lint retains non-blocking warnings. `pnpm eval` preserves failed/unmeasured semantic layers rather than manufacturing a release pass. The exhaustive layout/axe matrix has a finite 10-minute test budget; its parent runner now covers that budget and does not reuse stale browser results after failure. One initial invocation exceeded the former four-minute parent budget; a second was interrupted by a source-triggered Vite reload. The final frozen-source run is recorded separately. Neither invocation was a performance benchmark or a retry loop.

Both Android apps were built in the workstation mutex and installed on `MTK0000903071707360`. Input, kit/value preservation, dark mode and scrolling passed. Physical gallery swipes advanced 1/2 to 2/2 with zero model calls. Additional three-browser composition tests verify enlargement has a 44px target and Escape closes/restores the modal. The final Expo font-family string/platform-map type regression was fixed and its typecheck/APK rebuild passed. Device settings were not changed in this continuation. A wrong Flutter picker label in the automation was corrected at invocation using its displayed selected fixture; it was not treated as an application regression. Raw screenshots/logs remain under `artifacts/device/` and `artifacts/android/`.

## Actual model and quality results

All model requests used local OmniRoute and opt-in `--live`. Each row preserves requested/reported actual identity, errors, split and denominator. No unavailable route was silently replaced by another route.

- **Routing 40:** `cfp/zai-org/glm-5.2`, reported `zai-org/glm-5.2`: 38 structurally readable, two timeouts. All completed answers were Markdown. Plain-answer routing 12/12; under-visualization 20/20 completed surface/mixed requests; media selection 0/6. This is not 38/40 task success. Duplication and semantic quality remain unmeasured. [Raw rows](routing.json).
- **Media 20:** twenty unavailable-route/gateway rows retained; no generated-media success claim. [Raw rows](media.json).
- **Multi-turn 20:** one real follow-up pass, one coarse host-only bookkeeping row, two timeouts, sixteen not-run. The newer harness requires actual changed properties/new nodes and does not count host kit/modal bookkeeping as a model edit. [Raw rows](multiturn.json).
- **Dev/held-out experiments:** baseline/compact/brief yielded readable answers, limited structured output failed on both small samples; no global default was adopted. Timings are individual first-token values, not render latency percentiles. [Experiment analysis](../../quality/experiments.md), [dev](experiments-dev.json), [held-out](experiments-heldout.json).
- **New feature smoke:** `auto/claude-sonnet` reported `openai/gpt-oss-120b` and produced a valid left/Markdown/carousel object inside a pretty JSON fence. Strict decoding retained it as Markdown; opt-in framing normalization recovered that one captured case offline. A second calculator request timed out at the host budget. Safe framing buffering trades incremental display for validation and stays opt-in. [Captured result](framing-capture.json), [original rows](feature-smoke.json).

The original learning proxy remains 0/12. New Showcase learning quality, duplication ≤20%, the ≥10/12 rubric and semantic task behavior have not been human-calibrated. [Twenty samples/rating sheet](../../../eval/human/README.md) are ready and blank. The comparison tool prints UNCALIBRATED until twenty unique complete ratings are available; it never estimates human scores.

## Remaining release gates

- A usable route and larger dev/held-out generation/routing/media runs; live adversarial attachment-injection and explicit vision checks.
- Human learning scores/judge calibration, duplication, paired hybrid first-meaningful-render latency, new-visual frame budgets and broader native accessibility. Screenshot/replay success does not satisfy these automatically.
- Historical RN p95 around 770–790ms and incomplete causal UI-thread/heap traces; prior Flutter 109.97/89.68ms is preserved, not remeasured. [M4 record](../phase2/M4.md).
- iOS jobs are configured but were not executed on this Linux workstation. Native simulations/sandbox/continuous scene gestures have declared fallbacks.
- Sandbox is a local experimental screenshot/input replay provider, not a persistent low-latency app session or certified production isolation. Deployments need an independent threat review; signed asset URLs/auth remain host responsibilities.
- Remaining dependency audit: one moderate `uuid` and two high `node-forge`/`braces` transitive build-tool advisories. These were traced to Expo/config/signing/glob tooling rather than model input paths, but are not declared harmless or fixed. Runtime Markdown/math dependencies were updated. [Dependency summary](dependencies.json); full local audit and license inventory are retained under `artifacts/`.
- Owner, public package/repository names and private security contact remain unset. Packages remain private; npm/pub.dev were dry-runs only.

[Command/artifact index](verification.json), [current scorecard](final.json), [per-item Showcase coverage](showcase-status.md), [implementation contracts](../../VISUALS.md), [release steps](../../RELEASING.md) and the raw local artifact index keep these gates concrete and reviewable.
