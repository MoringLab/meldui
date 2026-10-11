# MeldUI Phase 3 — verification, 2026-10-11

This is a private implementation preview, not a claim that an arbitrary model reliably creates every interface. Original A2UI fixtures, wire identifiers and Phase 2 reports are preserved. Claude's native surface framing, number grouping and finished-Markdown memoization changes are retained.

## Implemented scope

- Additive `defineComponent()` / `extendKit()` catalog and Kit discovery, portable schemas/slots/examples/capabilities and compiled host implementations on all three targets. PartInspector, EquationControls and ReservationCard are independent consumers.
- Host-owned answer layout/surface presentation, safe Markdown/math/media replacement, chrome-free service embedding and active Kit propagation into live widgets.
- Standard SVG-to-common-scene compilation, named parts, bound typed transforms, keyframe interpolation, part actions, zoom/pan where supported, units/formatting and Plot domains/highlights. The source SVG subset is explicit in [PHASE3.md](../../PHASE3.md); this is not a general browser SVG implementation.
- Intent-based presentation selection, focused prompts, streamed validated render tools and NDJSON fallback. Automatic requests have a three-call maximum. Rejected tool arguments and precise SVG attr diagnostics now reach repair; infrastructure errors keep their real cause.
- Revisioned validated artifact updates/history, dirty-input protection, cancellation, schema-validated HostBridge tools and host confirmation.
- Opt-in persistent live HTML/CSS/JS iframe provider, CSS/HTML-only previews, approved Three.js/D3/Chart.js/KaTeX/GSAP resources, trusted host custom elements, theme/state preservation and stop/dispose. Strict Docker provider remains separate.
- Optional CopilotKit descriptors/shared state/Open UI conversion and actual MCP Apps SDK resource/transport/AppBridge integration. These do not become core dependencies.
- All thirty Showcase replays revised to avoid forced generic explanation/quiz blocks. Ten flagship examples reviewed at 320/960; service fixtures add purchase sorting/filtering, period KPIs, multistep quiz, conditional settings, SVG progress, ecology and media mosaic.

## Verification

| Check | Result |
|---|---|
| `pnpm check` | lint, build, typecheck, unit tests and web E2E pass |
| Latest TypeScript unit tests | 353 pass, 24 files |
| Chromium / Firefox / WebKit | 174 pass; 3 optional Docker viewer tests skipped in normal E2E |
| Changed visual/interaction subset | 120 pass across three browsers |
| Flutter SDK | 335-test suite passes plus the added part-disclosure/semantics regression; analyze reports no issues |
| Flutter consumer | 1 input/Kit persistence test passes; analyze reports no issues |
| Expo | typecheck and lint pass; two existing effect-lifecycle lint warnings retained |
| Native release builds | separate Expo/Hermes and Flutter arm64 APKs built and installed on MTK0000903071707360 |
| Android functional flows | input and three-Kit/theme flows pass for both apps; custom components displayed on both; physical part-slider changes verified on both |
| Image carousel physical swipe | both apps advance 1/2 → 2/2; no preference changes |
| Packed npm consumers | all fourteen private packages packed; React/custom catalog consumer and npm publish dry-runs pass |
| pub.dev staging | validation completes with three intentional pinned-dependency warnings; dry-run uses `--ignore-warnings`, no publication |
| Strict provider | eleven attack checks pass under recorded fingerprint; independent from iframe assurances |
| Visual review | five listed material fixes scored resolved by fresh reviewer; scope is the fix list, not live-model/native quality |

Earlier failed checks are kept in local raw logs: wrong test color expectation, tuple Table indexing and Flutter Checkbox material ancestry were fixed before final verification. The first pub staging command returned warning status65; clean isolated staging and `--ignore-warnings` complete the dry-run without changing pinned dependencies. A later native pass exposed merged Flutter surface semantics and a long part-action list. Descendant semantics are now separate and part actions are disclosed in a compact expansion; a real Flutter slider drag changes the bound value after rebuilding/installing. Part disclosure and learning controls use Kit colors and reduced-motion duration. No human evaluation scores were invented.

## Generation evidence and limits

The requested fixed batch retains every denominator. These results predate the final diagnostic/prompt fixes and measure structure, not task success:

| Set | Requested | First structurally valid | Valid after correction | Infrastructure recorded | Bounded not attempted |
|---|---:|---:|---:|---:|---:|
| Routing | 40 | 14 | 16 | 22 | 0 |
| Media | 20 | 0 | 0 | 1 | 0 |
| Showcase KO/EN | 60 | 0 | 0 | 55 | 53 |
| Secondary held-out | 13 | 0 | 0 | 0 | 0 |

Nineteen media and thirteen secondary rows contain generic `PRESENTATION_UNAVAILABLE` errors that previously hid the cause. They are retained as recorded; they cannot be reinterpreted as proven model-quality failures or successes. Fifty-three Showcase rows were not sent after the bounded infrastructure stop; they remain in the requested denominator and are explicitly distinct from completed requests. Follow-up retains 20 rows: 10 coarse host/state checks pass, 9 fail, 1 not run. It does not establish the required ≥90% semantic behavior gate.

A bounded post-fix dev probe records a plain fact and an interactive request passing first try (2/2). One real bicycle scene succeeds after one repair: 102 flattened shapes, two sliders, and a local geometry change with zero model requests during manipulation. Two media dev probes are structurally valid after at most one repair; one produces the registered photo media block, the other a Gallery inside a surface answer. Their small size and dev membership do not validate the ≥90/95% routing, 18/20 media or ≥90% behavioral targets. No full-batch improvement is claimed.

See [quality-summary.json](quality-summary.json), per-request JSON, and [generated-scene-behavior.json](generated-scene-behavior.json). Raw source/wire is stored only for synthetic local evaluation. No model or gateway key is bundled into apps.

## Performance and execution boundaries

M4 remains closed; no cold/warm benchmark loop or replacement p95 ran. One short web scene trace records twelve automation-to-two-frame samples and its trace archive under `artifacts/phase3/`. This includes driver overhead and is not pure render latency. Android gfxinfo snapshots are supporting frame evidence, not a new cross-platform performance score. Prior RN latency and GC/layout explanation remain open.

Live iframe mode offers browser isolation, not hard CPU/memory limits or a proof that all network paths are blocked. Strict isolation is tied to a verified Docker fingerprint. Native free-form code and continuous SVG gestures retain declared unsupported/fallback contracts; host-built native components and explicit sliders remain usable. Default source-SVG defs/filters/external references are rejected. Real media/storage/maps and business actions require host providers and permission.

## Open release gates

Generation routing/semantic/media targets remain unproven, as do twenty actual human ratings and judge calibration. Comprehensive native TalkBack, font-scaling, background/rotation coverage and production resource isolation are not certified by these representative checks. macOS/iOS jobs are configured but were not executed for this local change; public-source push is outside the approved automatic scope. Registry ownership/names and private security reporting contact remain unresolved; no package registry, public repository, deployment or automatic merge is performed.

Raw logs, traces, APKs and complete captures remain in `artifacts/phase3/`; selected evidence is retained beside this report. Earlier dated reports are not overwritten.

Native finishing check: part actions are collapsed until requested and descendant inputs keep their own semantics. Kit colors and reduced-motion duration apply to that disclosure. The final Flutter APK was rebuilt and installed after this adjustment; the added regression and all 43 Showcase widget checks pass. Source publication and remote iOS CI remain deferred under the approved scope.
