# ADR 0003: Model transport and deferred experiments

Accepted 2026-10-09. OmniRoute supplies all development model calls through OpenAI-compatible SSE. Credentials are server-only environment variables. NDJSON framing operates after SSE decoding; completed envelopes are validated before application. UTF-8 and line framing have independent bounds. Abort, authentication and gateway failures do not trigger model self-repair. Schema, graph and expression errors can request at most two repairs.

The model adapter is optional. Replay and existing agents can feed the runtime directly. AG-UI CUSTOM `engine.a2ui` is an Engine binding, not a required AG-UI standard.

Free-form HTML/JS is a deferred experimental package: an opaque-origin iframe, CSP and a validated capability bridge need a separate threat model. An iframe alone does not establish CPU, memory or complete network isolation. Desktop follows concrete host demand. React Native and Flutter are included following the user's approved expansion of the original brief.
