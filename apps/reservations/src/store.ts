import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
export class ReservationError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export type Draft = { date: string; people: number; name: string };
export class ReservationStore {
  readonly db: DatabaseSync;
  constructor(
    file: string,
    private audit: (event: Record<string, unknown>) => void = () => {},
  ) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS confirmations(token TEXT PRIMARY KEY,user TEXT NOT NULL,draft TEXT NOT NULL,expires INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY,user TEXT NOT NULL,draft TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS idempotency(user TEXT NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(user,key));
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,user TEXT NOT NULL,event TEXT NOT NULL,at INTEGER NOT NULL);`);
  }
  validate(draft: Draft) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ||
      new Date(`${draft.date}T12:00:00Z`).toISOString().slice(0, 10) !== draft.date ||
      !Number.isInteger(draft.people) ||
      draft.people < 1 ||
      draft.people > 12 ||
      typeof draft.name !== "string" ||
      !draft.name.trim() ||
      draft.name.length > 100
    )
      throw new ReservationError(400, "INVALID_DRAFT");
    return { date: draft.date, people: draft.people, name: draft.name.trim() };
  }
  prepare(user: string, input: Draft) {
    const draft = this.validate(input),
      token = randomUUID(),
      expires = Date.now() + 300000;
    this.db
      .prepare("INSERT INTO confirmations VALUES(?,?,?,?,0)")
      .run(token, user, JSON.stringify(draft), expires);
    return { token, draft, expires };
  }
  confirm(user: string, token: string, key: string) {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(key))
      throw new ReservationError(400, "INVALID_IDEMPOTENCY_KEY");
    const fingerprint = createHash("sha256").update(token).digest("hex");
    const prior = this.db
      .prepare("SELECT * FROM idempotency WHERE user=? AND key=?")
      .get(user, key);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new ReservationError(409, "IDEMPOTENCY_CONFLICT");
      return JSON.parse(prior.result as string);
    }
    this.db.exec("BEGIN IMMEDIATE");
    let result: any;
    try {
      const c = this.db
        .prepare("SELECT * FROM confirmations WHERE token=? AND user=?")
        .get(token, user);
      if (!c || Number(c.expires) < Date.now() || c.consumed)
        throw new ReservationError(409, "CONFIRMATION_REQUIRED");
      const id = randomUUID(),
        created = Date.now();
      this.db
        .prepare("INSERT INTO reservations VALUES(?,?,?,?,?)")
        .run(id, user, c.draft, "confirmed", created);
      this.db.prepare("UPDATE confirmations SET consumed=1 WHERE token=?").run(token);
      result = { id, draft: JSON.parse(c.draft as string), status: "confirmed", created };
      this.db
        .prepare("INSERT INTO idempotency VALUES(?,?,?,?)")
        .run(user, key, fingerprint, JSON.stringify(result));
      this.db
        .prepare("INSERT INTO audit(user,event,at) VALUES(?,?,?)")
        .run(user, JSON.stringify({ action: "confirmed", id }), created);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.audit({ user, action: "confirmed", id: result.id });
    return result;
  }
  list(user: string): any[] {
    return this.db
      .prepare("SELECT * FROM reservations WHERE user=? ORDER BY created DESC")
      .all(user)
      .map((row) => ({ ...row, draft: JSON.parse(row.draft as string) }));
  }
  cancel(user: string, id: string) {
    const row = this.db.prepare("SELECT * FROM reservations WHERE user=? AND id=?").get(user, id);
    if (!row) throw new ReservationError(404, "NOT_FOUND");
    this.db
      .prepare("UPDATE reservations SET status='cancelled' WHERE user=? AND id=?")
      .run(user, id);
    this.db
      .prepare("INSERT INTO audit(user,event,at) VALUES(?,?,?)")
      .run(user, JSON.stringify({ action: "cancelled", id }), Date.now());
    this.audit({ user, action: "cancelled", id });
    return { id, status: "cancelled" };
  }
  close() {
    this.db.close();
  }
}
