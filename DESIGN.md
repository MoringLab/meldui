---
name: Engine
description: Quiet, host-themed interactive answers and their reference workspace.
colors:
  background: "#ffffff"
  surface: "#ffffff"
  foreground: "#192638"
  muted: "#526277"
  accent: "#245aca"
  on-accent: "#ffffff"
  border: "#dce2e8"
  danger: "#b42318"
  success: "#236540"
  dark-background: "#101923"
  dark-surface: "#192533"
  dark-foreground: "#f0f4f8"
  dark-muted: "#b5c3d4"
  dark-accent: "#9abaff"
  dark-on-accent: "#101923"
  dark-border: "#3b4f65"
  dark-danger: "#ffaaa2"
  dark-success: "#8bd5a5"
  editorial-paper: "#f5f1e8"
  editorial-accent: "#285d48"
typography:
  headline:
    fontFamily: "system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 600
    lineHeight: "43px"
    letterSpacing: "-0.025em"
  title:
    fontFamily: "system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: "34px"
    letterSpacing: "-0.025em"
  section-title:
    fontFamily: "system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: "26px"
    letterSpacing: "-0.025em"
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "25px"
  label:
    fontFamily: "system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 550
  code:
    fontFamily: "ui-monospace, monospace"
    fontSize: "14px"
    lineHeight: 1.6
  editorial-title:
    fontFamily: "Georgia, serif"
    fontSize: "28px"
    fontWeight: 500
    lineHeight: "33px"
    letterSpacing: "-0.025em"
rounded:
  field: "6px"
  shared-control: "8px"
  surface: "12px"
  canvas: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  control: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  host-control:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.shared-control}"
    padding: "6px 12px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.surface}"
    padding: "{spacing.lg}"
  badge:
    textColor: "{colors.foreground}"
    rounded: "99px"
    padding: "3px 10px"
  control-panel:
    textColor: "{colors.foreground}"
  scene:
    width: "100%"
---

# Design System: MeldUI

## Overview

**Creative North Star: "The Quiet Workspace"**

Engine's reference lab is a quiet workspace for making, inspecting and comparing an interface. Embedded MeldUI answers follow the same restrained character: the useful diagram, media or tool carries the composition, with concise text and controls supporting it. The SDK is a reference surface rather than a separately branded marketing page.

Neutral supplies cool white paper, dark ink and restrained blue. Editorial retains warm paper, deep green and serif headings. Both support light and dark modes without changing the answer's data or controls. Hosts can replace typography, tokens and trusted component views so an answer fits its surrounding service.

**Key Characteristics:**

- Subject-specific visuals with subordinate controls.
- Open, responsive composition and restrained borders.
- Host typography, media and component ownership.
- Local interaction state preserved across kit changes.
- Keyboard, text alternatives and reduced-motion support.

## Colors

The default Neutral palette separates readable ink, quiet boundaries and functional color; the frontmatter records its light and dark roles plus Editorial's distinguishing paper and accent.

### Primary

- **Restrained Blue:** Neutral's accent marks interaction, focus, selection and chart emphasis. Dark mode uses its own lighter accent and matching on-accent color.
- **Deep Green:** Editorial's accent belongs to its warm-paper kit; use the active kit's complete palette rather than mixing it with Neutral.

### Neutral

- **White Paper:** Neutral background and surface are deliberately equal in light mode. Borders establish independent containers.
- **Dark Ink / Muted Ink:** Foreground carries content; muted color carries secondary explanations and labels.
- **Cool Boundary:** Border marks fields, dividers and containers without adding visual weight.
- **Night Paper / Raised Night Paper:** Neutral dark mode separates background and surface through tone.
- **Warm Paper:** Editorial uses its own warm light surfaces and green dark surfaces.

Danger and success colors communicate actual status. They are semantic roles, not additional decorative accents. Host services may supply a different complete palette, as the monochrome service demo does.

### Named Rules

**The Active Kit Rule.** Resolve every shared foreground, surface, boundary and interaction color from the active kit; keep host components in that same theme contract.

## Typography

**Body Font:** Platform sans in the reference kits; host typography may be inherited in embeddings.

**Heading Font:** Platform sans for Neutral; Georgia with platform serif equivalents for Editorial.

**Code Font:** Platform monospace.

**Character:** Clear SDK typography favors readable controls and content. Editorial adds a softer serif hierarchy while keeping familiar sans-serif controls. There is no separate marketing display role.

### Hierarchy

- **Headline:** The first heading level uses the frontmatter headline role; headings two and three use title and section-title.
- **Lower headings:** Neutral resolves levels four through six to (18px), (16px) and (14px), using the kit's heading weight and rounded line-height calculation.
- **Card title:** Compact container titles use (20px), independently of the six-level heading scale.
- **Body:** Neutral and Editorial share the body role. Plain text is bounded to (72ch); Markdown to (75ch).
- **Label:** Field labels use the label role. Frame tools and badges use compact supporting text (13px).
- **Code:** Preserve whitespace and allow horizontal scrolling rather than shrinking code or formulas.

The showcase and host service may tune their own title sizes. Those surface overrides do not replace the renderer's kit scale.

### Named Rules

**The Host Type Rule.** Embedded answers may inherit the host's body and heading families; kit changes preserve component meaning and state.

## Layout

