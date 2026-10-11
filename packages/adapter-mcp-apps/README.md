# @engine/adapter-mcp-apps

Optional MCP Apps integration using the official `@modelcontextprotocol/ext-apps` SDK.

`meldUIResource('ui://my-service/answer', prebuiltHtml)` creates a `text/html;profile=mcp-app` UI resource with host-owned CSP metadata. `meldUIToolResult(session, resourceUri)` supplies text and structured answer history. Serve only a trusted host-built UI resource.

Inside the app, `await connectMeldUIApp({onResult,onContext,onDispose})` registers handlers before connecting through `PostMessageTransport`. Restore tool-result history into a fresh runtime under current host policy. The returned standard App exposes host tool calls, context and display-mode requests.

On the host, `createMeldUIAppBridge(hostBridge,{sendMessage,context,displayMode})` returns the official AppBridge with validated host tools and optional message/display handlers. Connect it using the standard MCP Apps host transport. Inline is the fallback display mode; permission, confirmation and lifecycle remain host responsibilities.

The test connects actual App/AppBridge instances over paired transports and checks tool schema/confirmation boundaries. No new RPC protocol is invented. Apache-2.0; private preview. See [shared contracts](../../docs/PHASE3.md).
