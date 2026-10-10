import type { Diagnostic } from "@engine/protocol";

/** UTF-8/NDJSON decoder that never guesses incomplete JSON. */
export class NDJSONDecoder {
  private decoder = new TextDecoder("utf-8", { fatal: true });
  private buffer = "";
  private bytes = 0;
  constructor(
    private report: (diagnostic: Diagnostic) => void = () => {},
    private maxLineBytes = 256 * 1024,
    private maxBytes = 8 * 1024 * 1024,
  ) {}
  push(chunk: Uint8Array | string): unknown[] {
    this.bytes +=
      typeof chunk === "string" ? new TextEncoder().encode(chunk).length : chunk.byteLength;
    if (this.bytes > this.maxBytes) throw new Error("STREAM_LIMIT");
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    const result: unknown[] = [];
    let boundary = this.buffer.indexOf("\n");
    while (boundary !== -1) {
      this.parse(this.buffer.slice(0, boundary), result);
      this.buffer = this.buffer.slice(boundary + 1);
      boundary = this.buffer.indexOf("\n");
    }
    if (new TextEncoder().encode(this.buffer).length > this.maxLineBytes)
      throw new Error("MESSAGE_LIMIT");
    return result;
  }
  finish(): unknown[] {
    this.buffer += this.decoder.decode();
    const result: unknown[] = [];
    this.parse(this.buffer, result);
    this.buffer = "";
    return result;
  }
  private parse(line: string, result: unknown[]) {
    if (!line.trim()) return;
    if (new TextEncoder().encode(line).length > this.maxLineBytes) throw new Error("MESSAGE_LIMIT");
    try {
      result.push(JSON.parse(line));
    } catch {
      this.report({
        code: "INVALID_JSON",
        message: "Expected one complete JSON object per line.",
        severity: "error",
      });
    }
  }
}

/** Consume web byte streams without buffering the response or leaking its reader. */
export async function* readBytes(stream: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const reader = stream.getReader();
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
