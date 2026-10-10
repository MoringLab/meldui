/** Failure classes that describe the route, not the quality of the model output. */
export const INFRA_CODES =
  /^(GATEWAY_|HTTP_(401|403|408|429|5\d\d)|ROUTE_UNAVAILABLE|ERROR$|TimeoutError)/;

export function isInfraFailure(code: string) {
  return INFRA_CODES.test(code);
}

export type RouteState = {
  model: string;
  status: "unknown" | "available" | "unavailable";
  consecutiveFailures: number;
  retryAt?: number;
  lastCode?: string;
  checkedAt?: number;
};

/**
 * Tracks per-route availability with bounded exponential backoff, so a rate-limited
 * route is reported as unavailable instead of producing a silent 0/N result.
 */
export class RouteHealth {
  private routes = new Map<string, RouteState>();
  constructor(private options: { baseMs?: number; maxMs?: number; now?: () => number } = {}) {}
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  state(model: string): RouteState {
    return this.routes.get(model) ?? { model, status: "unknown", consecutiveFailures: 0 };
  }
  /** False while the route is inside its backoff window. */
  canAttempt(model: string) {
    const s = this.state(model);
    return s.status !== "unavailable" || (s.retryAt ?? 0) <= this.now();
  }
  recordSuccess(model: string) {
    this.routes.set(model, {
      model,
      status: "available",
      consecutiveFailures: 0,
      checkedAt: this.now(),
    });
  }
  recordFailure(model: string, code: string) {
    if (!isInfraFailure(code)) return;
    const previous = this.state(model);
    const failures = Math.min(previous.consecutiveFailures + 1, 6);
    const delay = Math.min(
      (this.options.baseMs ?? 5_000) * 2 ** (failures - 1),
      this.options.maxMs ?? 120_000,
    );
    this.routes.set(model, {
      model,
      status: "unavailable",
      consecutiveFailures: failures,
      retryAt: this.now() + delay,
      lastCode: code,
      checkedAt: this.now(),
    });
  }
  snapshot() {
    return [...this.routes.values()];
  }
}

/** Cheap non-streaming probe through the same gateway the adapter uses. */
export async function probeRoute(
  options: { baseUrl: string; apiKey: string; fetch?: typeof fetch; timeoutMs?: number },
  model: string,
): Promise<{ model: string; ok: boolean; code?: string; latencyMs: number; actualModel?: string }> {
  const start = performance.now();
  try {
    const response = await (options.fetch ?? fetch)(
      `${options.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          "X-OmniRoute-No-Cache": "true",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Reply with: ok" }],
          max_tokens: 8,
          stream: false,
        }),
      },
    );
    const latencyMs = performance.now() - start;
    if (!response.ok)
      return { model, ok: false, code: `GATEWAY_HTTP_${response.status}`, latencyMs };
    return {
      model,
      ok: true,
      latencyMs,
      actualModel: response.headers.get("x-omniroute-model") ?? undefined,
    };
  } catch {
    return { model, ok: false, code: "GATEWAY_ERROR", latencyMs: performance.now() - start };
  }
}
