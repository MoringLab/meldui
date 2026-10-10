# Status — 2026-10-10

Engine is a private SDK preview for React web, React Native/Expo and Flutter. Phase 2 adds ordered Markdown/surface/media answers, host policy, fallback text, container-aware rendering, history migration, three interchangeable kits, typography and reduced-motion handling. The catalog now has 35 components; the original 30 fixture messages remain valid.

Phase 2 M0–M3 are implemented. M4 investigation is closed for this batch: existing Flutter cold/warm p95 is 109.97/89.68ms over 120+120 samples; RN remains around 770–790ms. Additional performance runs are disabled by default and require a separate explicit bounded command. Ordinary Android verification runs functional flows only. Full native UI-thread/heap traces and iOS execution remain open. See [M4](verification/phase2/M4.md).

M5's safe content display baseline is implemented: built-in GFM/math/code renderers, host Markdown replacement, ID-based attachment registries/resolvers, galleries, image comparisons, host regions, video/audio and file cards. Signed queries are excluded from model views and persisted history. Host storage, authentication, redirects and response MIME verification remain host responsibilities. Flutter audio and document viewing use explicit FileCard fallbacks.

Verification: `pnpm check` (248 TypeScript tests and 42 E2E tests across Chromium/Firefox/WebKit), offline `pnpm eval`, SDK/app Flutter analysis, 257 SDK tests plus one app test, both release APK builds and eleven packed npm consumers/dry-runs. Media-specific device evidence and publication dry-run details are in [M5](verification/phase2/M5.md). No new performance measurement was run in this continuation.

M5 acceptance remains partial: full embedded-media policy enforcement, RN Markdown theme-change contrast, optional HTML formatting, zoom, native highlighting/caption tracks, chapter controls and full adversarial live-model injection evaluation are open. M6 generation-quality experiments, M7/M8 learning patterns/visual primitives, M9 trusted simulations, M10 isolated sandbox and M11 SQLite reservation integration are outstanding. See [the scorecard](verification/phase2/content-m5.md) and [Showcase coverage](verification/phase2/showcase-status.md): 6 partial, 24 expected-fail, zero fully accepted items.

The recorded model-quality figures remain historical baselines: GPT 24/30 first pass and 30/30 repaired; Claude 30 infrastructure failures; Gemini 9/30 first pass and 18/30 repaired. New live routing/media/multi-turn quality rows are unmeasured, and the human judge remains uncalibrated. Functional replay success does not imply improved generation quality.

Packages remain private. No registry/repository publication has occurred. Vision, sandbox, external map tiles and video embeds default off. Ownership, registry names and private reporting contacts are unresolved. The Phase 1 evidence is preserved in [REPORT](verification/REPORT.md); the Phase 2 baseline and dated continuation records are separate.

Next work: finish M5 extensions and M6 controlled dev/held-out quality experiments, then learning/visual primitives. RN performance remains an open gate and will not trigger automatic benchmark retries.
