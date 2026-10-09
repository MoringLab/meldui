# ADR 0002: Kits, pure expressions and host capabilities

Accepted 2026-10-09. A kit combines tokens, component implementation names, fallbacks, usage guidance and examples. Swapping a kit changes presentation without replacing the runtime. Implementations come from a static host registry, never model-supplied import paths.

Expressions are bounded JSON ASTs, not executable strings. Depth 16, 256 evaluated nodes, 1,000 aggregation items. Only chosen conditional branches evaluate. Writes, URL opening and clipboard access are dispatched from trusted user interactions with explicit host capabilities. JSON pointer traversal blocks prototype-related keys.

User edits are retained when model writes overlap them. The host can replace a runtime for a deliberate new screen. Errors isolate bad nodes and preserve valid state. No arbitrary HTML, JavaScript, CSS, network image URLs or remote code are permitted in this release.
