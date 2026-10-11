import { type AnswerSession, assertSafeJson, type HostBridge } from "@engine/core";
import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
/** A standard UI resource backed by the host's prebuilt MeldUI app, not model-provided module URLs. */
export function meldUIResource(
  uri: string,
  html: string,
  options: { resourceDomains?: string[]; description?: string } = {},
) {
  if (!/^ui:\/\/[-a-zA-Z0-9/._]+$/.test(uri) || html.length > 4 * 1024 * 1024)
    throw Error("MCP_UI_RESOURCE");
  return {
    uri,
    mimeType: "text/html;profile=mcp-app",
    text: html,
    _meta: {
      ui: { csp: { connectDomains: [], resourceDomains: options.resourceDomains ?? [] } },
      "openai/widgetDescription": options.description ?? "Interactive MeldUI answer",
    },
  };
}
export function meldUIToolResult(session: AnswerSession, resourceUri: string) {
  return {
    content: [{ type: "text" as const, text: session.asText() }],
    structuredContent: { history: session.serialize() },
    _meta: { ui: { resourceUri } },
  };
}
/** Connect an iframe view to any MCP Apps host. Provide a fresh runtime when restoring history. */
export async function connectMeldUIApp(options: {
  onResult: (result: unknown) => void;
  onContext?: (context: unknown) => void;
  onDispose?: () => void;
  transport?: Parameters<App["connect"]>[0];
  autoResize?: boolean;
}) {
  const app = new App(
    { name: "MeldUI", version: "0.1.0" },
    {},
    { autoResize: options.autoResize ?? true },
  );
  app.ontoolresult = (result) => {
    assertSafeJson(result);
    options.onResult(result);
  };
  app.onhostcontextchanged = (context) => options.onContext?.(context);
  app.onteardown = async () => {
    options.onDispose?.();
    return {};
  };
  await app.connect(options.transport ?? new PostMessageTransport(window.parent, window.parent));
  return app;
}
/** UI tools cross the same validated bridge used by native and code artifacts. */
export function createMeldUIAppBridge(
  host: HostBridge,
  options: {
    sendMessage?: (text: string) => Promise<void>;
    context?: Record<string, any>;
    displayMode?: (
      mode: "inline" | "fullscreen" | "pip",
    ) => Promise<"inline" | "fullscreen" | "pip">;
  } = {},
) {
  const bridge = new AppBridge(
    null,
    { name: "MeldUI host", version: "0.1.0" },
    {},
    {
      hostContext: {
        theme: "light",
        availableDisplayModes: ["inline", "fullscreen", "pip"],
        ...options.context,
      },
    },
  );
  bridge.oncalltool = async (params) => {
    const value = await host.call(params.name, params.arguments ?? {});
    return {
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
      structuredContent: { value },
    };
  };
  bridge.onmessage = async (params) => {
    const text = params.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    if (text.length > 16000) throw Error("HOST_MESSAGE_LIMIT");
    if (!options.sendMessage) throw Error("HOST_MESSAGE_DENIED");
    await options.sendMessage(text);
    return {};
  };
  bridge.onrequestdisplaymode = async ({ mode }) => ({
    mode: (await options.displayMode?.(mode)) ?? "inline",
  });
  return bridge;
}
