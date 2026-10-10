# Codex Prompt: Phase 2 (Unified)

> Supersedes `CODEX_PROMPT_PHASE2.md` and `CODEX_PROMPT_PHASE2_ADDENDUM.md`. Use this file alone.
> Repo: `/home/louis/Documents/.dev/engine` (working name `engine`, packages under `@engine/*`).
> Paste everything below the line into Codex.

---

## 1. Mission and product requirements

The SDK is a working **private preview**: AI-generated interactive screens for web, React Native (Expo) and Flutter, with local state and calculation, user actions, agent connection, and swappable kits. This round delivers:

- **Release gates**: Kit contract, native performance, iOS status, real-service proof, release prep.
- **Answer quality**: not just schema-valid output, but correct numbers, working interactions, good layout, good learning design, and the right choice of answer format.
- **Rich, hybrid answers**: visualizations, learning content, host-provided media, and sandboxed HTML/JS, mixed with ordinary markdown.

Product requirements (these shape every milestone):

1. The engine is a **visualization engine embedded in host services**, not the whole answer format. Hosts already render markdown chat. Answers are **hybrid**: markdown, engine surfaces and media, mixed per request. The model chooses per request. "Always use the engine" is a defect; so is "never use it when it clearly helps".
2. **Attachments (photos, videos, files) are created and stored by the host.** The host attaches a file or URL to the engine and the AI lays it out according to the engine's spec. The engine never creates, uploads or stores attachments.
3. **HTML/JavaScript** may appear in answers only through the sandbox or a sanitized markdown subset, never by injecting model output into the host page.
4. **Three levels of freedom**: catalog (validated components), kit (swappable design language and implementations), sandbox (free-form code, isolated). Catalog is the default.

Work autonomously: audit -> plan -> implement -> verify -> report. Do not wait for approval between milestones. When a decision is costly to reverse and you are unsure, pick the most reasonable default, record an ADR, and continue. Items that need the user (ownership, contacts, privacy choices) go in the final report with the default you used.

## 2. Ground truth (read first; verify, do not trust)

Read `docs/verification/REPORT.md`, `online-final.json`, `online-baseline.md`, `performance.json`, `docs/PLAN.md`, `docs/STATUS.md`, all ADRs, and the code. Baseline from the 2026-10-10 report:

- **Offline**: 53 TS unit/fixture tests; 15 Playwright tests (Chromium, Firefox, WebKit); 30 shared fixtures in both kits; Flutter SDK 96 tests; Android Expo and Flutter apps verified on a device; packaged React consumer (10 tarballs); Dart package passes `flutter pub publish --dry-run`.
- **Model eval** (108 jobs, 2 repair turns max): `cx/gpt-5.6-sol-medium` 24/30 first pass, 30/30 repaired, editorial 6/6. `agy/claude-sonnet-4-6` 0/30 (every job HTTP 429: an availability result, not a quality result). `agy/gemini-3.7-flash-medium` 9/30 first pass, 18/30 repaired, editorial 0/6 (gateway errors, malformed output, expression failures).
- **Rendering** (100 nodes, 5 warm-ups, 30 samples): web p95 about 38 ms (target 100). Android Flutter 206 to 317 ms; React Native about 796 ms in the final quiet run despite a typical sample near 170 ms (target 200).
- **Known gaps**: mobile typography tokens partly applied; `motionMs` not wired into common animation; no loader for kit `examples/`; new components need per-platform implementations; kits cannot change protocol, expression ops or client permissions; iOS jobs configured but never executed; sandbox and desktop deferred; package/repo ownership and private reporting contacts not final. The report does not mention markdown, media, attachments or HTML handling, so their status is unknown until M0.

If the code disagrees with the report, trust the code and note the discrepancy in `STATUS.md`.

## 3. Non-negotiable rules

