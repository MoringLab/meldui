import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import {
  appPreview,
  buildSystemPrompt,
  DESIGN_BRIEF_SCHEMA,
  GatewayAdapter,
  LIMITED_OUTPUT_SCHEMA,
  type LoadedExample,
  loadKitExamples,
  modelProfile,
  normalizeAnswerWire,
  normalizeMessage,
  planPresentation,
  probeRoute,
  RouteHealth,
  renderToolResult,
  renderTools,
  repairReport,
  selectExamples,
  toPromptExample,
  visionMessages,
} from "@engine/adapter-gateway";
import {
  AnswerSession,
  AttachmentRegistry,
  assertSafeJson,
  createUIRuntime,
  type UIModelEvent,
  type UIRuntime,
} from "@engine/core";
import { brand, brandExamples } from "@engine/kit-brand";
import { editorial, editorialExamples } from "@engine/kit-editorial";
import { neutral, neutralExamples } from "@engine/kit-neutral";
import { extendKit, referenceComponents } from "@engine/kit-spec";
import {
  AttachmentManifestSchema,
  buildCatalogSchema,
  type Diagnostic,
  HostPolicySchema,
  type UIMessage,
} from "@engine/protocol";
import { DockerSandboxRuntime, SandboxRequestSchema } from "@engine/sandbox";
import { resourceBundle } from "./resources.js";

