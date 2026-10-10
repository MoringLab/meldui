# Phase 2 audit — 2026-10-10

Method: `rg` over `packages/`, `apps/`, `dart/` plus reading the renderers, prompt builder and server. Where this disagrees with `docs/verification/REPORT.md`, the code wins.

| Area | Status | Evidence |
|---|---|---|
| Markdown rendering | **Missing** | No markdown dependency in any package. `Text` renders its string as plain text (React text node / RN `Text` / Flutter `Text`), so markdown syntax is displayed literally. `CodeBlock` is plain monospace without highlighting. |
| Raw HTML handling | **Safe by absence** | No `dangerouslySetInnerHTML`, `innerHTML`, WebView or iframe in SDK code. Model text only reaches text nodes. The system prompt forbids HTML/JS/CSS, but the schema (not the prompt) is the enforcement point. |
| Image | **Partial** | `Image` takes `asset` (host id) + `alt`. Web/RN/Flutter look up `assets[id]` supplied by the host; unknown id renders a labeled placeholder instead of an error state, and the unknown id is not reported to the repair loop. No caption, fit, zoom, loading or expiry handling. |
| Video / Audio / File / Gallery / Compare | **Missing** | Not in `componentSchemas`. |
| Attachment concept | **Missing** | No manifest, resolver, kind inference or model-visibility policy. `Capabilities` has `clientActions` only. |
| Links / URLs | **Partial** | `openUrl` client action requires `https:` without credentials (`packages/core/src/index.ts`, `UNSAFE_URL`) and a host handler. No scheme allowlist for `mailto`/`attachment`, no confirmation hook. |
| Answer envelope / hybrid streaming | **Missing** | Wire is A2UI-only (`createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`). The prompt says "output ONLY NDJSON … no prose", so the model cannot interleave text. |
| Fallback text on surfaces | **Missing** | Not required by schema or prompt. |
| Host policy | **Missing** | No `mode`, `maxSurfaces`, `allowMedia`, `allowSandbox`. Server hardcodes one prompt. |
| Capability negotiation | **Partial** | `runtime.capabilities(platform)` returns catalog ids and client actions; no per-renderer component/op list or declared fallbacks. Prompt always advertises the full catalog and full op list. |
| Container-aware layout | **Missing / unverified** | Web styles use viewport media queries in `packages/renderer-react/src/styles.css`; no container queries. RN/Flutter use window size, no `onLayout`/`LayoutBuilder` container logic. No height policy, `expand`, reset or view-as-text. |
| Gesture arbitration | **Unverified** | Sliders are native controls; no test that dragging inside a scroll view does not scroll it. |
| History rehydration | **Missing** | Server keeps in-memory sessions only; no persisted blocks, snapshots or migrations. |
| Kit typography/motion | **Partial** | Web applies tokens through CSS. Expo/Flutter apply colors/spacing/radius; `typography.family/size/weight/lineHeight` and `motionMs` are not wired (see `packages/kit-spec`: `typography` has `body`, `heading`, `baseSize` only). |
| Kit examples | **Missing loader** | `kit.examples` is `string[]` of names (`"calculator"`) that nothing resolves. The server hardcodes `fixtures[0].messages` as the single prompt example. |
| Kit guide | **Reaches prompt** | `kit.guide` is included verbatim by `buildSystemPrompt`. |
| Expressions | **Basic** | 22 ops, no math functions, no `range`/`scan`/`series`, no RNG, no ticker. Budget caps exist (depth 16, nodes 256, array 1000). |
| Charts | **Basic** | `Chart` supports line/bar/scatter with one series; no axes units, reference lines, multi-series or live append. |
| Sandbox | **Missing** | Deferred by design; `openUrl`/`copyText` are the only client-side effects. |
| Eval | **Structural only** | `scripts/evaluate.ts` (replay) checks diagnostics, render errors and fixture interactions. `scripts/evaluate-online.ts` checks validity/resolvable expressions; no behavioral, numeric, layout, learning, routing, media or safety layers. Infra errors were mixed into `errors` without their own column. |
| Route availability | **Was silent** | A 429 route produced 0/30 as if it were a quality result. Now: `RouteHealth` + `probeRoute` (M0) with bounded backoff in the server and an `infra` column in eval. |

## Unsafe now (to close in later milestones)

1. Unknown `Image.asset` ids are silently displayed as placeholders — masks model errors (M5: error state + repair report).
2. `Text` is plain so markdown is "safe", but adding markdown (M5) introduces the first path where model text becomes structured markup; it must go through the sanitizing pipeline with a link/image resolver.
3. `openUrl` accepts any `https:` URL the model produces; Rule 5 (model never writes URLs) requires moving to attachment ids and host-resolved links.
4. Server sessions are unauthenticated beyond origin checks and hold prompts in memory (acceptable for the local lab; documented for M11).