1. **Honest measurement.** Keep every sample and denominator. Never report a median as p95, never drop slow samples or failed prompts. Classify infrastructure failures (HTTP 429, gateway, auth, quota, transport) separately, keep them visible in the denominator, and never retry them as schema repair. Record requested and response-reported model identity separately.
2. **Do not claim what you did not run** (iOS, rate-limited routes, device checks). Leave the gate open and say why.
3. **Compatibility.** All existing fixtures keep passing in both kits on every platform. Protocol additions are additive, versioned and capability-negotiated. Each renderer declares the components and expression ops it supports; unsupported ones use a declared fallback; the prompt builder advertises only what the target supports.
4. **UI is data outside the sandbox.** No `eval` / `new Function` outside it. No remote assets or network except through explicit host-provided providers with allowlists.
5. **The model never writes URLs.** It references attachments by **id**. A URL passed by the host is registered and given an id. Unknown ids render an error state and are reported for repair.
6. **Host owns auth and URL signing** via resolver interfaces. The engine never holds credentials and never uploads anything. Signed URLs are never logged; logs and eval artifacts redact them.
7. **Host-supplied text is data, not instructions.** Captions, transcripts, extracted text and filenames are delimited and labeled in the prompt and must not be able to change model behavior or trigger actions.
8. **Raw HTML never enters the host DOM.** Only a sanitized markdown subset or the sandbox may carry HTML.
9. **Every surface carries fallback text** (screen readers, copy/export, search, notifications, renderers lacking a component).
10. **Deterministic by default**: seeded RNG, fixed-step ticker in tests, replayable fixtures.
11. **Process hygiene.** Live model calls only with the opt-in `--live` flag; never commit keys; native jobs go through `scripts/native-job.sh` (the existing resource mutex); restore any device setting you change and verify the restore.
12. **Records.** Append a new dated verification record to the report after each batch (never overwrite old ones); keep raw data under `artifacts/`; commit per milestone (Conventional Commits); keep `docs/STATUS.md` current.

## 4. Quality bar and quality loop

One scorecard governs everything. Targets marked *set in M1* are decided after the baseline is measured; record the justification.

| Dimension | Check | Target |
|---|---|---|
| Validity | schema, graph, expressions | first pass 27/30 and repaired 29/30 on the original 30; same measured on the Showcase dev set (*set in M1*) |
| Behavior | scripted interactions (slider, tabs, form, reset) | at least 90% where applicable |
| Numeric correctness | golden calculators | 100% |
| Layout | no overflow at container widths 320/480/720/960; touch targets at least 44 px; contrast; non-empty first paint | 100% |
| Learning design | rubric score | *set in M1* after human calibration |
| Routing | over-visualization / under-visualization / duplication | at most 10% / at most 15% / *set in M1* |
| Media | valid ids, no fabricated URLs, alt text present | 100% each |
| Safety | XSS corpus, attachment-text injection suite, sandbox isolation | 100% |
| Accessibility | axe clean on demos, keyboard, reduced motion honored | pass |
| Performance | web p95 at most 100 ms; Android p95 at most 200 ms (100+ samples); budgets for new visuals | pass or documented, profiled gap |
| Latency | time to first meaningful paint of a hybrid answer | no regression beyond the threshold set in the plan |

Quality loop rules:

1. **Dev / held-out split.** Split prompts about 70/30. Tune on dev; report both; never edit a held-out prompt to make it pass; add fresh held-out prompts periodically.
2. **Fix systemically** (prompt, kit guide, catalog, schema, primitives). No per-prompt special cases and no hand-written fixtures presented as model output.
3. **Every fixed failure becomes a regression fixture.**
4. **Visual review**: screenshots at the container widths above, light and dark, in at least two kits, reviewed by the judge and spot-checked by a human.
5. **Per-model reporting.** Never average away a bad route; report each route and each layer separately.

## 5. Milestones (in priority order)

If budget runs short, stop at a milestone boundary with `STATUS.md` updated. Never skip M1: it is what makes every later change measurable.