The renderer responds to its containing surface, including a narrow chat column. Columns, rows, grids and ordered answer blocks use the shared medium spacing; related groups and text/media compositions use the larger spacing. Text, generated surfaces and media remain ordered parts of one answer.

At a surface width of (560px) or less, grids become one column, rows stack, card padding reduces to (18px), and first-level headings scale to 85%. Text and media can sit beside each other at a container width of (600px) or more, then stack below it. The mosaic media layout also stacks at (480px) or less.

The showcase has a bounded canvas (1240px maximum) with a dominant visual column and a smaller control column. It stacks at a viewport width of (720px). The service embedding bounds its content separately and renders surfaces directly inside host sections. These are examples of host composition, not mandatory answer shells.

The showcase keeps example selection directly visible. Secondary display settings use a native disclosure, initially collapsed on viewports narrower than (720px), to keep the answer prominent.

The reference lab retains its narrow example rail, generous result canvas, compact composer and collapsible diagnostics. Those operating tools belong to the lab rather than to an embedded answer.

Typed surfaces grow naturally unless the host explicitly supplies a height policy. Live code widgets follow measured content height within their provider's height limit. Media preserves its aspect ratio; code, formulas and wide tables scroll within their own region. Mobile uses stacked content and explicit controls for supporting tools.

## Elevation & Depth

Shared content is flat at rest. Fine borders and light/dark surface tones provide separation; the renderer and service cards do not depend on shadows. Modal and image-zoom backdrops dim the host behind an expanded view. Fullscreen and picture-in-picture states use explicit placement and stacking rather than decorative elevation.

### Named Rules

**The Quiet Surface Rule.** Use open layout for related content and a bordered container only when it identifies an independent tool, field or content boundary.

## Shapes

Fields, shared controls, surfaces and the showcase canvas use the frontmatter's gently rounded shapes. Editorial uses tighter surface corners (6px); a host can supply its own surface radius, as the service embedding does (18px). Badges are compact pills. Borders are generally a single logical pixel.

Use the active kit's surface radius for generated cards, images and frames. Keep diagrams' subject geometry intact; shape conventions for controls do not constrain the illustration or scene.

Shared tool icons use the established small, bundled geometric SVG set.

## Components

### Buttons

Buttons are familiar, compact controls rather than decorative focal points. Shared primary input targets are at least (44px) high on web; native targets retain the established minimum (48 logical pixels). Narrow-surface renderer buttons also increase to (48px). Every control has an accessible name and visible focus.

The shared focus treatment is a solid accent outline (2px) with an offset (3px). Button feedback uses a short filter transition (140ms, ease-out); reduced motion removes transitions and animation. Primary, secondary and quiet action semantics remain available to the host.

### Chips

Badges use a thin boundary, compact padding and pill corners. Tone communicates status where requested; a badge is supporting information rather than a substitute for an action label.

### Cards / Containers

Cards identify independent tools or information groups. Use the active surface, a fine boundary, the active radius and the frontmatter's card padding. Narrow surfaces use the smaller padding described in Layout. Editorial cards separate their header with a fine divider. Avoid wrapping every text or control group in another card.

### Inputs / Fields

Each field has a visible label, a quiet surface, a fine boundary and a compact field radius. Text inputs, selects and textareas use the field padding and at least (44px) height; textareas start at (100px). Sliders expose their current value and units, and use the accent for native interaction. Disabled states remain distinguishable, and validation feedback remains attached to its field.

### Navigation

Renderer tabs use a horizontal, scrollable row and an accent underline for the selected tab. The host service uses wrapping example buttons with a tonal current-page state. Preserve semantic selection and keyboard access when a host replaces these views.

### Interactive scenes and control panels

A typed SVG scene fills the available width and keeps descriptive text and interaction semantics. Selected scene targets receive an accent stroke, and keyboard focus is visible. Local selection, dragging, playback or input changes update the existing state model. A control panel is a plain column of useful controls; it does not require a surrounding card.

### Answer composition and host content

Markdown, KaTeX formulas, typed components and media can compose one answer. Use exact tables for comparisons and charts for trends. Galleries, comparison views, players and file groups use the representation appropriate to their content.

The default renderer provides a frame with reset, expand and text-view tools. Hosts can hide that chrome or render the surface themselves, as the service demo does. Host components share the theme and action contract. Opted-in code widgets receive host theme values and approved resources; they remain a distinct capability rather than the default representation.

Live iframe height follows its body's measured bounds, capped by the provider's height limit (4096px by default). This runtime limit is separate from the composition's spacing and shape scales.

## Do's and Don'ts

### Do:

- **Do** lead with the smallest useful representation of the requested task and one subject-specific visual when it helps.
- **Do** place useful controls beside or below the visual as the available container allows.
- **Do** keep input labels, units, formatted numbers and text alternatives explicit.
- **Do** resolve styling from the active kit or host theme while preserving local state.
- **Do** retain visible focus, keyboard access, accessible chart alternatives and reduced-motion behavior.

### Don't:

- **Don't** force a quiz, callout, repeated heading or decorative metric into every answer.
- **Don't** nest cards to group content that already belongs together in an open layout.
- **Don't** impose a fixed content height without the host's explicit height policy.
- **Don't** make the reference frame or demo navigation mandatory in a host embedding.
- **Don't** promote a host-specific override into a shared kit rule.
