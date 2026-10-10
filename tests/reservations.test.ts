import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createReservationServer } from "../apps/reservations/src/server.js";
import { ReservationStore } from "../apps/reservations/src/store.js";

describe("server-owned reservation confirmation", () => {
  it("persists, scopes idempotency and confirmation to the user, and audits only committed work", () => {
    const dir = mkdtempSync(join(tmpdir(), "engine-reservation-")),
      file = join(dir, "db.sqlite"),
      audit: any[] = [];
    let store = new ReservationStore(file, (event) => audit.push(event));
    const input = { date: "2026-12-01", people: 2, name: "민지" },
      c = store.prepare("alice", input);
    expect(() => store.confirm("bob", c.token, "request_123")).toThrow("CONFIRMATION_REQUIRED");
    const saved = store.confirm("alice", c.token, "request_123");
    expect(store.confirm("alice", c.token, "request_123")).toEqual(saved);
    expect(audit).toHaveLength(1);
    expect(() =>
      store.confirm("alice", store.prepare("alice", input).token, "request_123"),
    ).toThrow("IDEMPOTENCY_CONFLICT");
    expect(() => store.confirm("alice", "true", "request_456")).toThrow("CONFIRMATION_REQUIRED");
    store.close();
    store = new ReservationStore(file);
    expect(store.list("alice")).toHaveLength(1);
    expect(store.list("bob")).toHaveLength(0);
    store.cancel("alice", saved.id);
    expect(store.list("alice")[0]!.status).toBe("cancelled");
    store.close();
    rmSync(dir, { recursive: true });
  });
  it("rejects invalid dates, numbers and expired confirmations", () => {
    const s = new ReservationStore(":memory:");
    expect(() => s.prepare("u", { date: "2026-02-31", people: 2, name: "a" })).toThrow();
    expect(() => s.prepare("u", { date: "2026-12-01", people: 99, name: "a" })).toThrow();
    const c = s.prepare("u", { date: "2026-12-01", people: 2, name: "a" });
    s.db.prepare("UPDATE confirmations SET expires=0").run();
    expect(() => s.confirm("u", c.token, "request_123")).toThrow("CONFIRMATION_REQUIRED");
    s.close();
  });
  it("requires host auth/CSRF and recovers from 5xx, timeouts and duplicate submit", async () => {
    const { server } = createReservationServer({ faults: true });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const url = `http://127.0.0.1:${(server.address() as any).port}`;
      expect((await fetch(`${url}/reservations`)).status).toBe(401);
      const login = await fetch(`${url}/session`, {
        method: "POST",
        body: JSON.stringify({ user: "alice", password: "local-preview" }),
      });
      const session = await login.json();
      const headers: Record<string, string> = {
        cookie: login.headers.get("set-cookie")!.split(";")[0]!,
        "x-csrf-token": session.csrf,
      };
      expect(
        (
          await fetch(`${url}/prepare`, {
            method: "POST",
            headers: { cookie: headers.cookie! },
            body: "{}",
          })
        ).status,
      ).toBe(403);
      const body = JSON.stringify({ date: "2026-12-01", people: 2, name: "Alice" });
      expect(
        (
          await fetch(`${url}/prepare`, {
            method: "POST",
            headers: { ...headers, "x-test-fault": "500" },
            body,
          })
        ).status,
      ).toBe(500);
      await expect(
        fetch(`${url}/prepare`, {
          method: "POST",
          headers: { ...headers, "x-test-fault": "timeout" },
          body,
          signal: AbortSignal.timeout(50),
        }),
      ).rejects.toThrow();
      const c = await (await fetch(`${url}/prepare`, { method: "POST", headers, body })).json();
      const confirm = () =>
        fetch(`${url}/confirm`, {
          method: "POST",
          headers: { ...headers, "idempotency-key": "request_123" },
          body: JSON.stringify({ token: c.token }),
        }).then((r) => r.json());
      expect(await confirm()).toEqual(await confirm());
      expect(
        (await (await fetch(`${url}/reservations`, { headers })).json()).reservations,
      ).toHaveLength(1);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 10000);
});