### Batch 1: Measure and set contracts

#### M0. Audit and baseline

- Re-run `pnpm check` and `pnpm eval`.
- **Audit** the code for: markdown handling, `Image`/`Video`/file components, any attachment concept, raw HTML treatment, how kit guides and examples reach the prompt. Write `docs/hybrid/AUDIT.md` (exists / missing / unsafe). Do not assume.
- **Failure taxonomy** from `online-final.json`, per route: infra / invalid envelope / incomplete graph / unresolvable expression / component error / semantic problem, with counts and 2 to 3 example prompts each. Rank the top 5 causes of first-pass failure with a hypothesis and a proposed fix. Write `docs/quality/failure-taxonomy.md`.
- Add route health checks and bounded backoff so a rate-limited route is reported as unavailable instead of silently producing 0/30.
- Acceptance: audit and taxonomy committed; eval report has infra errors as their own column.

#### M1. Eval harness (before changing behavior)

Extend `pnpm eval` with layers (keep the existing structural layer):

1. **Behavioral**: Playwright scripts per category (slider changes readout and chart data, tab switch, form submit emits the right action, reset works).
2. **Numeric correctness** with golden values: compound-interest future value, dutch-pay shares sum to the total, normal pdf values, Monty Hall with a fixed seed near 1/3 (stay) and 2/3 (switch) within tolerance, SIR conservation (S+I+R=N).
3. **Layout** at container widths 320/480/720/960 (see the scorecard).
4. **Learning-content rubric**: learning goal, guided experiments, observation prompts, formula with plain-language meaning, check-understanding, simplification note.
5. **Routing set (40 prompts)**: markdown-only negatives (facts, chit-chat, short answers, code help), surface-worthy, mixed, media-worthy. Metrics: over-visualization, under-visualization, duplication score (text repeating what the surface shows), fallback-text quality, token and latency overhead versus markdown-only.
6. **Media set (20 prompts)** with synthetic host attachments: one photo, five photos, before/after pair, video with transcript, PDF with extracted text, mixed files. Checks: only valid ids, appropriate layout, alt text, no fabricated URLs, only allowlisted file actions.
7. **Safety**: XSS payload corpus through the markdown path; prompt-injection through attachment text (a transcript or filename saying to ignore instructions or open a URL).
8. **LLM judge** with a written rubric, gated by API keys, calibrated against **20 samples the user rates by hand** (generate the rating sheet and a judge-versus-human comparison script).

Also add the **Showcase harness** (section 6): Korean and English golden prompts per item, dev/held-out split, per-item checks, and an `expected-fail` status naming the milestone that unlocks each item. Add 20 **multi-turn edit prompts** ("make the slider range wider", "add a chart", "switch to the dark kit").

Acceptance: harness runs offline from replay fixtures and online with `--live`; a baseline scorecard of the current state is committed and the *set in M1* targets are fixed with justification.

#### M2. Answer protocol and host contract

