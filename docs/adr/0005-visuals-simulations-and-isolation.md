# ADR 0005: Additive visuals, deterministic state and isolated previews

Accepted 2026-10-11. Supersedes the deferred web sandbox portion of ADR 0003; the A2UI transport and trust boundaries remain unchanged.

Keep the existing catalog ID/wire compatible, adding capability-negotiated schemas/components. Models can select semantic media placement and carousel paging, not arbitrary layout CSS. Schema-2 history preserves composition fields; display URLs and modal/page state are not persisted. Host policy token/latency limits reach the gateway; model output cannot override them.

TS/Dart share AST and tuple-schema vectors. Randomness is pure `rng(seed,drawIndex)` with unsigned 32-bit mixing; trusted simulation snapshots additionally store sequential draw state. Tickers are owned/disposed by rendering lifetimes; manual tests do not depend on real timers. Educational simulations run only in trusted host modules, initially on web. Native charts, clocks, direct dragging and players expose supported features or readable/action fallbacks.

Raw HTML remains stripped from Markdown. An optional host formatting flag recognizes attribute-free, text-only b/strong/i/em/s/del/code pairs; it never enables HTML rendering or event/style attributes. Fenced/inline code stays literal. Vision requires separate explicit host opt-in and a bounded server byte resolver; rendering images does not send them to a model.

Use a separate Docker/Chromium process for experimental app code. An iframe alone cannot establish CPU/memory/network limits. Keep app mode off until a local attack corpus attestation matches the exact image/worker/policy. The viewer uses a bounded screenshot/input replay bridge and readable fallback; it is not a production-certified live browser service. Mobile sandbox remains unsupported.

Reservation confirmation belongs to the authenticated business server. An SDK Confirmation view conveys intent but cannot supply an authorization nonce, forge host identity or bypass idempotency/audit.
