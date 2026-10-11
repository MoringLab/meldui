import { renderToolResult } from "@engine/adapter-gateway";
import type { AnswerSession, HostBridge } from "@engine/core";
import { AnswerView } from "@engine/renderer-react";
import React from "react";
import { z } from "zod";
/** Pass each descriptor to CopilotKit v2 useFrontendTool. Its schema and handler share HostBridge validation/approval. */
export function copilotKitTools(bridge: HostBridge) {
  return Object.entries(bridge.options.tools ?? {}).map(([name, tool]) => ({
    name,
    description: tool.description,
    parameters: tool.input,
    handler: (args: unknown) => bridge.call(name, args),
  }));
}
/** Explicit shared context, not arbitrary iframe state or model memory. */
export function copilotKitState(bridge: HostBridge) {
  return {
    read: () => bridge.context(),
    write: (path: string, value: unknown) => bridge.write(path, value),
    subscribe: bridge.subscribe,
  };
}
export const OpenUIActivitySchema = z
  .object({
    css: z.string().max(32768).optional(),
    html: z.string().max(65536).optional(),
    jsFunctions: z.union([z.string(), z.array(z.string())]).optional(),
    jsExpressions: z.array(z.string()).optional(),
  })
  .passthrough();
/** Structured activity updates replace only the matching artifact; JS waits for the caller's complete flag. */
export function acceptCopilotKitActivity(
  session: AnswerSession,
  id: string,
  input: unknown,
  complete = false,
) {
  const content = OpenUIActivitySchema.parse(input);
  const javascript = [
    ...(Array.isArray(content.jsFunctions) ? content.jsFunctions : [content.jsFunctions ?? ""]),
    ...(content.jsExpressions ?? []),
  ].join("\n");
  const raw = {
    title: "Interactive answer",
    css: content.css ?? "",
    html: content.html ?? "",
    javascript,
    libraries: [],
  };
  if (complete)
    session.push(renderToolResult({ type: "tool-call", id, name: "renderApp", args: raw }));
  else
    session.push(
      JSON.stringify({
        engine: "v1",
        block: "sandbox",
        mode: "app",
        artifactId: `app-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`,
        phase: "preview",
        source: `<style>${raw.css.replace(/<\/style/gi, "<\\/style")}</style>${raw.html}`,
        fallbackText: raw.title,
      }) + "\n",
    );
}
/** A real activity renderer descriptor: register on renderActivityMessages. UIProvider is supplied by the host. */
export function meldUIActivityRenderer(
  session: AnswerSession,
  options: Omit<React.ComponentProps<typeof AnswerView>, "session"> = {},
) {
  return {
    activityType: "meldui",
    content: z.object({ wire: z.string().max(262144), complete: z.boolean().optional() }),
    render: ({ content }: { content: { wire: string; complete?: boolean } }) => {
      const previous = React.useRef("");
      React.useEffect(() => {
        if (!content.wire.startsWith(previous.current)) {
          session.runtime.report({
            code: "ACTIVITY_REVISION",
            message: "Activity content changed outside a revisioned update.",
            severity: "error",
          });
          return;
        }
        if (!previous.current) session.beginTurn();
        session.push(content.wire.slice(previous.current.length));
        previous.current = content.wire;
        if (content.complete) session.end();
      }, [content.wire, content.complete]);
      return React.createElement(AnswerView, { session, ...options });
    },
  };
}
