# @engine/renderer-react-native

Engine SDK module. See the workspace README and docs/EXTENDING.md for setup and contracts. Apache-2.0. Private until registry ownership is finalized.

Custom components, portable SVG, revisioned artifacts and host presentation are documented in [Phase 3 contracts](../../docs/PHASE3.md). Existing wire/API identifiers remain compatible.

Trailing citations use the optional `EnrichedMarkdown` native `onLastLineLayout` event
(`markdown`, `x`, `y`, `width`, `height`, `rtl`, in layout points). Morit's Android
patch for enriched-markdown 1.1.1 emits the final rendered text line after layout.
Without this extension, citations remain compact below the block; the renderer never
estimates native line breaks using a second text view.
