import { mkdir, writeFile } from "node:fs/promises";
import fixtures from "../../fixtures/cases.json";
import { AnswerSession, createUIRuntime } from "../../packages/core/src/index.js";
import { classifyRow } from "../lib/taxonomy.js";
import { readJson, split } from "./common.js";

/**
 * Online evaluation through the local server and OmniRoute. Requires --live.
 *   pnpm eval:online --live [--set original|routing|multiturn|showcase] [--models a,b] [--split dev|heldout|all]
 *                    [--kits neutral,editorial] [--out artifacts/eval/online-latest.json] [--limit N]
 * Every requested job produces a row, including jobs on unavailable routes (kept in the denominator).
 */
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!flag("live")) {
  console.error("Refusing to call models without --live. Offline checks: pnpm eval");
  process.exit(2);
}
const base = process.env.ENGINE_SERVER_URL ?? "http://127.0.0.1:8787";
const setName = opt("set", "original")!;
const which = opt("split", "all")!;
const kits = opt("kits", "neutral")!.split(",");
const out = opt("out", "artifacts/eval/online-latest.json")!;
const format = opt("format", "a2ui") as "a2ui" | "hybrid";
const policy = JSON.parse(opt("policy", "{}")!);
const attachmentSets = readJson<Record<string, unknown[]>>("eval/attachments.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Job = {
  id: string;
  set: string;
  prompt: string;
  split?: "dev" | "heldout";
  extra?: Record<string, unknown>;
};
const jobsFor = (): Job[] => {
  if (setName === "original")
    return fixtures.map((f) => ({
      id: f.id,
      set: "original",
      prompt: f.prompt,
      split: split("original", f.id),
    }));
  const items = readJson<any[]>(`eval/${setName === "showcase" ? "showcase" : setName}.json`);
  if (setName === "showcase")
    return items.flatMap((i) =>
      (["ko", "en"] as const).map((lang) => ({
        id: `${i.id}:${lang}`,
        set: "showcase",
        prompt: i.prompts[lang],
        split: split("showcase", i.id),
        extra: { path: i.path },
      })),
    );
  if (setName === "multiturn")
    return items.map((i) => ({
      id: i.id,
      set: "multiturn",
      prompt: i.turns[0].prompt,
      split: split("multiturn", i.id),
      extra: { base: i.base },
    }));
  return items.map((i) => ({
    id: i.id,
    set: setName,
    prompt: i.prompt,
    split: split(setName, i.id),
    extra: { expect: i.expect, attachments: i.attachments },
  }));
};
const wanted = jobsFor()
  .filter((j) => which === "all" || j.split === which)
  .filter((j) => !opt("ids") || opt("ids")!.split(",").includes(j.id))
  .slice(0, Number(opt("limit", "1000")));

const health = (await fetch(`${base}/api/routes/health?probe=1`).then((r) => r.json())) as {
  routes: { model: string; status: string; lastCode?: string }[];
};
const { models: served } = (await fetch(`${base}/api/models`).then((r) => r.json())) as {
  models: string[];
};
const models = opt("models")?.split(",") ?? served;
const infraCounts = new Map<string, number>();
const unavailable = new Map(
  health.routes
    .filter((r) => r.status === "unavailable")
    .map((r) => [r.model, r.lastCode ?? "ROUTE_UNAVAILABLE"]),
);
console.log(
  `Routes: ${models.map((m) => `${m}=${unavailable.has(m) ? `UNAVAILABLE(${unavailable.get(m)})` : "ok"}`).join(", ")}`,
);

