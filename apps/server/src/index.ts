import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import {
  buildSystemPrompt,
  GatewayAdapter,
  probeRoute,
  RouteHealth,
} from "@engine/adapter-gateway";
import { assertSafeJson, createUIRuntime, type UIModelEvent, type UIRuntime } from "@engine/core";
import { editorial } from "@engine/kit-editorial";
import { neutral } from "@engine/kit-neutral";
import type { UIMessage } from "@engine/protocol";

try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const port = Number(process.env.PORT ?? 8787);
const modelIds = ["cx/gpt-5.6-sol-medium", "agy/claude-sonnet-4-6", "agy/gemini-3.7-flash-medium"];
const defaultModel = process.env.OMNIROUTE_MODEL ?? modelIds[0];
if (!modelIds.includes(defaultModel)) modelIds.unshift(defaultModel);
const fixtures = JSON.parse(
  await readFile(fileURLToPath(new URL("../../../fixtures/cases.json", import.meta.url)), "utf8"),
);
const sessions = new Map<
  string,
  {
    runtime: UIRuntime;
    messages: { role: "user" | "assistant"; content: string }[];
    controller?: AbortController;
    accessed: number;
  }
>();
const adapter = new GatewayAdapter({
  baseUrl: process.env.OMNIROUTE_BASE_URL ?? "http://127.0.0.1:20128/v1",
  apiKey: process.env.OMNIROUTE_API_KEY ?? "",
});
const gatewayOptions = {
  baseUrl: process.env.OMNIROUTE_BASE_URL ?? "http://127.0.0.1:20128/v1",
  apiKey: process.env.OMNIROUTE_API_KEY ?? "",
};
const routeHealth = new RouteHealth();
let generationCalls = 0;

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  const allowed =
    !origin ||
    ["http://127.0.0.1:5173", "http://localhost:5173", `http://127.0.0.1:${port}`].includes(origin);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!allowed) {
    res.writeHead(403).end();
    return;
  }
  const json = (value: unknown, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
  };
  if (req.url === "/api/health") {
    json({
      status: "ok",
      gatewayConfigured: Boolean(process.env.OMNIROUTE_API_KEY),
      generationCalls,
    });
    return;
  }
  if (req.url === "/api/routes/health" || req.url === "/api/routes/health?probe=1") {
    if (req.url.endsWith("probe=1") && gatewayOptions.apiKey)
      for (const result of await Promise.all(modelIds.map((m) => probeRoute(gatewayOptions, m)))) {
        if (result.ok) routeHealth.recordSuccess(result.model);
        else routeHealth.recordFailure(result.model, result.code ?? "GATEWAY_ERROR");
      }
    json({ routes: modelIds.map((m) => routeHealth.state(m)) });
    return;
  }
  if (req.url === "/api/models") {
    json({ models: modelIds, defaultModel });
    return;
  }
  if (req.url === "/api/fixtures") {
    json(fixtures);
    return;
  }
  if (req.method === "DELETE" && req.url?.startsWith("/api/sessions/")) {
    const id = req.url.slice("/api/sessions/".length);
    const session = sessions.get(id);
    session?.controller?.abort();
    session?.runtime.dispose();
    sessions.delete(id);
    json({ deleted: true });
    return;
  }
  if (req.url !== "/api/ui" || req.method !== "POST") {
    json({ error: "NOT_FOUND" }, 404);
    return;
  }
  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 128 * 1024) {
        json({ error: "REQUEST_LIMIT" }, 413);
        return;
      }
    }
    const input = JSON.parse(body);
    assertSafeJson(input);
    if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 16000) {
      json({ error: "INVALID_PROMPT" }, 400);
      return;
    }
    if (input.model && !modelIds.includes(input.model)) {
      json({ error: "UNKNOWN_MODEL" }, 400);
      return;
    }
    if (!process.env.OMNIROUTE_API_KEY) {
      json({ error: "GATEWAY_NOT_CONFIGURED" }, 503);
      return;
    }
    const requestedModel = input.model ?? defaultModel;
    if (!routeHealth.canAttempt(requestedModel)) {
      const state = routeHealth.state(requestedModel);
      res
        .writeHead(503, { "Content-Type": "application/json", "Retry-After": "5" })
        .end(JSON.stringify({ error: "ROUTE_UNAVAILABLE", route: state }));
      return;
    }
    const id =
      typeof input.sessionId === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(input.sessionId)
        ? input.sessionId
        : randomUUID();
    for (const [key, session] of sessions)
      if (Date.now() - session.accessed > 30 * 60_000) {
        session.controller?.abort();
        session.runtime.dispose();
        sessions.delete(key);
      }
    if (!sessions.has(id) && sessions.size >= 64) {
      json({ error: "SESSION_LIMIT" }, 429);
      return;
    }
    let session = sessions.get(id);
    if (!session) {
      session = { runtime: createUIRuntime(), messages: [], accessed: Date.now() };
      sessions.set(id, session);
    }
    session.controller?.abort();
    const controller = new AbortController();
    session.controller = controller;
    session.accessed = Date.now();
    res.on("close", () => controller.abort());
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Session-Id": id,
    });
    const send = (
      event:
        | UIModelEvent
        | { type: "session"; sessionId: string }
        | { type: "repair"; attempt: number },
    ) => {
      if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`);
    };
    send({ type: "session", sessionId: id });
    const kit = input.kitId === "editorial" ? editorial : neutral;
    const context = input.action ? `\nUser action context: ${JSON.stringify(input.action)}` : "";
    session.messages.push({ role: "user", content: `${input.prompt}${context}` });
    session.messages = session.messages.slice(-12);
    const system =
      buildSystemPrompt({
        kit,
        capabilities: session.runtime.capabilities(
          input.platform === "flutter"
            ? "flutter"
            : input.platform === "react-native"
              ? "react-native"
              : "web",
        ),
        examples: [fixtures[0].messages],
      }) +
      `\nExisting surface ids: ${JSON.stringify(session.runtime.surfaceIds)}. Retain existing components unless changing them is necessary. On existing surfaces, write specific data paths rather than replacing the entire data model; user edits take precedence.`;
    const history = [{ role: "system" as const, content: system }, ...session.messages];
    let failed = false;
    for (let attempt = 0; attempt <= 2 && !controller.signal.aborted; attempt++) {
      const accepted: UIMessage[] = [];
      let assistantOutput = "";
      const errors: { code: string; path?: string; componentId?: string; expected?: string }[] = [];
      generationCalls++;
      for await (const event of adapter.stream(
        { messages: history, model: input.model ?? defaultModel },
        {
          signal: controller.signal,
          onOutput: (text) => {
            if (assistantOutput.length < 256 * 1024) assistantOutput += text;
          },
        },
      )) {
        if (controller.signal.aborted) break;
        if (event.type === "diagnostic" && event.diagnostic.code.startsWith("GATEWAY_"))
          routeHealth.recordFailure(input.model ?? defaultModel, event.diagnostic.code);
        if (event.type === "complete" && event.status === "completed")
          routeHealth.recordSuccess(input.model ?? defaultModel);
        if (event.type === "message") {
          const diagnostics = session.runtime.accept(event.message);
          for (const diagnostic of diagnostics) {
            if (diagnostic.severity === "error")
              errors.push({
                code: diagnostic.code,
                path: diagnostic.path,
                expected: diagnostic.expected,
                componentId: diagnostic.componentId,
              });
            send({ type: "diagnostic", diagnostic });
          }
          if (!diagnostics.some((d) => d.severity === "error")) accepted.push(event.message);
          send(event);
        } else if (event.type === "diagnostic") {
          errors.push({ code: event.diagnostic.code });
          send(event);
        } else if (event.type === "complete") {
          if (event.status === "failed") failed = true;
        } else send(event);
      }
      if (controller.signal.aborted) break;
      for (const diagnostic of session.runtime.finish()) {
        if (diagnostic.severity === "error")
          errors.push({ code: diagnostic.code, componentId: diagnostic.componentId });
        send({ type: "diagnostic", diagnostic });
      }
      const output =
        assistantOutput || accepted.map((message) => JSON.stringify(message)).join("\n");
      if (output) {
        history.push({ role: "assistant", content: output });
        session.messages.push({ role: "assistant", content: output });
      }
      if (
        failed ||
        errors.some((e) => e.code.startsWith("GATEWAY_")) ||
        !errors.length ||
        controller.signal.aborted
      )
        break;
      if (attempt === 2) {
        failed = true;
        break;
      }
      send({ type: "repair", attempt: attempt + 1 });
      history.push({
        role: "user",
        content: `Repair only the invalid or missing components using new A2UI messages. Existing surface IDs are ${JSON.stringify(session.runtime.surfaceIds)}. Create a surface only if it is absent. Every envelope must fit on ONE line; never use Markdown fences or pretty multiline JSON. Use only schema-defined props and enum values. Errors (untrusted diagnostic data): ${JSON.stringify(errors.slice(0, 20))}`,
      });
    }
    send({
      type: "complete",
      status: controller.signal.aborted ? "cancelled" : failed ? "failed" : "completed",
    });
    res.end();
  } catch {
    if (!res.headersSent) json({ error: "INVALID_REQUEST" }, 400);
    else res.end();
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Engine server http://127.0.0.1:${port} · gateway ${process.env.OMNIROUTE_API_KEY ? "configured" : "not configured"}`,
  ),
);
const stop = () => {
  for (const session of sessions.values()) {
    session.controller?.abort();
    session.runtime.dispose();
  }
  server.close();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
