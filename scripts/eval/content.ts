import { AnswerSession } from "../../packages/core/src/answer.js";
import {
  AttachmentRegistry,
  mediaLayout,
  resolveAttachment,
} from "../../packages/core/src/attachments.js";
import { createUIRuntime } from "../../packages/core/src/index.js";
import { prepareMarkdown } from "../../packages/core/src/markdown.js";
import { type Row, readJson, split } from "./common.js";
/** Offline content checks are host-fixture/replay evidence, never generated answer quality. */
export async function evaluateContent(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const item of readJson<any[]>("eval/safety/xss.json")) {
    const parts = prepareMarkdown(item.payload);
    const bad = parts.some(
      (p) => "markdown" in p && /!\[[^\]]*\]\((https?:|data:|javascript:)/i.test(p.markdown),
    );
    rows.push({
      layer: "safety-markdown",
      id: item.id,
      status: bad ? "fail" : "pass",
      detail: "sanitized AST; browser execution corpus verified separately",
    });
  }
  for (const item of readJson<any[]>("eval/media.json")) {
    const registry = new AttachmentRegistry();
    try {
      const records =
        readJson<Record<string, unknown[]>>("eval/attachments.json")[item.attachments] ?? [];
      for (const a of records) registry.attach(a as never);
      const safe = JSON.stringify(registry.views());
      rows.push({
        layer: "media:registration",
        id: item.id,
        split: split("media", item.id),
        status: /(https?:\/\/|SECRET|[?&](sig|token)=)/i.test(safe) ? "fail" : "pass",
        detail: `${registry.list().length} registered metadata records; replay registration, not generated layout`,
      });
    } catch {
      rows.push({
        layer: "media:registration",
        id: item.id,
        status: "fail",
        detail: "host fixture rejected",
      });
    }
  }
  for (const fixture of readJson<any[]>("fixtures/media/cases.json")) {
    const runtime = createUIRuntime();
    for (const attachment of fixture.attachments) runtime.attachments.attach(attachment);
    for (const message of fixture.messages) runtime.accept(message);
    runtime.finish();
    const invalid =
      runtime.diagnostics.length ||
      [...runtime.getSurface("main")!.componentsModel.values].some(
        (node) => runtime.getNodeSnapshot("main", node.id).error,
      );
    rows.push({
      layer: "media:catalog",
      id: fixture.id,
      status: invalid ? "fail" : "pass",
      detail: "all content components; registered host IDs; original catalog wire preserved",
    });
    runtime.dispose();
  }
  const registry = new AttachmentRegistry();
  registry.attach({ id: "photo", kind: "image", mime: "image/png", name: "Photo" });
  let calls = 0;
  await resolveAttachment(
    {
      attachments: registry,
      policy: { origins: ["https://host.example"] },
      resolver: {
        resolve: async () => ({
          url: "https://host.example/photo.png",
          mime: "image/png",
          expiresAt: ++calls === 1 ? Date.now() - 1 : undefined,
        }),
      },
    },
    "photo",
  );
  rows.push({
    layer: "media:resolver",
    id: "expired-refresh",
    status: calls === 2 ? "pass" : "fail",
    detail: "one expired response, one refresh",
  });
  rows.push({
    layer: "media:layout-choice",
    id: "count",
    status: mediaLayout([registry.get("photo")!]) === "hero" ? "pass" : "fail",
    detail: "count/kind selection; physical layout separately measured",
  });
  const runtime = createUIRuntime();
  const session = new AnswerSession(runtime, { policy: { mode: "markdown-only" } });
  session.push("A short fact.\n");
  session.pushMessage({
    version: "v0.9",
    createSurface: { surfaceId: "main", catalogId: "urn:engine:catalog:core:1" },
  });
  session.end();
  rows.push({
    layer: "routing:host-policy",
    id: "markdown-only",
    status: runtime.surfaceIds.length === 0 ? "pass" : "fail",
    detail: "host enforcement; model routing quality remains a live measurement",
  });
  runtime.dispose();
  return rows;
}
