import { editorial } from "@engine/kit-editorial";
import { neutral } from "@engine/kit-neutral";
import type { UIMessage, UserAction } from "@engine/protocol";
import { createUIRuntime, UIProvider, UISurface } from "@engine/renderer-react";
import React from "react";
import { createRoot } from "react-dom/client";
import fixtures from "../../../fixtures/cases.json";
import "@engine/renderer-react/styles.css";

/**
 * Chrome-free harness page for the eval layers.
 * /eval.html?fixture=<id>&width=<px>&kit=neutral|editorial&mode=light|dark
 * Window hooks: __actions (emitted UserActions), __runtime (for assertions).
 */
const q = new URLSearchParams(location.search);
const kits = { neutral, editorial } as const;
const w = window as unknown as { __actions: UserAction[]; __runtime: unknown; __ready: boolean };
w.__actions = [];
const runtime = createUIRuntime({
  onAction: (a) => {
    w.__actions.push(a);
  },
});
w.__runtime = runtime;
const fixture = fixtures.find((f) => f.id === q.get("fixture")) ?? fixtures[0];
for (const message of fixture.messages) runtime.accept(message as UIMessage);
runtime.finish();
const width = Number(q.get("width") ?? 720);
const mode = q.get("mode") === "dark" ? "dark" : "light";
createRoot(document.getElementById("root")!).render(
  <div
    id="chat-column"
    style={{
      width,
      containerType: "inline-size",
      padding: 0,
      margin: "0 auto",
      overflow: "visible",
    }}
  >
    <UIProvider
      runtime={runtime}
      kit={kits[(q.get("kit") as keyof typeof kits) ?? "neutral"] ?? neutral}
      mode={mode}
    >
      <UISurface />
    </UIProvider>
  </div>,
);
requestAnimationFrame(() => requestAnimationFrame(() => (w.__ready = true)));
