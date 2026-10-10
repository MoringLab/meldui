# Verification record — 2026-10-10

This is a working private preview, not a production release approval. Replay correctness, model validity and rendering latency are separate measurements.

## Offline and packaged checks

- TypeScript: 53 unit/fixture regressions; strict types, Biome and all package builds.
- Browsers: 15 Playwright tests across Chromium, Firefox and WebKit. All 30 shared fixtures run in both kits on each browser. Calculator input, form input, tabs, slider-to-chart updates, kit preservation and gateway failure recovery are checked. Axe checks cover the calculator demo; this is not a claim that every possible generated screen is accessible.
- Flutter SDK: 96 tests, including all 30 runtime fixtures and 60 narrow widget renders, null/deletion parity, conflict resolution, malformed UTF-8 and invalid graph isolation. The independent app checks slider math and form input across kit switches.
- Connected Android: the independent Expo and Flutter APKs render the common fixtures and support real keyboard input, kit/dark-mode changes and live OmniRoute generation. Maestro logs, screenshots and form videos remain in local `artifacts/`.
- Both apps preserve the calculator after server disconnection and return from the background. Enlarged-text and landscape screenshots were inspected; the demo header now wraps at larger font sizes. TalkBack was enabled temporarily, its service was observed and an Expo focus highlight was captured. This is a spot check, not full screen-reader certification. All changed display/accessibility settings were restored and verified after the temporary ADB disconnection.
- Packaged React consumer: ten tarballs are installed into an independent application. Server placeholder rendering, client rendering, custom catalogs, host renderer isolation/recovery and asset registry ownership are checked. npm publication is dry-run only; source manifests remain private.
- The Dart package is staged separately with shared schema/fixture assets and an independent Git root, tested and passed to `flutter pub publish --dry-run`. Registry ownership/homepage and dependency-pin warnings are release preparation items; no package is uploaded.

Reproduce with `pnpm check`, `pnpm eval`, `pnpm --filter @engine/expo-lab typecheck`, SDK/app `flutter analyze` and `flutter test`, and `pnpm exec tsx scripts/package-check.ts` after building. Use `scripts/verify-android.py` for installed-demo workflows, with `--live` for opt-in model calls. Native workstation jobs use the existing resource mutex through `scripts/native-job.sh`; ordinary CI uses direct platform commands.

## Model evaluation

The complete final 108-job record is [online-final.json](online-final.json): 30 neutral prompts and six editorial prompts per requested route, through local OmniRoute. A maximum of two repair turns is permitted. Structural success includes valid envelopes, complete graphs and resolvable expressions; semantic task usefulness is not graded by a model judge.

| Requested route | Neutral first pass | Neutral after repair | Editorial after repair |
|---|---:|---:|---:|
| cx/gpt-5.6-sol-medium | 24/30 | 30/30 | 6/6 |
| agy/claude-sonnet-4-6 | 0/30 | 0/30 | 0/6 |
| agy/gemini-3.7-flash-medium | 9/30 | 18/30 | 0/6 |

Every Claude job returned HTTP 429. Those failures measure route availability, not generated UI quality. Gemini also encountered gateway errors, alongside malformed/incomplete output and component/expression failures. Do not discard unsuccessful prompts from the denominator. Requested and response-reported identities are recorded separately; unknown identities remain null. The earlier successful baseline is retained in [online-baseline.md](online-baseline.md).

The initial targets of 27 first-pass and 29 repaired successes per 30 are not met across all routes. Default GPT repair succeeds on the final 30 prompts, but first-pass quality still misses the target. Keep the gateway errors visible and do not retry authentication, quota or transport failures as schema repair.

## Rendering measurements

A fixed 100-node surface is measured after five warm-ups with 30 samples; model waiting is excluded. Web measures accepted content through DOM commit and animation frames. Flutter profile mode measures acceptance through the test binding's completed frame. React Native release mode measures acceptance through its native layout callback. These clocks are useful local evidence rather than identical pixel-presentation instrumentation.

The web p95 is approximately 38ms, below the 100ms target. Recorded Android runs remain above the 200ms target: Flutter ranges from 206ms to 317ms after improvements; React Native's final quiet run is about 783ms despite a typical sample around 170ms. Removing continuous accessibility polling did not eliminate the tail. Do not report the median as p95 or exclude slow samples. Raw sorted timings and screenshots remain under `artifacts/`; [performance.json](performance.json) preserves the full samples.

Normal batches now validate one candidate graph before mutation; rejected batches still isolate nodes. Default catalog descriptors are cached without sharing conversation state. Flutter literal nodes avoid unnecessary data effects and share surface text styling. Further native frame/heap profiling is needed before calling the latency gate complete.

## Remaining release gates

Native p95 and model first-pass quality remain open. iOS build jobs are configured on macOS CI but were not executed on this Linux computer. Full screen-reader coverage and semantic review of all generated tasks require additional review beyond the measured checks. Desktop and the arbitrary-code sandbox are intentionally deferred. Finalize package/repository ownership and private reporting contacts before public publication.
