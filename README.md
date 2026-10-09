# Engine

A catalog-driven A2UI runtime with interchangeable design kits for React, React Native/Expo and Flutter. Model output is JSON data; interactions run locally. The demos use your local OmniRoute gateway through a server that keeps credentials off clients.

## Run

Requirements: Node 22+, pnpm 10; Flutter for the Dart SDK; Android SDK/JDK 17 for native builds.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm schemas
cp .env.example .env
# Set OMNIROUTE_API_KEY in your shell, or load .env using your environment manager.
pnpm dev
```

Open http://127.0.0.1:5173. Thirty replay examples work without a model connection. The server binds to loopback on port 8787. It uses OmniRoute at http://127.0.0.1:20128/v1.

```sh
adb reverse tcp:8787 tcp:8787
cd apps/flutter
flutter pub get
flutter run
# Expo: from apps/expo-lab, pnpm android
```

## Embed in React

```tsx
import { createUIRuntime, UIProvider, UISurface } from '@engine/renderer-react';
import { neutral } from '@engine/kit-neutral';
import '@engine/renderer-react/styles.css';

const runtime = createUIRuntime({ onAction: action => agent.handle(action) });
runtime.accept({ version: 'v0.9', createSurface: {
  surfaceId: 'main', catalogId: 'urn:engine:catalog:core:1'
}});
runtime.accept({ version: 'v0.9', updateComponents: {
  surfaceId: 'main', components: [{ id: 'root', component: 'Text', text: 'Hello' }]
}});
// Keep runtime stable when changing kit or theme; dispose when the host unmounts.
<UIProvider runtime={runtime} kit={neutral}><UISurface surfaceId="main" /></UIProvider>;
```

The React Native package exports the same provider and surface contract with native controls. Flutter exports `UIRuntime.create()`, `UIProvider`, `UISurface` and `UIKit.load()`. See the independent apps for full host lifecycle examples.

## Contracts

Engine implements a restricted A2UI v0.9.1 profile (`version: "v0.9"`) with its own catalog ID, not the standard/basic catalog. The 25 components include layout, text, forms, tabs, tables and accessible charts. Generated JSON schemas in `schemas/` come from Zod; Flutter consumes those same assets.

Input bindings write locally. Pure expression ASTs provide bounded arithmetic, comparison, conditional formatting and aggregation. Agent actions send only their explicitly declared context. Hosts must register client capabilities and assets. Neither arbitrary code, remote modules, HTML, styles nor model-supplied image URLs are accepted.

Kits include light/dark tokens, implementation mappings, fallback rules, examples and a model-facing guide. Both `neutral` and `editorial` use the same component semantics. Host components are registered statically. See [extending the SDK](docs/EXTENDING.md).

Adapters: OpenAI-compatible SSE through OmniRoute, replay, and the optional AG-UI CUSTOM `engine.a2ui` binding. Existing agents can supply an `AsyncIterable` directly without a model adapter.

## Verify

```sh
pnpm check
pnpm eval
pnpm eval:online # server + gateway credential required; makes model calls
cd dart/engine_flutter && flutter test
cd ../../apps/flutter && flutter test
```

See [status and actual verification](docs/STATUS.md), [architecture decisions](docs/adr/0001-wire-format.md) and [research](docs/research/2026-10-09.md). Packages remain private until ownership and registry names are finalized. iOS builds require macOS; sandbox and desktop are deferred. Apache-2.0.