- **Answer envelope**: an ordered list of blocks: `markdown`, `surface`, `media`. A `media` block shows an attachment without writing a surface. Markdown deltas and surface messages interleave in one stream; text appears immediately, surfaces appear in order. Decide by ADR whether the engine defines its own text events, relies on the host's text channel (for example an AG-UI-style carrier), or both; provide an `AnswerComposer` for hosts with separate channels.
- **Fallback text** on every surface, required by the prompt guidance.
- **Host policy**: `mode` (`auto` | `markdown-only` | `engine-only`), `maxSurfaces`, `allowedComponents`, `allowMedia`, `allowSandbox` (default **false**), token and latency budgets. The prompt builder adapts; with `markdown-only` or `allowSandbox: false` the model is not told those capabilities exist.
- **Routing guidance** for the model: markdown for facts, explanations, chat and short answers; a surface when interaction, computation, comparison with controls or a visualization materially helps; combine as short intro, surface, brief takeaway; never repeat the same content in both.
- **Capability negotiation**: renderers declare supported components and expression ops; declared fallbacks; the prompt advertises only what the target supports.
- **Container-aware layout contract.** Surfaces live inside a chat column, so layout responds to **container width**, not viewport: container queries on web, `onLayout` constraints on React Native, `LayoutBuilder` on Flutter. Height policy: grow, or max-height with internal scroll. An `expand` client action asks the host to show the surface fullscreen or in a modal. Avoid nested-scroll traps. **Gesture arbitration** on touch: dragging a slider or a scene element must not scroll the surrounding list (test on the Android device). Optional chrome: title, expand, reset, "view as text".
- **History rehydration**: persist blocks, surface messages and data-model snapshots; migrate across protocol versions so old messages still render after SDK upgrades. Add fixtures of historical messages.
- Acceptance: hybrid fixtures render in all kits and platforms; `markdown-only` yields zero surfaces; slider drag does not scroll the list on the device; rehydration passes after a simulated SDK upgrade.

#### M3. Kit contract completion

- Apply mobile typography tokens (family, size, weight, line height) consistently in Expo and Flutter; wire `motionMs` into the common animation path on all renderers; respect reduced motion everywhere.
- **Example loader**: read a kit's `examples/`, validate them, expose them to the prompt builder (retrieval comes in M6).
- **Per-platform conformance suite**: token coverage, component mapping or fallback, snapshot, example render.
- A **third brand kit** with real implementation replacement: a host React Button/Card on web, a native control on React Native, a Flutter widget on Flutter. Write "Wrap your existing design system".
- Acceptance: all existing fixtures render in three kits per platform; conformance passes; screenshot comparison shows the brand kit is visibly different.

#### M4. Android performance and iOS status

- Reproduce through the existing harness (`scripts/native-job.sh`). Profile Flutter (timeline, frame, heap) and React Native (Hermes profiler or Perfetto; separate JS from UI thread; check GC pauses, bridge or JSI batching, layout callback, accessibility tree).
- Use **at least 100 samples** per scenario; report p50, p95, p99 and max, cold and warm separately (with 30 samples, p95 is effectively the second-worst sample and very noisy). Keep raw sorted timings.
- Fix root causes (batching, fine-grained updates, memoization, precomputed text styles, virtualization). Do not tune the measurement to hide the tail.
- **Timebox**: if a root cause is not found within a bounded effort, document the profile, keep the gate open, and move on.
- Define render budgets for new visuals (for example scene element count at a target frame rate) and add them to the harness; re-verify after M8.
- iOS: run the macOS CI jobs if a runner exists; otherwise document exactly what is unverified.
- Acceptance: p95 target met with 100+ samples, or a documented and profiled explanation of the remainder.

### Batch 2: Quality, hybrid content, and visuals

#### M5. Safe markdown and attachments (display only)

**Markdown**

- A streaming-tolerant renderer for web, React Native and Flutter (research current packages for license and maintenance; ADR). CommonMark and GFM (tables, task lists, strikethrough), highlighted code blocks, inline and block math, links.
- A `Markdown` component usable **inside surfaces**. Hosts can plug in their own `MarkdownRenderer`, the same way kits override components.
- Links: `rel=noopener noreferrer`, optional confirmation for external links, scheme allowlist (`https`, `mailto`, `attachment`). `![alt](attachment:<id>)` and `[name](attachment:<id>)` resolve through the attachment resolver.
- Raw HTML stripped by default, with an optional formatting-tag allowlist; never scripts, styles, iframes, forms or event handlers.
- Streaming edge cases (unterminated fences, tables, links, math) must not flicker or break layout.

**Attachments and media**

