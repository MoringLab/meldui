# MeldUI

A private A2UI SDK for React web, React Native/Expo and Flutter. It composes Markdown, interactive surfaces and host media, with three replaceable design kits and local state that survives kit changes. [한국어](README.ko.md).

MeldUI is the project name. Existing `@engine/*` packages, `engine_flutter`, application IDs and wire/catalog identifiers are retained for compatibility.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm schemas
# Set server-only OMNIROUTE_API_KEY; see .env.example
pnpm dev
# Separate business consumer, in another terminal:
pnpm --filter @engine/reservations start
```

Open the [lab](http://127.0.0.1:5173), [30-item Showcase](http://127.0.0.1:5173/showcase.html), or [reservation consumer](http://127.0.0.1:5173/reservation.html). Replay works without a model. Live generation uses local OmniRoute through the loopback server on 8787; credentials stay out of browser/native bundles. The reservation service separately persists to SQLite on 8788.

## Host integration

```tsx
import { AnswerComposer } from '@engine/core';
import { createUIRuntime, UIProvider, AnswerView } from '@engine/renderer-react';
import { neutral } from '@engine/kit-neutral';

const runtime = createUIRuntime({ onAction: action => yourAgent(action) });
const answer = new AnswerComposer(runtime, {
  policy: { mode: 'auto', maxSurfaces: 3, allowMedia: true, allowSandbox: false },
});
// Existing agent/transport, or a model adapter:
await answer.consume(yourAsyncStream, { signal });
<UIProvider runtime={runtime} kit={neutral} content={yourContentHost}>
  <AnswerView session={answer} />
</UIProvider>;
```

`accept`/`consume`/`dispatch`/`dispose`, node/path subscriptions, bounded NDJSON/UTF-8 parsing, pure expressions, action permissions and input-write conflict resolution are independent of model transport. `AnswerSession` and `AnswerComposer` are the same composer API. AG-UI text/CUSTOM adapters are optional. Render errors retain prior valid content. Model-write conflicts require host resolution rather than silently discarding user input.

The catalog contains 50 validated layout, content, form, learning, media and visual components. Core expressions support bounded math, arrays, seeded randomness and recurrence; local calculations, sliders, tabs, quizzes, games and media paging do not call a model. Trusted web modules implement nBody/cellular/agents simulations. Declarative SvgScene, Plot and approximate RouteMap render on native too. Native continuous animation, direct scene dragging, advanced Chart features and simulations have explicit feature/fallback declarations. [Visual contracts](docs/VISUALS.md).

## Model-authored Markdown and media

Hosts register metadata and own URL resolution/storage. Models choose IDs and semantic layout:

```json
{"engine":"v1","block":"media","attachments":["photo-a","photo-b"],"layout":"carousel","markdown":"## Compare the photos\nSwipe or use the navigation buttons.","placement":"left","mediaFraction":0.4}
```

Media can be left/right/above/below Markdown. Side-by-side compositions stack in narrow containers. Carousels have swipe/paging, accessible buttons, a counter and image enlargement; video chapters/captions are host supplied. `allowMedia:false` blocks embedded media too. GFM, code and math have safe defaults and replaceable renderers. Raw HTML is stripped; an optional host flag allows only attribute-free basic formatting. [Content integration](docs/hybrid/CONTENT.md) · [composition contract](docs/hybrid/MEDIA-LAYOUT.md).

The `neutral`, `editorial` and `brand` kits share semantics. Brand replaces host Button/Card/Heading implementations on all three targets. Tokens cover light/dark, platform fonts, sizes/weights/line heights and reduced motion. Kit guides and validated examples inform generation; category/keyword retrieval respects a host token budget. [Wrap your design system](docs/KITS.md) · [custom catalog/components](docs/EXTENDING.md).

## Apps and verification

Android demos have separate IDs. Build Expo from `apps/expo-lab/android` and Flutter from `apps/flutter`; use `adb reverse tcp:8787 tcp:8787`. Native work uses `scripts/native-job.sh`. Both apps expose the media, advanced and Showcase fixtures. They preserve edited content during failed generations.

```sh
pnpm check
pnpm eval
pnpm --filter @engine/expo-lab typecheck
# SDK and app, in their respective directories:
flutter analyze && flutter test
pnpm exec tsx scripts/package-check.ts
scripts/native-job.sh python3 scripts/verify-android.py --platform all
```

Ordinary CI/device checks are replay/functional checks and **do not start performance benchmarks**. Online tools `eval:online`, `eval:experiments`, `eval:multiturn` require `--live`; every call uses OmniRoute. Dated reports keep complete denominators, infrastructure failures, dev/held-out splits and unmeasured semantic layers. Human ratings are blank until supplied; judge calibration is not fabricated.

Sandbox is a separate experimental web provider, off by default. It requires a fingerprint-matched attack-test attestation and runs generated code in networkless resource-limited Docker/Chromium, with a screenshot/input replay bridge. Mobile uses fallback text. [Provider limits](packages/sandbox/README.md).

See [current status/report](docs/STATUS.md), [generation experiments](docs/quality/experiments.md), [release preparation](docs/RELEASING.md) and [security](SECURITY.md). Feature implementation is distinct from model task success: routing/semantic quality, RN tail latency, human calibration, iOS and unresolved transitive advisories remain gates. Packages stay private; no public deployment or registry publication occurred. Apache-2.0.

See [custom components, SVG compilation and code artifacts](docs/PHASE3.md) and [Phase 3 verification](docs/verification/2026-10-11-phase3/REPORT.md).
