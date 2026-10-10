import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { ReservationError, ReservationStore } from "./store.js";
/** Separate business service. Demo password belongs to the host, never to the model. */
export function createReservationServer({
  file = ":memory:",
  password = "local-preview",
  faults = false,
}: {
  file?: string;
  password?: string;
  faults?: boolean;
} = {}) {
  const store = new ReservationStore(file);
  const sessions = new Map<string, { user: string; csrf: string; expires: number }>();
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    const send = (status: number, value: unknown) => {
      res.writeHead(status);
      res.end(JSON.stringify(value));
    };
    try {
      if (req.url === "/health") return send(200, { ok: true, service: "reservations" });
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 8192) throw new ReservationError(413, "BODY_LIMIT");
        chunks.push(chunk);
      }
      const input = bytes ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      if (req.url === "/session" && req.method === "POST") {
        const a = Buffer.from(String(input.password ?? "")),
          b = Buffer.from(password);
        if (
          a.length !== b.length ||
          !timingSafeEqual(a, b) ||
          !["alice", "bob"].includes(input.user)
        )
          throw new ReservationError(401, "AUTH_REQUIRED");
        if (sessions.size >= 1000) throw new ReservationError(429, "SESSION_LIMIT");
        const token = randomUUID(),
          csrf = randomUUID();
        sessions.set(token, { user: input.user, csrf, expires: Date.now() + 600000 });
        res.setHeader(
          "Set-Cookie",
          `engine_reservation=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=600`,
        );
        return send(200, { user: input.user, csrf });
      }
      const token = String(req.headers.cookie ?? "").match(
        /(?:^|;\s*)engine_reservation=([^;]+)/,
      )?.[1];
      const session = token ? sessions.get(token) : undefined;
      if (!session || session.expires < Date.now())
        throw new ReservationError(401, "AUTH_REQUIRED");
      if (req.method !== "GET") {
        if (req.headers["x-csrf-token"] !== session.csrf)
          throw new ReservationError(403, "CSRF_REQUIRED");
        const origin = req.headers.origin;
        if (
          origin &&
          !["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:8788"].includes(
            origin,
          )
        )
          throw new ReservationError(403, "ORIGIN_BLOCKED");
      }
      if (faults) {
        const fault = req.headers["x-test-fault"];
        if (fault === "500") throw new ReservationError(500, "INJECTED_FAILURE");
        if (fault === "timeout") await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (req.url === "/reservations" && req.method === "GET")
        return send(200, { reservations: store.list(session.user) });
      if (req.url === "/prepare" && req.method === "POST")
        return send(200, store.prepare(session.user, input));
      if (req.url === "/confirm" && req.method === "POST")
        return send(
          200,
          store.confirm(session.user, input.token, String(req.headers["idempotency-key"] ?? "")),
        );
      if (req.url?.startsWith("/reservations/") && req.method === "DELETE")
        return send(200, store.cancel(session.user, req.url.slice("/reservations/".length)));
      throw new ReservationError(404, "NOT_FOUND");
    } catch (error) {
      send(error instanceof ReservationError ? error.status : 400, {
        error: error instanceof ReservationError ? error.code : "INVALID_REQUEST",
      });
    }
  });
  server.on("close", () => store.close());
  return { server, store };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync("artifacts/reservations", { recursive: true });
  const { server } = createReservationServer({
    file: process.env.RESERVATION_DB ?? "artifacts/reservations/data.sqlite",
    password: process.env.RESERVATION_DEMO_PASSWORD ?? "local-preview",
    faults: process.env.RESERVATION_FAULTS === "1",
  });
  server.listen(8788, "127.0.0.1", () =>
    process.stdout.write("Reservation service on http://127.0.0.1:8788\n"),
  );
}
