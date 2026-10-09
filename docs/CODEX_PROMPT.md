# Codex Prompt: Open-Source Generative UI Runtime

> Fill in before use: `PROJECT_NAME`, `NPM_SCOPE`, `GITHUB_ORG`. Default license: Apache-2.0 (change if you prefer MIT).
> Paste everything below the line into Codex.

---

## Mission

Build and open-source **PROJECT_NAME**: a general-purpose runtime that lets an AI model **generate and stream interactive UI in real time**. The UI is rendered from a trusted component catalog, styled by swappable **design-language kits**, and extended by a sandboxed escape hatch for fully free-form output.

You will work end to end: **research -> plan -> implement -> document -> prepare for public release**. Work autonomously. Do not wait for approval between phases. If a decision is costly to reverse and you are unsure, choose the most reasonable default, record it as an ADR, and keep going.

## Context and positioning

Reference points (verify their current state yourself; today is October 2026, do not rely on memory):

- OpenAI "Intelligent UI" (GPT-6, https://openai.com/index/gpt-6-for-everyone/): the model composes a response from a library of native, streamable components, and a compiler renders it progressively while the model generates. Closed, ChatGPT-only.
- **A2UI** (Agent-to-User Interface): open, declarative, JSON-based streaming protocol. See https://a2ui.org and https://github.com/a2ui-project/a2ui. A v1.0 spec exists; renderers exist for several frameworks.
- **AG-UI** (CopilotKit): runtime/transport protocol between agent and frontend. Complementary to a UI-description protocol.

Do not clone any of these. Our differentiation:

1. **Kit plugin system**: a design language (tokens + component implementations + LLM-facing usage guide) can be swapped without changing the model output.
2. **Model-agnostic**: works with Claude, GPT, Gemini, local models, or a replayed fixture.
3. **Three tiers of freedom** (below): constrained by default, free by exception.
4. **One runtime contract for web, mobile, and desktop**. Web is implemented first; the others are specified.

## Design principles

1. **Constrained by default, free by exception.**
   - Tier 1, catalog: the model composes validated components. ~90% of cases.
   - Tier 2, kit: the same component tree is skinned and, where the kit chooses, re-implemented by a kit.
   - Tier 3, sandbox: for what the catalog cannot express (simulations, games, bespoke visualizations), the model emits free-form HTML/JS that runs only inside an isolated sandbox.
2. **UI is data, never code** in tiers 1 and 2. No `eval`, no `new Function`, anywhere in the codebase.
3. **Streaming first.** First paint on the first complete message; the UI grows as the stream arrives.
4. **A kit is more than CSS.** It includes a guide that tells the model when and how to use each component. Generation quality depends heavily on this.
5. **Fail soft.** Invalid output must degrade gracefully (per-component error states) and be reportable back to the model for self-repair.
6. **Boring tech, small surface, well tested.**
7. **Core is framework-, transport-, and model-agnostic.** Renderers, transports, and model adapters are plugins around it.

## Non-goals for v0.x

Native mobile/desktop renderer implementations (design and spec only), a visual editor, a hosted service, auth/user management, a prompt marketplace.

## Working process (follow strictly)

### Phase 0: Research (no product code, small spikes allowed)

Use web search and fetch. Cite every source with URL and access date. Produce `docs/research/*.md`:

- **A2UI v1.0**: message types, component model, data binding, catalogs, extension mechanism, versioning, license, available renderers/SDKs. Decide whether to **adopt it as the wire format, extend it as a compatible superset, support a compatible subset, or define our own**. Justify in `docs/adr/0001-wire-format.md`. Strongly prefer compatibility unless a concrete blocker is found.
- AG-UI and how it composes with the above.
- Other generative-UI approaches (e.g. Vercel AI SDK generative UI, Open-JSON-UI, other open projects). Note what to learn and what to avoid.
- Incremental/streaming parsing strategies for JSON message streams.
- Sandboxing approaches for untrusted HTML/JS (iframe `sandbox`, CSP, opaque origins, postMessage bridges).
- How to structure LLM-facing component guides and few-shot examples.
- Model APIs relevant to structured/streaming output for Anthropic and OpenAI (current docs only).

### Phase 1: Plan

Write `docs/PLAN.md` and ADRs: architecture, package layout, milestones with acceptance criteria, risk register, open questions with chosen defaults. Then continue straight into implementation.

### Phase 2 and on: Implement

Implement the milestones below in order. Commit at every milestone with Conventional Commits. Keep `docs/STATUS.md` current (done / in progress / next / known issues). If you have to stop, stop at a milestone boundary with `STATUS.md` updated so work can resume cleanly.

## Technical choices (propose changes via ADR if you have a strong reason)

- TypeScript (strict), pnpm workspaces, ESM-first.
- **Zod schemas are the source of truth**; emit JSON Schema from them.
- Vitest for unit tests, Playwright for e2e, Biome (or ESLint+Prettier) for lint/format, Changesets for versioning.
- React for the first renderer; Vite for the playground.

## Architecture

```
packages/
  protocol/          message + component schemas (Zod -> JSON Schema), protocol version
  core/              stream parser, surface store, bindings + expressions, action dispatcher,
                     validator, self-repair report builder, prompt builder
  renderer-react/    React renderer, catalog resolver, error boundaries, skeleton placeholders
  kit-spec/          kit manifest types, loader, validator, conformance test suite
  kits/
    neutral/         default kit
    <second-kit>/    deliberately different look, used to prove kit swapping
  adapters/          anthropic, openai, mock/replay  (interface: UIModelAdapter)
  sandbox/           tier-3 host + iframe runtime + bridge protocol
  evals/             golden prompts, runner, deterministic checks, optional LLM judge
apps/
  playground/        prompt -> streamed UI, kit switcher, model switcher, message inspector, replay
docs/
```

### Protocol and streaming

- Messages are streamed as **NDJSON** (one complete message per line). Transport-agnostic: in-process async iterator, fetch stream/SSE, WebSocket.
- The component tree is **flat, with id references** (not deeply nested), so nodes can be added or updated one at a time.
- The parser tolerates arbitrary chunk boundaries, partial lines, duplicate or out-of-order updates, and references to children that have not arrived yet (render a skeleton, resolve when the child arrives).
- Surfaces: create / update components / update data model / delete, or the A2UI equivalents if adopted.
- Rendering is batched per animation frame and **fine-grained**: updating one node must not re-render the whole tree.

### Data model, bindings, and local interactivity

- A reactive data model backs bindings (`${path}` or JSON-pointer style, aligned with the chosen wire format).
- Many interactions must work **without a model round trip** (slider updates a chart, tab switching, bill splitter math). Provide a **tiny safe expression language** as a JSON AST: whitelisted ops only (arithmetic, comparison, logic, string format, conditional, bounded array helpers), no loops, no access outside the data model, max depth/size limits, deterministic.

### Actions

Components emit actions with context resolved from bindings. Three kinds:

- `local`: update the data model through an expression.
- `agent`: send to the model/adapter and stream the next messages.
- `client`: from a strict allowlist (copy to clipboard, open URL with user confirmation, etc.).

### Validation and self-repair

- Validate every message against the schema and the active catalog. Quarantine invalid messages, render per-component error states, keep the rest of the UI alive.
- Build a structured error report the adapter can feed back to the model for a repair turn (configurable max retries).

### Kits

A kit is a package with a manifest (`kit.json`) containing:

- `tokens`: color, typography, spacing, radius, elevation, motion; light and dark modes.
- `components`: implementation entry per catalog component, with explicit fallbacks.
- `catalog`: allowed components and per-component prop constraints.
- `guide.md`: **LLM-facing** guidance. When to use which component, composition and layout rules, do and don't.
- `examples/`: few-shot pairs (user prompt -> expected message stream).

Provide `kit-spec` conformance tests: every catalog component is implemented or mapped to a fallback, tokens are complete, examples validate and render. `buildSystemPrompt({ catalog, kit })` composes protocol instructions + kit guide + examples.

### Starter catalog (about 20-25 components)

Layout: Row, Column, Grid, Card, Divider, Tabs, Accordion. Content: Heading, Text, Image, Icon, Badge, Callout, CodeBlock, List, Table, Progress. Input: Button, TextField, Select, Checkbox, Slider, DatePicker. Data viz: Chart (line, bar, scatter). Adjust via ADR if the wire format suggests otherwise.

### Model adapters

`UIModelAdapter` interface: takes the conversation + system prompt, returns an async stream of protocol messages. Implement `anthropic`, `openai`, and `mock/replay`. Keys come from environment variables only. Use structured output or tool calling where supported, constrained text otherwise.

### Tier 3: Sandbox

- A `Sandbox`/custom-view component renders model-written HTML/JS in an `iframe` with `sandbox` (no `allow-same-origin`), opaque origin, strict CSP with **no network access**, size and time limits.
- A schema-validated `postMessage` bridge. Theme tokens are injected as CSS variables. The sandbox can only emit allowlisted actions to the host.
- Write `docs/SECURITY.md` with the threat model and test that sandboxed content cannot reach the parent DOM, cookies, storage, or network.

### Evals

- At least 30 golden prompts across: explanation, comparison, form, planner, dashboard, calculator, simple game.
- Deterministic checks: schema-valid, catalog-only (tiers 1-2), no console errors, time to first render, axe accessibility.
- Optional LLM-judge rubric (clarity, usefulness, completeness, consistency with the kit guide), enabled only when API keys are present.
- Commit replay fixtures so **CI runs fully offline**.

### Accessibility

Semantic HTML, keyboard navigation, ARIA where needed, axe checks in e2e.

## Milestones and acceptance criteria

**M1: Core + web renderer + `neutral` kit**
- Playground progressively renders a replayed stream. Starter catalog implemented.
- Parser has chunk-boundary fuzz tests; bindings and expressions have unit tests.
- Local interactions work with zero model calls (slider -> chart, tabs, calculator fixture).

**M2: Kit system**
- A second kit with a clearly different look.
- The **same fixture streams render under both kits with no code changes**. Conformance suite passes.
- Docs: "Write your own kit" guide and a kit template.

**M3: Adapters, playground, evals**
- Anthropic and OpenAI adapters plus mock/replay. Live prompting in the playground with kit and model switchers and a message inspector.
- Self-repair loop working. Evals runnable offline and online.

**M4: Sandbox (tier 3)**
- Sandbox component, bridge, threat model, and isolation tests passing.

**M5: Open-source release prep**
- README (with a demo GIF/video), `README.ko.md`, LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue/PR templates, CI (lint, typecheck, test, build, e2e), Changesets, npm publish dry-run, roadmap, and a list of "good first issues".

**M6: Mobile and desktop (design only)**
- `docs/mobile-desktop.md`: renderer contract, how to implement it on React Native, Flutter, and Tauri, and a conformance strategy. Implement only if budget remains after M5.

## Quality gates (every milestone)

Typecheck, lint, unit tests, and e2e must pass. Public APIs get TSDoc. Every package has a README. No flaky tests. Keep dependencies minimal and pinned.

## Rules

- Never commit secrets. API keys come from environment variables.
- Do not copy code from other projects without checking the license; attribute where required.
- No `eval` / `new Function`. No remote code or remote assets in tiers 1-2.
- Write all repo docs in English. Cite research sources with URL and date.
- Prefer existing standards over inventing new ones. Record every non-obvious decision as an ADR.
- Do not over-engineer. If something is not needed for the current milestone, document it and move on.

## Final report

When you finish (or stop at a boundary), reply with: decisions made (link ADRs), what is done and what is not, how to run the playground and tests, known risks, and the recommended next steps.
