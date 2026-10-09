import type { ModelRequest, UIModelAdapter, UIModelEvent } from "@engine/core";
import type { UIMessage } from "@engine/protocol";

/** Deterministic model substitute for examples, offline CI and host integration. */
export class ReplayAdapter implements UIModelAdapter {
  constructor(
    readonly messages: readonly UIMessage[],
    readonly delayMs = 0,
  ) {}
  async *stream(
    _request: ModelRequest,
    { signal }: { signal?: AbortSignal } = {},
  ): AsyncIterable<UIModelEvent> {
    for (const message of this.messages) {
      if (signal?.aborted) {
        yield { type: "complete", status: "cancelled" };
        return;
      }
      if (this.delayMs)
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, this.delayMs);
          signal?.addEventListener("abort", done, { once: true });
        });
      if (signal?.aborted) break;
      yield { type: "message", message };
    }
    yield { type: "complete", status: signal?.aborted ? "cancelled" : "completed" };
  }
}