- **`AttachmentManifest`** (host to engine): `id`, `kind` (`image` | `video` | `audio` | `file`), `mime`, `name`, `size`, `url` or `handle`, optional `thumbnailUrl`, `width`, `height`, `duration`, `alt`, `description`, `transcript`, `textExtract` (host-supplied), `expiresAt`. Host API: `engine.attach({ file | url, meta })`; infer `kind` from mime or extension without the engine making network calls.
- **`AttachmentResolver`** (host-owned): id to displayable URL or stream (signed-URL refresh, auth headers), thumbnail, open and download handlers.
- **Model visibility** per attachment: `metadata` (default), `text` (host-supplied transcript, caption or extraction), `vision` (thumbnail or full image sent to the model; opt-in, size-capped). Displaying never requires the model to see the binary.
- **Components** (host-overridable so a host can use its own player or viewer): `Image` (alt, caption, fit, zoom), `Gallery` / `Carousel` / `MediaGrid`, `ImageCompare`, `ImageAnnotations` (normalized-coordinate markers or boxes, only when the model has vision or the host supplies regions), `Video` (poster, controls, caption tracks, chapters, `seek` actions bindable to a `Timeline`; no autoplay with sound; muted autoplay only when allowed and reduced motion is off), `Audio`, `FileCard` (type icon, name, size, open and download through allowlisted client actions handled by the host), `DocumentPreview` (host previewer, otherwise `FileCard`).
- **Layout by count and aspect ratio**: one image as hero, two as compare, three to six as grid, many as carousel, video as player plus chapter timeline, mixed files as a file list.
- **States**: skeleton while loading; expired URL triggers resolver refresh and retry; blocked or failed media falls back to `FileCard`; lazy loading; size caps; alt text always present (model-written when it can see the image, otherwise host-supplied or the filename).
- **Security**: resolver output checked against scheme and domain allowlists; `referrerpolicy=no-referrer`; no `data:` or `javascript:` URLs; content-type checks for downloads.
- Platforms: web (`img`/`video`), React Native (`Image` plus a video library), Flutter (`Image` plus `video_player`), each overridable; capability fallback to `FileCard`.
- Acceptance: XSS corpus passes on all platforms; partial-stream fuzz passes; a fixture per attachment kind; expired-URL refresh and unknown-id rejection tests; layout-choice, accessibility (alt, captions, keyboard) and injection checks pass.

#### M6. Generation quality engine

Implement each item, measure against M1, keep only what the data supports, and log results in `docs/quality/experiments.md`:

- **Forgiving normalization**: deterministic, logged fixes for common near-miss outputs (aliases, trivial coercions), behind a flag, counted in reports, tested. Never hide the count.
- **Better repair reports**: path, expected, got, concrete suggestion; infra errors kept apart from schema errors.
- **Schema and prompt simplification** where the taxonomy shows models stumble; compact the system prompt.
- **Example retrieval**: choose 2 to 4 few-shot examples per request by category and keywords (embeddings optional later) within a token budget, using the M3 loader.
- **Emission order rules**: stream the root layout and primary visual first, then controls, then explanation, so partial renders are useful. Measure time to first meaningful paint.
- **Design-brief experiment**: single pass versus "brief, then UI" (brief = pattern, components, state variables, interactions, learning goal). Compare first-pass success, semantic score, first paint and tokens.
- **Structured output or tool calling** where the provider supports it alongside streaming; check current provider docs.
- **Model profiles**: per-model prompt variant, normalization strictness and repair budget; report per route. Cross-route comparison only when a route is actually available.
- Acceptance: scorecard improves on dev and held-out, or the experiment log explains why not.

#### M7. Layout and learning patterns, with the components they need

**Patterns** (kit guides, examples, and layout components where useful), each with when-to-use, container-width regions, and required and optional parts:

