# Status — 2026-10-10

Engine's private preview is implemented for React web, React Native/Expo and Flutter. It includes the shared 25-component A2UI catalog, local bindings/expressions/actions, two swappable kits, static host extensions, replay and AG-UI bindings, a server-only OmniRoute adapter, three independent apps and 30 shared fixtures.

M0–M4 implementation is complete. M5 verification has run, with release gates still open. M6 private distribution preparation is complete; public ownership, registry names and reporting contacts remain unresolved.

Verified: 53 TypeScript tests, strict type checks, Biome and package builds; 15 Playwright tests across three browsers; all 30 fixtures in both kits per browser; 96 Flutter SDK tests plus an independent app input/kit test; both Android APK builds and connected-device keyboard, kit, theme and OmniRoute generation workflows; ten packed npm consumers/dry-runs and a staged Dart publication dry-run. See [the full verification record](verification/REPORT.md) and [Android demonstration](media/android-demo.mp4).

Open gates: native 100-node p95 remains above the 200ms target; model first-pass success misses 27/30, with the default GPT route reaching 30/30 after repair. Claude's final run was unavailable with HTTP 429; Gemini quality/availability remain inconsistent. iOS macOS CI is configured but unexecuted locally. Expanded text, rotation, connection interruption and TalkBack evidence are recorded separately with their actual results; do not infer coverage from successful unit tests.

Packages remain private. No registry or repository publication has occurred. Desktop and the arbitrary-code sandbox are intentionally deferred. Next release work is native tail-latency profiling, model quality/availability, semantic/accessibility review and ownership finalization; ordinary CI remains offline.
