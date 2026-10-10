import { AnswerSession } from "@engine/core";
import { brand } from "@engine/kit-brand";
import { editorial } from "@engine/kit-editorial";
import { neutral } from "@engine/kit-neutral";
import type { HostPolicy, UserAction } from "@engine/protocol";
import {
  AnswerView,
  createUIRuntime,
  MediaContent,
  SafeMarkdown,
  UIProvider,
} from "@engine/renderer-react";
import React from "react";
import { createRoot } from "react-dom/client";
import advanced from "../../../fixtures/advanced/cases.json";
import fixtures from "../../../fixtures/cases.json";
import hybridFixtures from "../../../fixtures/hybrid/cases.json";
import mediaFixtures from "../../../fixtures/media/cases.json";
import { sampleContent } from "../../../fixtures/media/host";
import showcases from "../../../fixtures/showcase/cases.json";
import "@engine/renderer-react/styles.css";
import { brandComponents } from "./brand";

/**
 * Chrome-free harness page for the eval layers.
 * /eval.html?fixture=<id>&width=<px>&kit=neutral|editorial&mode=light|dark[&policy=<json>][&maxHeight=<px>]
 * Window hooks: __actions (emitted UserActions), __session (AnswerSession), __ready.
 */
const q = new URLSearchParams(location.search);
const kits = { neutral, editorial, brand } as const;
const w = window as unknown as {
  __actions: UserAction[];
  __session: AnswerSession;
  __ready: boolean;
};
w.__actions = [];
const runtime = createUIRuntime({
  onAction: (a) => {
    w.__actions.push(a);
  },
});
const policy = JSON.parse(q.get("policy") ?? "{}") as Partial<HostPolicy>;
const content = sampleContent(runtime.attachments, location.origin, (id) => {
  w.__actions.push({ name: id } as UserAction);
});
const session = new AnswerSession(runtime, { policy });
w.__session = session;
const id = q.get("fixture") ?? fixtures[0].id;
const hybrid = hybridFixtures.find((f) => f.id === id);
const legacy = fixtures.find((f) => f.id === id) ?? fixtures[0];
const media = mediaFixtures.find((f) => f.id === id) ?? advanced.find((f) => f.id === id);
const showcase = showcases.find((f) => f.id === id);
const declaration = JSON.stringify({
  engine: "v1",
  block: "surface",
  surfaceId: "main",
  fallbackText: `${legacy.title}. ${legacy.prompt}`,
});
session.push(
  q.has("composition")
    ? q.get("composition")! + "\n"
    : showcase
      ? showcase.wire
      : hybrid
        ? hybrid.wire
        : [declaration, ...(media?.messages ?? legacy.messages).map((m) => JSON.stringify(m))].join(
            "\n",
          ),
);
session.end();
const width = Number(q.get("width") ?? 720);
const mode = q.get("mode") === "dark" ? "dark" : "light";
const maxHeight = q.get("maxHeight") ? Number(q.get("maxHeight")) : undefined;
createRoot(document.getElementById("root") as HTMLElement).render(
  <div id="chat-column" style={{ width, margin: "0 auto" }}>
    <UIProvider
      runtime={runtime}
      kit={kits[(q.get("kit") as keyof typeof kits) ?? "neutral"] ?? neutral}
      mode={mode}
      components={brandComponents}
      content={content}
    >
      {q.has("markdown") ? (
        <SafeMarkdown text={q.get("markdown") ?? ""} />
      ) : q.has("media") ? (
        <MediaContent ids={(q.get("media") ?? "").split(",")} />
      ) : (
        <AnswerView session={session} maxSurfaceHeight={maxHeight} />
      )}
    </UIProvider>
  </div>,
);
requestAnimationFrame(() => requestAnimationFrame(() => (w.__ready = true)));
