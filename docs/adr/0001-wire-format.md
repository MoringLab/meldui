# ADR 0001: Restricted A2UI catalog profile

Accepted 2026-10-09. Use A2UI v0.9.1 semantics and the permitted v0.9 wire version. The Engine catalog has a distinct stable identifier, `urn:engine:catalog:core:1`. Do not invent another wire protocol, claim support for the basic catalog, reorder state changes, or enable full-model synchronization by default.

Reuse pinned upstream headless TypeScript and Dart cores. React's surface integration delegates catalog/graph processing to the upstream React package; RN imports headless entrypoints only. Renderer implementations resolve the same bindings and local action semantics.

Zod authors Engine component/function definitions; exported JSON Schema is shared with Dart. Upstream remains the normative source for envelope and transport semantics. Current profile restricts themes, remote assets, unknown components and implicit client capabilities. Custom catalogs need matching host implementations.

Dart core 0.2.2 treats a nested null write as deletion. Engine preserves explicit null via a parent replacement; omitted wire values retain deletion semantics. This correction belongs in the wrapper, not a patch to the global package cache.
