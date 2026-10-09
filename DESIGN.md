# Engine design

The lab is an Operate surface: a quiet workspace for making, inspecting and comparing an interface. A narrow example rail leads into a generous result canvas; a compact composer anchors the lower edge. Diagnostics are available in a collapsible inspector.

Neutral uses cool paper, dark ink and a restrained blue action color. Editorial uses warm paper, deep green, serif headings and visible text hierarchy. Both have light and dark modes. The same controls and data survive kit changes.

## Tokens
Spacing: 4, 8, 12, 16, 24, 32, 48. Type: 12, 14, 16, 20, 28, 36. Radius: 6, 12, 16. Focus: 2px solid accent, 3px offset. Minimum native target: 48 logical pixels. Motion: 140ms ease-out; disabled for reduced motion.

Fonts are platform sans for controls and system serif for editorial headings. This is an SDK reference surface rather than a separately branded marketing page. Icons are a small bundled geometric SVG set.

Mobile stacks the composer and result, with examples and inspector behind explicit controls. No fixed height is imposed on generated content.