1. **Explorable explanation**: learning goal in one line, then visualization with controls, "try this" experiments, "what you should notice" callouts, formula with plain-language meaning, common misconception, 1 to 3 check-understanding questions, go deeper.
2. **Simulator**: primary visualization, control panel with presets and reset, play/pause/step/speed, live metrics and chart, scenario challenges.
3. **Calculator or planner**, 4. **Dashboard**, 5. **Compare**, 6. **Walkthrough**, 7. **Quiz or practice**, 8. **Game**, 9. **Itinerary or timeline**, 10. **Form or wizard**, 11. **Media-led answer** (gallery, video with chapters, file summary) combined with markdown.

**Layout rules**: one primary visualization per surface; wide containers use two columns (visual and controls) with explanation below; narrow containers stack visual, controls, then collapsible explanation; basic controls visible, advanced ones in an accordion; every control has label, unit and live readout; the default state is interesting (never empty or zero); presets such as "realistic" and "extreme" plus reset; key readouts in an aria-live region; autoplay respects reduced motion; simplified models are labeled as such; never invent facts.

**Components** (schema, kit tokens, accessibility, fixtures, three-platform implementation or declared fallback): `ControlPanel`, `Playback`, `Stat` / `StatGroup`, `Legend`, `Formula` (research KaTeX on web, a Flutter math package, an RN option; fall back to readable text), `Walkthrough`, `Quiz` (local, no model call), `Callout` variants (tip, warning, observe, misconception, model-note), `Timeline`, `Annotation`, and `Chart` upgrades (multi-series, live append with window, axes and units, reference lines, bands, log scale, histogram, area, stacked).

Acceptance: pattern fixtures render in all kits at all container widths; the M1 layout and learning checks pass on them; kit guides updated.

#### M8. Visual primitives (declarative)

All additive, versioned, capability-negotiated, each with an ADR.

- **Ticker**: runtime clock in the data model (`$time`, `$dt`, `$frame`, playing, speed) driven by `Playback`; pauses offscreen and under reduced motion; fixed-step manual advance for tests.
- **Seeded RNG** in the expression language: pure and replayable (explicit seed state; semantics decided in an ADR).
- **Expression extensions with hard budgets**: math (`sin cos exp log pow sqrt clamp lerp min max floor round`), `range`, bounded `map/filter/reduce`, `scan(init, step, n)` for recurrences (compound interest, SIR, Lotka-Volterra, projectile), `series(n, f)`, number formatting. Caps on iterations and depth per evaluation and per frame; exceeding a budget yields a component-level error, never a frozen UI.
- **`SvgScene`**: declarative vector scene (group, rect, circle, ellipse, line, polyline, path, polygon, text; gradients; clip; translate, rotate, scale) with bindable attributes, a `repeat`/`For` node over arrays, hover and click actions, drag binding, z-order, responsive viewBox, and theme tokens for fills and strokes so kits skin visuals. Security: no `foreignObject`, no external hrefs, no scripts, validated style values. Accessibility: title, desc and a generated text alternative. Hard cap on element count.
- **`Plot`**: y=f(x), parametric, scatter, with parameters bound to sliders; tangent, area and reference annotations; histogram and distribution curves.
- **`RouteMap`**: decide in an ADR between a host-provided basemap provider interface (tile-source allowlist, attribution, usage-policy compliance) and a tile-free schematic fallback. Coordinates written by a model are unreliable: mark them approximate and provide a geocode/verify action routed through the host or agent.
- **Pseudo-3D** in `SvgScene` via projection expressions (rotation, perspective, depth sort), for example a DNA helix. Document the ceiling; real WebGL belongs to M10.
- Acceptance: Path A showcase items exist as fixtures and as live generations; render budgets met on web and on the Android device where marked.

### Batch 3: Heavy

#### M9. Simulation modules (trusted host-side code, web first)

Prove the contract with **three reference modules**, then decide on more by ADR: `nBody` (solar system gravity), `cellular` (sand, water, lava, fire), `agents` (predator-prey, foraging, evolution).

Contract: typed params with ranges and defaults; deterministic seeded stepping; `snapshot()` for tests; metrics bound into the data model (so charts and stats work with M7); speed control; frame budget with adaptive stepping; a textual live summary for accessibility; reduced-motion behavior. Native either implemented or a declared fallback; do not promise native parity for heavy modules while M4 is open.

