# Kits: design language and implementations

A **kit** is the third of three levels of freedom: *catalog* (validated components), *kit* (how they look and which code renders them), *sandbox* (isolated free-form code, later). A kit never changes what a component means: props, data bindings, actions and expression operators come from the catalog and the host's capabilities.

## What a kit controls

| Control | Where | Platforms |
|---|---|---|
| Colors (light and dark, nine roles) | `tokens.light` / `tokens.dark` | all |
| Spacing and corner radius | `tokens.spacing`, `tokens.radius` | all |
| Typography: family, base size, weights, line heights, heading scale | `tokens.typography` | all (`native` names the Expo/Flutter font families) |
| Motion duration (and reduced motion) | `tokens.motionMs` | all; reduced motion forces 0 |
| Which code renders a component | `components[name].implementation` | web, React Native, Flutter |
| What the model is told about design | `guide`, `examples` | prompt |
| Host-only implementations | `hostImplementations` | each host |

A kit cannot add components to the catalog, change protocol versions, add expression operators or grant client actions. Those are catalog and host-policy changes.

## Typography tokens

`resolveTypography(kit, os)` turns tokens into concrete numbers and every renderer uses it (the Dart port is checked against the TypeScript output):

```
size[h1..h6] = round(baseSize × scale[i])       lineHeight = round(size × heading line height)
body line height = round(baseSize × lineHeight) small = max(12, round(baseSize × 0.875))
```

Omitted fields take defaults (`bodyWeight 400`, `headingWeight 600`, `lineHeight 1.55`, `headingLineHeight 1.2`, `scale [2.25, 1.75, 1.375, 1.125, 1, 0.875]`), so existing kits keep working. `native.body` / `native.heading` are font family names registered in the app; give `{ ios, android }` when they differ. With no native family the system font is used.

## Examples

`examples/*.json` ship with the kit and are loaded with `loadKitExamples(kit, examples)`. Loading fails if an example does not match the schema, does not replay without errors, or renders no readable content, so a broken example can never reach a prompt. `selectExamples(library, { prompt })` then picks 2–4 per request by category and keyword inside a token budget. Examples are derived from **dev** fixtures only (a held-out fixture would make the held-out score measure memorization).

## Conformance

`checkKitConformance(kit, { platform, registered })` checks token format, WCAG contrast of the role pairs (4.5:1 for text, 3:1 for the accent on the background), typography sanity, and that every catalog component maps to an implementation or a built-in default. `tests/kits.test.ts` runs it for every kit on web, React Native and Flutter, replays every example, snapshots the resolved typography, and checks that each renderer's source handles every component the platform declares in `PLATFORM_SUPPORT`.

## Wrap your existing design system

The `brand` kit is the reference. It keeps the catalog, swaps two implementations and changes tokens:

```ts
export const brand = defineKit({
  id: "brand", name: "Brand", version: "1.0.0", catalogId: CATALOG_ID,
  tokens: { /* colors, typography, spacing, radius, motionMs */ },
  components: Object.fromEntries(COMPONENT_NAMES.map((name) => [
    name, { implementation: ["Button", "Card"].includes(name) ? `Brand${name}` : name },
  ])),
  hostImplementations: ["BrandButton", "BrandCard"],
  guide: "…", examples: ["calculator", "form"],
});
```

Then register your own components. The engine hands each implementation the resolved node; you decide the markup.

**Web (React).** A component receives `{ node, children, runtime, surfaceId }`. Dispatch the node's action to keep local state and agent turns working:

```tsx
const components = {
  BrandButton: ({ node, runtime, surfaceId }) => (
    <MyButton onClick={() => runtime.dispatch(surfaceId, node.id, node.props.action, node.scope)}>
      {String(node.props.label)}
    </MyButton>
  ),
  BrandCard: ({ node, children }) => <MyCard title={node.props.title}>{children}</MyCard>,
};
<UIProvider runtime={runtime} kit={brand} components={components}>…</UIProvider>
```

**React Native.** Same signature with native views; use `useUI()` for the kit's colors (`apps/expo-lab/brand.tsx`).

**Flutter.** Provide `EngineWidgetBuilder`s keyed by implementation name (`apps/flutter/lib/brand.dart`):

```dart
UIProvider(runtime: runtime, kit: kit, components: {'BrandButton': (context, node, children, runtime, sid, scope) => …}, child: …)
```

### Rules for host implementations

1. Preserve semantics: a Button must dispatch its `action`; an input must write its bound path; a Card must render its children and title.
2. Keep accessibility: a role and a name, 44 dp touch targets, visible focus, and no color-only state.
3. Respect `motionMs` and the OS reduced-motion setting.
4. Switching kits must not recreate the runtime. Input values and selected tabs survive a swap, and the eval layers check it.
5. If the host has not registered a name, the renderer falls back to the built-in component of the same name, so a partial rollout still renders.
6. Never import code named by a model. Kits and their implementations come from the host's static registration.

The reference Brand kit additionally registers `BrandHeading` on web, RN and Flutter. It uses the same level/text contract, typography tokens and a branded accent band. Keep the host registration list in sync with `hostImplementations`; missing host mappings still fall through to the semantic built-in component. The dated visual matrix preserves the original 3% comparison threshold.
