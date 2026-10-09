# Host extensions

Register custom Zod component APIs through `createUIRuntime({ catalogId, components })`. Use a distinct catalog ID when changing the component contract. Register the corresponding renderer implementation statically in the provider's `components` registry; inspect each platform's provider props for its builder signature. Pass asset IDs through `assets`; generated output cannot import code or choose a remote image URL.

Use `defineKit()` and `validateKit()` from kit-spec. Supply all tokens for light/dark, implementation names, explicit fallback names, representative examples and usage guidance. A fallback must preserve input and action semantics. Change the provider's kit prop while keeping the runtime instance stable.

`createUIRuntime()` owns surfaces, stream consumption, dispatch and disposal. `accept(message, eventId?)` validates an envelope. `beginRun(surfaceId)` aborts an older run and returns its new AbortSignal; pass that signal through your adapter and consumer. `consume(asyncIterable, {signal})` consumes bytes or envelopes. `dispatch()` resolves the action's declared context after local input writes. `dispose()` releases all subscriptions and runs.

Model adapters implement `stream(request,{signal})` yielding message, diagnostic, usage and completion events. The gateway adapter belongs on a trusted server. Ordinary CI and replay use no model calls. AG-UI transport maps CUSTOM events with name `engine.a2ui` to A2UI messages; reject other names and validate their values.

The included server is a local verification service, not a public authenticated multitenant backend. Replace its host/session policy when embedding into an existing service. Full data-model transmission is disabled. Pass only the context fields the agent needs.