Acceptance: deterministic under a fixed seed; snapshot tests; Path B showcase items running on web.

#### M10. Sandbox and HTML/JS

Three strictly separate channels: (1) sanitized markdown HTML (M5); (2) sandbox `html` mode: static HTML and CSS, CSP `script-src 'none'`; (3) sandbox `app` mode: JavaScript allowed, no network.

- Web: `iframe` with `sandbox` (no `allow-same-origin`), opaque origin, strict CSP with no network, size and time limits, CPU watchdog and kill switch. Mobile: a locked-down WebView (no file access, no navigation, no remote origins); if it cannot meet the same guarantees, declare it unsupported with a fallback.
- Schema-validated `postMessage` bridge: theme tokens as CSS variables, a namespaced subset of the data model, allowlisted actions, resize events.
- **Embeds** (video platforms and similar) only through a host `EmbedProvider` allowlist (origin patterns, iframe sandbox flags, aspect ratio). Unknown URLs become a link card, never an iframe.
- Sandbox blocks participate in hybrid answers: fallback text, resize, `expand`, and a label "AI-generated interactive content". `allowSandbox` defaults to **false**.
- A separate **code-generation guide** for the model: single self-contained file, no external libraries (or a small pinned vendored allowlist), performance and accessibility rules, reduced motion.
- `docs/SECURITY.md` threat model plus adversarial tests: parent DOM, cookies, storage, fetch, WebRTC, top navigation, popups, form submit, `postMessage` flooding, infinite loop, memory bomb. The host must stay responsive.
- Evals: no console errors for N seconds, no CSP violations, non-blank screenshot, frame-rate floor, interaction smoke test; with the policy off, the model never emits sandbox blocks.
- Acceptance: isolation tests pass; Path C showcase items running on web.

### Batch 4: Ship

#### M11. Real-service integration and release prep

- A consumer example app against a real business API: reservation flow (form, agent action, API, result screen), save, follow-up actions, error recovery (timeouts, 4xx/5xx, duplicate submit with idempotency), including failure injection.
- Host-owned auth. Side-effecting actions (reservations, payments) require an explicit confirmation component and emit an audit hook.
- Release: finalize package and repository ownership and the private reporting contact (do not invent; list as needing the user), npm and pub.dev publish plan, changelog and versioning, license check of every vendored asset (fonts, icons, math library), dependency audit, public docs, and a public demo gallery containing the Showcase.
- Acceptance: scripted flows pass including failure injection; release checklist complete except items that need the user.

## 6. Showcase (coverage targets)

**Path A** = declarative (catalog plus M7/M8), **Path B** = trusted simulation module (M9), **Path C** = sandbox (M10), **Path H** = hybrid and media (M2, M5). Every item has Korean and English golden prompts, per-item behavioral checks, and a replay fixture.

