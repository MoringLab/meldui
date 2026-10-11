import { assertSafeJson, resolvePath } from "./expression.js";
export type HostTool = {
  description: string;
  input: { parse(value: unknown): any };
  output?: { parse(value: unknown): any };
  requiresConfirmation?: boolean;
  handler(args: any, context: { signal?: AbortSignal }): unknown | Promise<unknown>;
};
export type HostBridgeOptions = {
  tools?: Record<string, HostTool>;
  state?: Record<string, unknown>;
  readable?: string[];
  writable?: string[];
  confirm?: (name: string, args: unknown, signal?: AbortSignal) => Promise<boolean>;
  audit?: (event: { name: string; status: "pending" | "complete" | "rejected" | "error" }) => void;
};
/** Only named tools and explicitly exposed state cross the host boundary. */
export class HostBridge {
  private state: Record<string, unknown>;
  private listeners = new Set<() => void>();
  private active = 0;
  private closed = false;
  constructor(readonly options: HostBridgeOptions = {}) {
    assertSafeJson(options.state ?? {});
    this.state = structuredClone(options.state ?? {});
    for (const name of Object.keys(options.tools ?? {}))
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) throw Error("HOST_TOOL_NAME");
  }
  private key(path: string, allowed: string[]) {
    const key = resolvePath(path);
    if (!allowed.includes(key)) throw Error("HOST_STATE_DENIED");
    return key;
  }
  read(path: string) {
    return structuredClone(this.state[this.key(path, this.options.readable ?? [])]);
  }
  write(path: string, value: unknown) {
    if (this.closed) throw Error("HOST_BRIDGE_CLOSED");
    assertSafeJson(value);
    if (JSON.stringify(value)?.length > 65536) throw Error("HOST_STATE_LIMIT");
    this.state[this.key(path, this.options.writable ?? [])] = structuredClone(value);
    for (const listener of this.listeners) listener();
  }
  context() {
    return Object.fromEntries((this.options.readable ?? []).map((p) => [p, this.read(p)]));
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  async call(name: string, raw: unknown, signal?: AbortSignal) {
    if (this.closed || signal?.aborted) throw Error("HOST_BRIDGE_CLOSED");
    const tool = Object.hasOwn(this.options.tools ?? {}, name)
      ? this.options.tools![name]
      : undefined;
    if (!tool) throw Error("HOST_TOOL_DENIED");
    if (this.active >= 8) throw Error("HOST_TOOL_CONCURRENCY");
    assertSafeJson(raw);
    if (JSON.stringify(raw)?.length > 65536) throw Error("HOST_TOOL_LIMIT");
    const args = tool.input.parse(raw);
    this.active++;
    this.options.audit?.({ name, status: "pending" });
    let rejected = false;
    try {
      if (tool.requiresConfirmation && !(await this.options.confirm?.(name, args, signal))) {
        rejected = true;
        this.options.audit?.({ name, status: "rejected" });
        throw Error("HOST_CONFIRMATION_REQUIRED");
      }
      if (this.closed || signal?.aborted) throw Error("HOST_BRIDGE_CLOSED");
      const value = await tool.handler(args, { signal });
      if (this.closed || signal?.aborted) throw Error("HOST_BRIDGE_CLOSED");
      assertSafeJson(value);
      if (JSON.stringify(value)?.length > 65536) throw Error("HOST_RESULT_LIMIT");
      const result = tool.output ? tool.output.parse(value) : value;
      this.options.audit?.({ name, status: "complete" });
      return structuredClone(result);
    } catch (error) {
      if (!rejected) this.options.audit?.({ name, status: "error" });
      throw error;
    } finally {
      this.active--;
    }
  }
  dispose() {
    this.closed = true;
    this.listeners.clear();
  }
}