const queue = models.flatMap((model) =>
  kits.flatMap((kitId) => wanted.map((job) => ({ model, kitId, job }))),
);
const rows: any[] = [];
let cursor = 0;
async function persist() {
  await mkdir("artifacts/eval", { recursive: true });
  await writeFile(
    out,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        set: setName,
        split: which,
        scope:
          "Structural validity and resolvable expressions; semantic quality is scored by the separate layers.",
        routes: health.routes,
        results: rows,
      },
      null,
      1,
    ),
  );
}
async function one({ model, kitId, job }: (typeof queue)[number]) {
  const base_ = { id: job.id, set: job.set, split: job.split, model, kitId };
  if (unavailable.has(model)) {
    rows.push({
      ...base_,
      actualModel: null,
      initialValid: false,
      valid: false,
      status: "unavailable",
      repairs: 0,
      errors: [unavailable.get(model)],
      finalErrors: [],
      infra: true,
    });
    return;
  }
  const runtime = createUIRuntime();
  if (job.extra?.attachments)
    for (const record of attachmentSets[String(job.extra.attachments)] ?? [])
      runtime.attachments.attach(record as any);
  const answer =
    format === "hybrid"
      ? new AnswerSession(runtime, { policy, attachments: runtime.attachments })
      : undefined;
  const start = performance.now();
  let waitedMs = 0;
  let sessionId = "";
  let firstMessageMs: number | undefined;
  let repairs = 0;
  let status = "failed";
  let outputBytes = 0;
  let recordedWire = "";
  let actualModel: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let markdownChars = 0;
  let messageCount = 0;
  let initialValid = true;
  const errors: string[] = [];
  try {
    const attachments = job.extra?.attachments
      ? attachmentSets[String(job.extra.attachments)]
      : undefined;
    let response: Response | undefined;
    // Availability backoff only (never schema repair): wait out a short route cooldown, then record infra.
    for (let attempt = 0; attempt < (flag("no-backoff") ? 1 : 4); attempt++) {
      response = await fetch(`${base}/api/ui`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          kitId,
          prompt: job.prompt,
          platform: "web",
          format,
          policy,
          ...(attachments ? { attachments, visibility: { text: true } } : {}),
        }),
        signal: AbortSignal.timeout(360_000),
      });
      if (response.status !== 503) break;
      const body = await response
        .clone()
        .json()
        .catch(() => ({}));
      if (body.error !== "ROUTE_UNAVAILABLE" || attempt === 3) break;
      const wait = Math.min(
        Math.max((body.route?.retryAt ?? Date.now() + 5000) - Date.now(), 1000),
        60_000,
      );
      waitedMs += wait;
      await sleep(wait);
    }
    if (!response?.ok) {
      const body = await response?.json().catch(() => ({}));
      throw Error(
        body?.error === "ROUTE_UNAVAILABLE" ? "ROUTE_UNAVAILABLE" : `HTTP_${response?.status}`,
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error("NO_BODY");
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      outputBytes += value.byteLength;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "session") sessionId = event.sessionId;
        else if (event.type === "message") {
          firstMessageMs ??= performance.now() - start;
          messageCount++;
          runtime.accept(event.message);
        } else if (event.type === "text") {
          firstMessageMs ??= performance.now() - start;
          answer?.push(event.text);
          if (flag("record-wire")) recordedWire += event.text;
        } else if (event.type === "diagnostic") {
          errors.push(event.diagnostic.code);
          if (!repairs && event.diagnostic.severity === "error") initialValid = false;
        } else if (event.type === "repair") {
          repairs = event.attempt;
          answer?.beginTurn();
        } else if (event.type === "usage") {
          actualModel = event.model ?? actualModel;
          inputTokens = event.inputTokens ?? inputTokens;
          outputTokens = event.outputTokens ?? outputTokens;
        } else if (event.type === "complete") status = event.status;
      }
    }
    if (answer) answer.end();
    else runtime.finish();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "ERROR");
    initialValid = false;
  }
  const finalErrors = runtime.surfaceIds.flatMap((sid) =>
    [...runtime.getSurface(sid)!.componentsModel.values]
      .map((n) => runtime.getNodeSnapshot(sid, n.id).error)
      .filter(Boolean),
  );
  const surfaces = runtime.surfaceIds.length;
  const blocks = answer?.blocks.map((b) => b.kind) ?? [];
  markdownChars =
    answer?.blocks.reduce((n, b) => n + (b.kind === "markdown" ? b.text.length : 0), 0) ?? 0;
  const surfacesOk = runtime.surfaceIds.every((sid) =>
    runtime.getSurface(sid)?.componentsModel.has("root"),
  );
  // Hybrid answers may legitimately contain no surface; they still need some block.
  const valid =
    format === "hybrid"
      ? status === "completed" && blocks.length > 0 && surfacesOk && !finalErrors.length
      : status === "completed" &&
        messageCount > 0 &&
        surfaces > 0 &&
        surfacesOk &&
        !finalErrors.length;
  const row: any = {
    ...base_,
    actualModel: actualModel ?? null,
    initialValid: initialValid && repairs === 0 && valid,
    valid,
    status,
    repairs,
    firstMessageMs,
    elapsedMs: performance.now() - start,
    outputBytes,
    inputTokens,
    outputTokens,
    messageCount,
    ...(flag("record-wire") ? { wire: recordedWire } : {}),
    surfaces,
    blocks,
    markdownChars,
    waitedMs,
    format,
    fallbackText: answer?.blocks
      .filter((b) => b.kind === "surface")
      .map((b: any) => ({ source: b.fallbackSource, text: b.fallbackText })),
    media: answer?.blocks.filter((b) => b.kind === "media").map((b: any) => b.attachmentIds),
    errors,
    finalErrors,
  };
  row.failureClass = classifyRow(row);
  row.infra = row.failureClass === "infra";
  if (row.infra) {
    const count = (infraCounts.get(model) ?? 0) + 1;
    infraCounts.set(model, count);
    if (count >= Number(opt("stop-after-infra", "1000")))
      unavailable.set(model, "BOUNDED_STOP_INFRA");
  }
  rows.push(row);
  runtime.dispose();
  if (sessionId)
    await fetch(`${base}/api/sessions/${sessionId}`, { method: "DELETE" }).catch(() => {});
}
async function worker() {
  while (cursor < queue.length) {
    await one(queue[cursor++]);
    const r = rows.at(-1);
    console.log(
      `${rows.length}/${queue.length} ${r.model} ${r.kitId} ${r.id}: ${r.valid ? "PASS" : r.infra ? "INFRA" : "FAIL"} (${r.repairs} repairs${r.actualModel ? `, actual ${r.actualModel}` : ""})`,
    );
    await persist();
  }
}
await Promise.all(
  Array.from({ length: Math.min(3, Math.max(1, Number(opt("workers", "3")))) }, () => worker()),
);
await persist();
for (const model of models) {
  const mine = rows.filter((r) => r.model === model);
  const infra = mine.filter((r) => r.infra).length;
  console.log(
    `${model}: ${mine.filter((r) => r.initialValid).length}/${mine.length} first pass, ${mine.filter((r) => r.valid).length}/${mine.length} repaired, ${infra} infra`,
  );
}