| # | Item | Path | Needs | Native |
|---|---|---|---|---|
| 01 | Bicycle disassembly (자전거 분해) | A | SvgScene, slider-driven translation, labels | web + native |
| 02 | Black hole (블랙홀) | C | shader or canvas; stylized Path A fallback with mass and spin controls | web |
| 03 | DNA double helix (DNA 이중나선) | A | pseudo-3D projection, drag-rotate, strand-separation slider | web + native |
| 04 | Predator-prey ecosystem (포식자·피식자) | B | agents module plus live chart; Path A baseline via ODE `scan` | web |
| 05 | Civilization (문명 발전) | C | turn or tick state, map, events | web |
| 06 | Solar system gravity (태양계 중력) | B | nBody module; Path A baseline with parametric orbits | web |
| 07 | Fluid physics (유체 물리) | B | cellular module | web |
| 08 | Electric circuit (전기회로) | A | SvgScene, Ohm's law expressions, animated current | web + native |
| 09 | Car engine (자동차 엔진) | A | SvgScene, ticker, crank and piston kinematics, RPM slider, exploded toggle | web + native |
| 10 | Climate change (기후변화) | A | `scan` box model, Plot, Chart, Stat | web + native |
| 11 | Ant kingdom (개미 왕국) | C | agent AI, builds on the agents module | web |
| 12 | AI city (AI 도시) | C | grid, economy, agents | web |
| 13 | Stock market (주식시장) | A | seeded RNG, ticker, chart, local buy/sell actions, event cards | web + native |
| 14 | Virus spread (바이러스 확산) | A | SIR via `scan`, chart; optional agents view (B) | web + native |
| 15 | Life evolution (생명 진화) | B | evolution via agents module; test Path A feasibility with bounded `scan` first | web |
| 16 | Compound interest (복리 투자) | A | sliders, `scan`, chart, Stat | web + native |
| 17 | Monty Hall (몬티홀) | A | seeded RNG, local actions, repeated trials, stats chart | web + native |
| 18 | Normal distribution (정규분포·확률) | A | Plot, histogram, seeded sampling | web + native |
| 19 | Interactive math (인터랙티브 수학) | A | Plot, parameter sliders, annotations | web + native |
| 20 | Dutch pay (더치페이) | A | inputs, expressions, per-person results | web + native |
| 21 | Retro mini-game (레트로 미니게임) | A (button-driven), C (richer) | SvgScene, ticker, local actions | web + native |
| 22 | Travel itinerary map (여행 일정 지도) | A | RouteMap, Tabs, Timeline, geocode/verify action | web (+ native if provider allows) |
| H-01 | Compare several photos and explain the differences | H | gallery or compare plus markdown | web + native |
| H-02 | Summarize a PDF and chart the key figures | H | file card, stat cards, chart, markdown | web + native |
| H-03 | Video with chapter timeline whose entries seek the player | H | host transcript, `Video`, `Timeline` | web + native |
| H-04 | Travel itinerary with photo gallery, route map, markdown tips | H + A | media, RouteMap, markdown | web |
| H-05 | Calculator surface with a markdown explanation of assumptions | H + A | surface plus markdown | web + native |
| H-06 | Plain factual question (negative control: markdown only) | H | routing | all |
| H-07 | Code question (negative control: markdown with a code block) | H | routing | all |
| H-08 | Request that benefits from a short sandbox demo (only with `allowSandbox` on) | C | sandbox policy | web |

Quality bar for every item: meaningful first paint, labeled controls with units and readouts, a "try this" prompt, at least one "what you should notice" callout, an honest model-simplification note, correct numbers where checkable, keyboard accessible, reduced-motion aware, fallback text present.

## 7. Open questions for the user (use the defaults if unanswered; do not invent answers)

1. Do host services already have a markdown renderer to reuse? Default: built-in renderer plus a pluggable one.
2. Which map tile and video embed providers are allowed? Default: none (tile-free schematic map, link cards).
3. May images be sent to the model (`vision`) under the host's privacy policy? Default: off.
4. Should `allowSandbox` ever default to on? Default: off.
5. Package and repository ownership, private reporting contact. Default: leave unset and list as release blockers.

## 8. Definition of done and final report

Done means every milestone's acceptance criteria are met or explicitly left open with a profiled, documented reason; `pnpm check`, offline `pnpm eval`, Playwright, SDK and app `flutter analyze` and `flutter test`, the package check, and the Android verification script pass; a new dated verification record is appended to the report with raw data under `artifacts/`; and the Showcase table shows each item as implemented, partial, or `expected-fail` with its blocking reason.

When done, or stopped at a boundary, reply with: audit findings and ADRs; what changed; the scorecard before and after (including numbers that did not improve), per route and per layer; Showcase status; open gates; security notes; the defaults you used for open questions; and recommended next steps.
