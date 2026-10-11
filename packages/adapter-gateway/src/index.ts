import {
  assertSafeJson,
  type ModelRequest,
  NDJSONDecoder,
  readBytes,
  type UIModelAdapter,
  type UIModelEvent,
} from "@engine/core";
import { type Diagnostic, MessageSchema } from "@engine/protocol";
import { normalizeMessage } from "./quality.js";

export type GatewayOptions = {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/** OpenAI-compatible streaming adapter; credentials belong in a server process. */
export class GatewayAdapter implements UIModelAdapter {
  constructor(private options: GatewayOptions) {}
  async *stream(
    request: ModelRequest,
    { signal, onOutput }: { signal?: AbortSignal; onOutput?: (text: string) => void } = {},
  ): AsyncIterable<UIModelEvent> {
    const pending: Diagnostic[] = [];
    const decoder = new NDJSONDecoder((diagnostic) => pending.push(diagnostic));
    const timeout = AbortSignal.timeout(
      Math.max(1, Math.min(this.options.timeoutMs ?? 120_000, request.latencyBudgetMs ?? 120_000)),
    );
    const activeSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await (this.options.fetch ?? fetch)(
        `${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          signal: activeSignal,
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "X-OmniRoute-No-Cache": "true",
          },
          body: JSON.stringify({
            model: request.model,
            ...(request.responseFormat ? { response_format: request.responseFormat } : {}),
            messages: request.messages,
            stream: true,
            ...(request.tools?.length
              ? {
                  tools: request.tools,
                  tool_choice: request.toolChoice ?? "auto",
                  parallel_tool_calls: false,
                }
              : {}),
            max_tokens: request.maxTokens ?? 4096,
          }),
        },
      );
      if (!response.ok) throw new Error(`GATEWAY_HTTP_${response.status}`);
      if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream"))
        throw new Error("GATEWAY_NOT_STREAMING");
      const textDecoder = new TextDecoder();
      let buffer = "";
      const tools = new Map<number, { id: string; name: string; json: string }>();
      let finish: string | undefined;
      let done = false;
      let bytes = 0;
      const reportModel = response.headers.get("x-omniroute-model") ?? undefined;
      if (reportModel) yield { type: "usage", model: reportModel };
      for await (const bytesChunk of readBytes(response.body, activeSignal)) {
        bytes += bytesChunk.byteLength;
        if (bytes > 16 * 1024 * 1024) throw new Error("GATEWAY_STREAM_LIMIT");
        buffer += textDecoder.decode(bytesChunk, { stream: true });
        let index = buffer.indexOf("\n");
        while (index !== -1) {
          const line = buffer.slice(0, index).trimEnd();
          buffer = buffer.slice(index + 1);
          if (line.startsWith("data:")) {
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") {
              done = true;
              break;
            }
            if (payload) {
              const chunk = JSON.parse(payload);
              if (chunk.error) throw new Error("GATEWAY_STREAM_ERROR");
              if (chunk.usage)
                yield {
                  type: "usage",
                  inputTokens: chunk.usage.prompt_tokens,
                  outputTokens: chunk.usage.completion_tokens,
                  model: reportModel ?? chunk.model,
                };
              for (const choice of chunk.choices ?? []) {
                if (choice.finish_reason) finish = choice.finish_reason;
                for (const part of choice.delta?.tool_calls ?? []) {
                  if (!Number.isInteger(part.index) || part.index < 0 || part.index >= 8)
                    throw Error("GATEWAY_TOOL_LIMIT");
                  const tool = tools.get(part.index) ?? { id: "", name: "", json: "" };
                  tool.id += part.id ?? "";
                  tool.name += part.function?.name ?? "";
                  tool.json += part.function?.arguments ?? "";
                  if (tool.json.length > 131072 || tool.name.length > 64 || tool.id.length > 128)
                    throw Error("GATEWAY_TOOL_LIMIT");
                  tools.set(part.index, tool);
                  if (tool.id && tool.name)
                    yield {
                      type: "tool-delta",
                      id: tool.id,
                      name: tool.name,
                      arguments: tool.json,
                    };
                }
                const content = choice.delta?.content;
                if (typeof content === "string") onOutput?.(content);
                if (typeof content === "string" && request.format === "hybrid")
                  yield { type: "text", text: content };
                else if (typeof content === "string")
                  for (const message of decoder.push(content)) {
                    const normalized = normalizeMessage(message, request.normalization === "safe");
                    for (const fix of normalized.fixes)
                      pending.push({
                        code: "NORMALIZED_OUTPUT",
                        message: fix.rule,
                        path: fix.path,
                        severity: "warning",
                      });
                    const result = MessageSchema.safeParse(normalized.value);
                    if (result.success) yield { type: "message", message: result.data };
                    else
                      pending.push({
                        code: "INVALID_ENVELOPE",
                        message: "Output must match an A2UI v0.9 envelope.",
                        severity: "error",
                      });
                  }
              }
              while (pending.length) yield { type: "diagnostic", diagnostic: pending.shift()! };
            }
          }
          index = buffer.indexOf("\n");
        }
        if (done) break;
        if (buffer.length > 1024 * 1024) throw new Error("GATEWAY_EVENT_LIMIT");
      }
      if (!activeSignal.aborted) {
        if (tools.size && finish !== "tool_calls") throw Error("GATEWAY_TOOL_INCOMPLETE");
        for (const tool of tools.values()) {
          if (!tool.id || !request.tools?.some((t) => t.function.name === tool.name))
            throw Error("GATEWAY_TOOL_UNKNOWN");
          const args = JSON.parse(tool.json);
          assertSafeJson(args);
          if (!args || typeof args !== "object" || Array.isArray(args))
            throw Error("GATEWAY_TOOL_ARGUMENTS");
          yield { type: "tool-call", id: tool.id, name: tool.name, args };
        }
        for (const message of request.format === "hybrid" ? [] : decoder.finish()) {
          const normalized = normalizeMessage(message, request.normalization === "safe");
          for (const fix of normalized.fixes)
            pending.push({
              code: "NORMALIZED_OUTPUT",
              message: fix.rule,
              path: fix.path,
              severity: "warning",
            });
          const result = MessageSchema.safeParse(normalized.value);
          if (result.success) yield { type: "message", message: result.data };
          else
            pending.push({
              code: "INVALID_ENVELOPE",
              message: "The final envelope was invalid.",
              severity: "error",
            });
        }
        if (!done || finish === "length")
          pending.push({
            code: "INCOMPLETE_OUTPUT",
            message: "Generation ended before a complete response.",
            severity: "error",
          });
        while (pending.length) yield { type: "diagnostic", diagnostic: pending.shift()! };
      }
      yield { type: "complete", status: activeSignal.aborted ? "cancelled" : "completed" };
    } catch (error) {
      if (signal?.aborted) {
        yield { type: "complete", status: "cancelled" };
        return;
      }
      yield {
        type: "diagnostic",
        diagnostic: {
          code: timeout.aborted
            ? "GATEWAY_TIMEOUT"
            : error instanceof Error && /^GATEWAY_|LIMIT$/.test(error.message)
              ? error.message
              : "GATEWAY_ERROR",
          message:
            "The model stream could not complete. Retry the request or select another configured model.",
          severity: "error",
        },
      };
      yield { type: "complete", status: "failed" };
    }
  }
}

export * from "./examples.js";
export * from "./health.js";
export * from "./presentation.js";
export * from "./prompt.js";
export * from "./quality.js";
export * from "./vision.js";