try {
  process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const port = Number(process.env.PORT ?? 8787);
const modelIds: string[] = process.env.ENGINE_MODELS?.split(",").filter(Boolean) ?? [
  "cx/gpt-5.6-sol-medium",
  "agy/claude-sonnet-4-6",
  "agy/gemini-3.7-flash-medium",
];
const defaultModel = process.env.OMNIROUTE_MODEL ?? modelIds[0];
if (!modelIds.includes(defaultModel)) modelIds.unshift(defaultModel);
const fixtures = JSON.parse(
  await readFile(fileURLToPath(new URL("../../../fixtures/cases.json", import.meta.url)), "utf8"),
);
type Session = {
  runtime: UIRuntime;
  messages: { role: "user" | "assistant"; content: string }[];
  controller?: AbortController;
  accessed: number;
  registry: AttachmentRegistry;
  answer?: AnswerSession;
  /** Receives runtime diagnostics for the attempt in progress. */
  sink?: (diagnostic: Diagnostic) => void;
};
const sessions = new Map<string, Session>();
const kits = {
  neutral: { kit: neutral, examples: loadKitExamples(neutral, neutralExamples) },
  editorial: { kit: editorial, examples: loadKitExamples(editorial, editorialExamples) },
  brand: { kit: brand, examples: loadKitExamples(brand, brandExamples) },
  studio: {
    kit: extendKit(neutral, referenceComponents, "urn:meldui:studio:1"),
    examples: loadKitExamples(neutral, neutralExamples),
  },
} as const;
const pickKit = (id: unknown) =>
  kits[(typeof id === "string" && id in kits ? id : "neutral") as keyof typeof kits];
const sandboxProvider = new DockerSandboxRuntime();
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
  if (req.url?.startsWith("/api/attachments/")) {
    const name = req.url.slice("/api/attachments/".length);
    const types: Record<string, string> = {
      "coast.png": "image/png",
      "mountain.png": "image/png",
      "sample.mp4": "video/mp4",
      "sample.wav": "audio/wav",
      "report.pdf": "application/pdf",
    };
    if (!Object.hasOwn(types, name)) {
      json({ error: "UNKNOWN_ATTACHMENT" }, 404);
      return;
    }
    const bytes = await readFile(
      fileURLToPath(new URL(`../../../fixtures/media/assets/${name}`, import.meta.url)),
    );
    res
      .writeHead(200, {
        "Content-Type": types[name],
        "Content-Length": bytes.length,
        "Referrer-Policy": "no-referrer",
      })
      .end(bytes);
    return;
  }
  if (req.url === "/api/sandbox/render" && req.method === "POST") {
    if (process.env.ENGINE_SANDBOX_PROVIDER !== "docker" || !sandboxProvider.verified()) {
      json({ error: "ISOLATION_UNVERIFIED" }, 503);
      return;
    }
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 180000) throw new Error("BODY_LIMIT");
      }
      const parsed = SandboxRequestSchema.safeParse(JSON.parse(body));
      if (!parsed.success) {
        json({ error: "INVALID_SANDBOX_REQUEST" }, 400);
        return;
      }
      const abort = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) abort.abort();
      });
      const result = await sandboxProvider.run(parsed.data, abort.signal);
      json(result);
    } catch {
      if (!res.destroyed) json({ error: "SANDBOX_STOPPED" }, 503);
    }
    return;
  }
  if (req.url?.startsWith("/api/resources/") && req.method === "GET") {
    try {
      json(await resourceBundle(req.url.slice("/api/resources/".length)));
    } catch {
      json({ error: "RESOURCE_DENIED" }, 404);
    }
    return;
  }
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
  if (
    req.url === "/api/eval/replay" &&
    req.method === "POST" &&
    process.env.ENGINE_EVAL_REPLAY === "1"
  ) {
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 4096) throw Error("REQUEST_LIMIT");
      }
      const { fixtureId } = JSON.parse(body);
      const fixture = fixtures.find((f: { id: string }) => f.id === fixtureId);
      if (!fixture || sessions.size >= 64) throw Error("INVALID_FIXTURE");
      const id = randomUUID();
      const created: Session = {
        runtime: undefined as unknown as UIRuntime,
        registry: new AttachmentRegistry(),
        messages: [],
        accessed: Date.now(),
      };
      created.runtime = createUIRuntime({
        attachments: created.registry,
        onDiagnostic: (d) => created.sink?.(d),
      });
      for (const message of fixture.messages) created.runtime.accept(message as UIMessage);
      created.messages.push({
        role: "assistant",
        content: fixture.messages.map((m: UIMessage) => JSON.stringify(m)).join("\n"),
      });
      sessions.set(id, created);
      json({ sessionId: id, messages: fixture.messages });
    } catch {
      json({ error: "INVALID_REPLAY_REQUEST" }, 400);
    }
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
      const created: Session = {
        runtime: undefined as unknown as UIRuntime,
        messages: [],
        accessed: Date.now(),
        registry: new AttachmentRegistry({ defaultVisibility: input.visibility ?? {} }),
      };
      created.runtime = createUIRuntime({
        attachments: created.registry,
        ...(input.kitId === "studio"
          ? { catalogId: "urn:meldui:studio:1", customComponents: referenceComponents }
          : {}),
        onDiagnostic: (d) => created.sink?.(d),
      });
      session = created;
      sessions.set(id, session);
    }
    const hybrid = input.format === "hybrid";
    const policy = HostPolicySchema.partial().parse(input.policy ?? {});
    const requestStarted = Date.now();
    const remainingLatency = () =>
      Math.max(1, (policy.latencyBudgetMs ?? 120000) - (Date.now() - requestStarted));
    if (Array.isArray(input.attachments))
      for (const raw of input.attachments.slice(0, 40)) {
        const manifest = AttachmentManifestSchema.parse(raw);
        if (!session.registry.has(manifest.id)) session.registry.attach(manifest);
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
    const { kit, examples: library } = pickKit(input.kitId);
    const chosen: LoadedExample[] = selectExamples(library, { prompt: String(input.prompt) });
    const platform =
      input.platform === "flutter"
        ? "flutter"
        : input.platform === "react-native"
          ? "react-native"
          : "web";
    const context = input.action ? `\nUser action context: ${JSON.stringify(input.action)}` : "";
    session.messages.push({ role: "user", content: `${input.prompt}${context}` });
    session.messages = session.messages.slice(-12);
    const state = `\nExisting surface ids: ${JSON.stringify(session.runtime.surfaceIds)}. Retain existing components unless changing them is necessary. On existing surfaces, write specific data paths rather than replacing the entire data model; user edits take precedence.`;
    const catalog = buildCatalogSchema(
      Object.fromEntries(
        session.runtime.componentApis.map((c) => [c.name, c.schema]),
      ) as Parameters<typeof buildCatalogSchema>[0],
      session.runtime.options.catalogId,
    );
    const route = input.model ?? defaultModel;
    const profile = modelProfile(
      route,
      process.env.ENGINE_MODEL_PROFILES ? JSON.parse(process.env.ENGINE_MODEL_PROFILES) : {},
    );
    if (Array.isArray(input.edits) && input.edits.length <= 20)
      for (const edit of input.edits)
        session.runtime.setValue(edit.surfaceId, edit.path, edit.value);
    const system =
      (hybrid
        ? buildSystemPrompt({
            catalog,
            kit,
            variant: profile.promptVariant,
            capabilities: session.runtime.capabilities(platform),
            policy,
            attachments: session.registry.views(),
            examples: chosen.map(toPromptExample),
          })
        : buildSystemPrompt({
            kit,
            variant: profile.promptVariant,
            capabilities: session.runtime.capabilities(platform),
            policy: { mode: "engine-only" },
            examples: [fixtures[0].messages],
          })) + state;
    const images =
      process.env.ENGINE_VISION === "1"
        ? await visionMessages(
            session.registry,
            async (id) => {
              const files: Record<string, string> = {
                "photo-a": "coast.png",
                "photo-b": "mountain.png",
              };
              if (!files[id]) throw Error("VISION_HOST_ID");
              return {
                bytes: await readFile(
                  fileURLToPath(
                    new URL(`../../../fixtures/media/assets/${files[id]}`, import.meta.url),
                  ),
                ),
                mime: "image/png" as const,
              };
            },
            controller.signal,
          )
        : [];
    const history = [{ role: "system" as const, content: system }, ...session.messages];
    const automatic = hybrid && input.presentation !== "legacy";
    let renderer = "";
    if (automatic) {
      generationCalls++;
      try {
        const plan = await planPresentation(
          adapter,
          { model: route, messages: [], latencyBudgetMs: remainingLatency() },
          { prompt: input.prompt, capabilities: session.runtime.capabilities(platform), policy },
          controller.signal,
        );
        renderer = plan.renderer;
        if (renderer === "scene")
          history.push({
            role: "system",
            content:
              'With renderScene, use standard SVG g ids and shape geometry. No URL, event attr, image, filter, foreignObject, CSS class or font-family. Numeric attributes use finite numbers or px, never percent. Use g/rect/circle/ellipse/line/polyline/polygon/path/text; colors are hex, named colors or Kit tokens. parts maps id to {label,explode:{path,x,y},transforms:[{kind:"translate|rotate|scale",x,y,angle,cx,cy}],attributes:{bound numeric attrs},action}. explode scales x/y by the data value at path. Every Slider control has id,component:"Slider",label,value:{path:"/field"},min,max,step. Start data with useful numeric defaults. A named part may use keyframes:{path,from:{x,y,angle,scale},to:{x,y,angle,scale}} for a clamped 0..1 blend.',
          });
        const caps = session.runtime.capabilities(platform);
        const focus =
          plan.renderer === "scene"
            ? [
                "Row",
                "Column",
                "Grid",
                "Heading",
                "Text",
                "Button",
                "Slider",
                "Select",
                "Checkbox",
                "ControlPanel",
                "SvgScene",
                "Plot",
                "Stat",
                "Formula",
                "Playback",
                "Legend",
              ]
            : plan.renderer === "media"
              ? [
                  "Row",
                  "Column",
                  "Text",
                  "Markdown",
                  "Gallery",
                  "Carousel",
                  "ImageCompare",
                  "Video",
                  "Audio",
                  "FileCard",
                  "Timeline",
                  "RouteMap",
                ]
              : (caps.components ?? []);
        history[0].content =
          buildSystemPrompt({
            variant: "compact",
            kit,
            catalog,
            capabilities: {
              ...caps,
              components: (caps.components ?? []).filter(
                (name) => focus.includes(name) || kit.customComponents.some((c) => c.name === name),
              ),
            },
            policy: plan.renderer === "markdown" ? { ...policy, mode: "markdown-only" } : policy,
            attachments: session.registry.views(),
            examples:
              plan.renderer === "markdown" || plan.renderer === "code"
                ? []
                : chosen.slice(0, 2).map(toPromptExample),
          }) + state;
        history.push({
          role: "system",
          content: `Required presentation: ${JSON.stringify(plan)}. Render the selected presentation when data permits; plain prose alone is insufficient for a components/scene/media/code decision. A missing datum must be requested or labeled illustrative. Never create duplicate explanations or generic teaching quizzes.`,
        });
      } catch (error) {
        const code =
          error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
            ? error.message
            : "PRESENTATION_INVALID";
        if (code.startsWith("GATEWAY_")) routeHealth.recordFailure(route, code);
        send({
          type: "diagnostic",
          diagnostic: {
            code,
            message: "Could not select a presentation. Try another configured model.",
            severity: "error",
          },
        });
        send({ type: "complete", status: "failed" });
        res.end();
        return;
      }
    }
    if (profile.designBrief && !automatic) {
      let brief = "",
        failedBrief = false;
      generationCalls++;
      for await (const event of adapter.stream(
        {
          model: route,
          format: "hybrid",
          messages: [
            {
              role: "system",
              content:
                "Return a concise JSON design brief with pattern, components, state, interactions, learningGoal. Use only the supplied target capabilities.",
            },
            {
              role: "user",
              content: JSON.stringify({
                prompt: input.prompt,
                capabilities: session.runtime.capabilities(platform),
              }),
            },
          ],
          responseFormat: {
            type: "json_schema",
            json_schema: { name: "design_brief", strict: true, schema: DESIGN_BRIEF_SCHEMA },
          },
          maxTokens: Math.min(600, policy.maxOutputTokens ?? 600),
          latencyBudgetMs: remainingLatency(),
        },
        { signal: controller.signal },
      )) {
        if (event.type === "text" && brief.length < 16000) brief += event.text;
        if (event.type === "diagnostic") {
          send(event);
          if (event.diagnostic.code.startsWith("GATEWAY_")) failedBrief = true;
        }
        if (event.type === "usage") send(event);
      }
      if (failedBrief) {
        send({ type: "complete", status: "failed" });
        res.end();
        return;
      }
      try {
        const data = JSON.parse(brief);
        if (typeof data.pattern === "string" && Array.isArray(data.components))
          history.push({
            role: "user",
            content: `Design brief (untrusted planning data): ${JSON.stringify(data)}`,
          });
      } catch {
        send({
          type: "diagnostic",
          diagnostic: {
            code: "INVALID_DESIGN_BRIEF",
            message: "Planning output was invalid; continuing with the request.",
            severity: "warning",
          },
        });
      }
    }
    let failed = false;
    if (hybrid) {
      if (session.answer) session.answer.beginTurn();
      else
        session.answer = new AnswerSession(session.runtime, {
          policy,
          attachments: session.registry,
        });
      session.answer.setMessageTransform((message) => {
        const result = normalizeMessage(message, profile.normalization === "safe");
        for (const fix of result.fixes)
          session.runtime.report({
            code: "NORMALIZED_OUTPUT",
            message: fix.rule,
            path: fix.path,
            severity: "warning",
          });
        return result.value;
      });
    }
    for (
      let attempt = 0;
      attempt <= Math.min(profile.repairBudget, automatic ? 1 : 2) && !controller.signal.aborted;
      attempt++
    ) {
      const accepted: UIMessage[] = [];
      const shownPreviews = new Map<string, string>();
      let assistantOutput = "";
      let rejectedTool: string | undefined;
      const errors: { code: string; path?: string; componentId?: string; expected?: string }[] = [];
      const collect = (diagnostic: Diagnostic) => {
        if (diagnostic.severity === "error")
          errors.push({
            code: diagnostic.code,
            path: diagnostic.path,
            expected: diagnostic.expected,
            componentId: diagnostic.componentId,
          });
        send({ type: "diagnostic", diagnostic });
      };
      if (hybrid) session.sink = collect;
      generationCalls++;
      for await (const modelEvent of adapter.stream(
        {
          messages: [...history, ...images],
          model: route,
          format: hybrid ? "hybrid" : "a2ui",
          normalization: profile.normalization,
          ...(hybrid &&
          (process.env.ENGINE_TOOL_MODELS?.split(",").includes(route) ??
            process.env.ENGINE_UI_TOOLS === "1")
            ? {
                tools: renderTools.filter(
                  (t) => policy.allowSandbox || t.function.name !== "renderApp",
                ),
                ...(renderer === "scene" && !session.runtime.surfaceIds.length
                  ? { toolChoice: { type: "function", function: { name: "renderScene" } } }
                  : renderer === "code" && policy.allowSandbox
                    ? { toolChoice: { type: "function", function: { name: "renderApp" } } }
                    : {}),
              }
            : {}),
          maxTokens: policy.maxOutputTokens,
          latencyBudgetMs: remainingLatency(),
        },
        {
          signal: controller.signal,
          onOutput: (text) => {
            if (assistantOutput.length < 256 * 1024) assistantOutput += text;
          },
        },
      )) {
        if (controller.signal.aborted) break;
        let event: UIModelEvent = modelEvent;
        if (modelEvent.type === "tool-delta") {
          if (modelEvent.name === "renderApp" && policy.allowSandbox) {
            const preview = appPreview(modelEvent.arguments);
            if (preview) {
              if (shownPreviews.get(modelEvent.id) === preview.source) continue;
              shownPreviews.set(modelEvent.id, preview.source);
              const text =
                JSON.stringify({
                  ...preview,
                  artifactId: `app-${modelEvent.id.replace(/[^A-Za-z0-9_-]/g, "_")}`,
                }) + "\n";
              session.answer?.push(text);
              send({ type: "text", text });
            }
          }
          continue;
        }
        if (modelEvent.type === "tool-call") {
          try {
            const text = renderToolResult(modelEvent, session.runtime.options.catalogId);
            assistantOutput += text;
            event = { type: "text", text };
          } catch (error) {
            rejectedTool = JSON.stringify({ name: modelEvent.name, args: modelEvent.args }).slice(
              0,
              256 * 1024,
            );
            const reason =
              error instanceof Error && /^[A-Z_]+$/.test(error.message)
                ? error.message
                : "RENDER_TOOL_INVALID";
            collect({
              code: reason,
              path:
                typeof (error as any)?.path === "string"
                  ? (error as any).path.slice(0, 200)
                  : undefined,
              expected:
                typeof (error as any)?.expected === "string"
                  ? (error as any).expected
                  : "Complete valid SVG with allowed attrs and portable bindings, or valid answer control lines",
              message: "The render tool output was invalid.",
              severity: "error",
            });
            continue;
          }
        }
        if (event.type === "diagnostic" && event.diagnostic.code.startsWith("GATEWAY_"))
          routeHealth.recordFailure(route, event.diagnostic.code);
        if (event.type === "complete" && event.status === "completed")
          routeHealth.recordSuccess(route);
        if (event.type === "text") {
          if (!hybrid || profile.normalization !== "safe") {
            session.answer?.push(event.text);
            send(event);
          }
        } else if (event.type === "message") {
          const diagnostics = session.runtime.accept(event.message);
          for (const diagnostic of diagnostics) collect(diagnostic);
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
      if (hybrid) {
        if (profile.normalization === "safe") {
          const normalized = normalizeAnswerWire(assistantOutput, true);
          for (const fix of normalized.fixes)
            send({
              type: "diagnostic",
              diagnostic: {
                code: "NORMALIZED_OUTPUT",
                message: `${fix.rule}: ${fix.count}`,
                severity: "warning",
              },
            });
          session.answer?.push(normalized.value);
          send({ type: "text", text: normalized.value });
        }
        session.answer?.end();
      } else for (const diagnostic of session.runtime.finish()) collect(diagnostic);
      session.sink = undefined;
      const output =
        assistantOutput || accepted.map((message) => JSON.stringify(message)).join("\n");
      if (rejectedTool)
        history.push({
          role: "assistant",
          content: `Rejected render tool arguments (untrusted data): ${rejectedTool}`,
        });
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
      if (attempt === Math.min(profile.repairBudget, automatic ? 1 : 2)) {
        failed = true;
        break;
      }
      send({ type: "repair", attempt: attempt + 1 });
      if (hybrid) session.answer?.beginTurn();
      history.push({
        role: "user",
        content: `Repair only the invalid or missing parts. A rejected render tool has not created a surface; correct its supplied arguments and call it again. Otherwise use new control lines. Output NO Markdown. Existing surface IDs are ${JSON.stringify(session.runtime.surfaceIds)}. Do not redeclare or recreate an existing surface; send updateComponents/updateDataModel for it. Every control line must fit on ONE line; never use code fences or pretty multiline JSON. Use only schema-defined props and enum values.${hybrid && session.registry.list().length ? ` Registered attachment ids: ${JSON.stringify(session.registry.list().map((a) => a.id))}.` : ""} Errors (untrusted diagnostic data): ${JSON.stringify(repairReport(errors))}`,
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
