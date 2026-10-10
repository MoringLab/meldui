import { mkdir, writeFile } from "node:fs/promises";
import cases from "../../eval/multiturn.json" with { type: "json" };
import { AnswerSession, createUIRuntime } from "../../packages/core/src/index.js";
import { NDJSONDecoder } from "../../packages/core/src/stream.js";

if (!process.argv.includes("--live"))
  throw Error("Use --live; every model call goes through the local OmniRoute server.");
const base = process.env.ENGINE_SERVER_URL ?? "http://127.0.0.1:8787",
  model = process.env.EVAL_MODEL ?? "cfp/zai-org/glm-5.2";
const rows: any[] = [];
let infra = 0;
for (const item of cases) {
  const started = performance.now();
  if (infra >= 2) {
    rows.push({
      id: item.id,
      status: "not-run",
      infra: true,
      reason: "bounded stop after two infrastructure failures",
    });
    continue;
  }
  const runtime = createUIRuntime(),
    answer = new AnswerSession(runtime);
  let sessionId = "";
  try {
    const seedResponse = await fetch(`${base}/api/eval/replay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fixtureId: item.base }),
      signal: AbortSignal.timeout(10000),
    });
    if (!seedResponse.ok) throw Error("EVAL_REPLAY_DISABLED");
    const seed = await seedResponse.json();
    sessionId = seed.sessionId;
    for (const message of seed.messages) answer.pushMessage(message);
    answer.end();
    const before = JSON.stringify(
      [...runtime.getSurface("main")!.componentsModel.values].map((n) => ({
        id: n.id,
        type: n.type,
        props: n.properties,
      })),
    );
    const beforeComponents = [...runtime.getSurface("main")!.componentsModel.values].map((n) => ({
      id: n.id,
      type: n.type,
      props: structuredClone(n.properties),
    }));
    const inputs = [...runtime.getSurface("main")!.componentsModel.values].filter(
      (n) => n.type === "Slider",
    );
    const input = inputs[0];
    const path = (input?.properties.value as any)?.path;
    const value = path
      ? Number(runtime.read("main", path)) + Number(input!.properties.step ?? 1)
      : undefined;
    if (path) runtime.setValue("main", path, value);
    let repaired = 0,
      actualModel: string | undefined,
      complete = "completed",
      requests = 0;
    const diagnostics: string[] = [];
    let unmeasuredHostUi = false;
    for (const turn of item.turns) {
      const expect = turn.expect as any;
      if (expect.noModelUi) {
        if (expect.clientAction === "reset") answer.reset("main");
        if (expect.clientAction === "viewAsText") answer.asText();
        if (["switchKit", "expand"].includes(expect.clientAction)) unmeasuredHostUi = true;
        continue;
      }
      requests++;
      answer.beginTurn();
      const response = await fetch(`${base}/api/ui`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          model,
          kitId: "neutral",
          format: "hybrid",
          platform: "web",
          prompt: turn.prompt,
          edits: path ? [{ surfaceId: "main", path, value }] : [],
        }),
        signal: AbortSignal.timeout(90000),
      });
      if (!response.ok) throw Error(`HTTP_${response.status}`);
      const decoder = new NDJSONDecoder();
      const read = async function* (body: ReadableStream<Uint8Array>) {
        const reader = body.getReader();
        try {
          for (;;) {
            const r = await reader.read();
            if (r.done) return;
            yield r.value;
          }
        } finally {
          reader.releaseLock();
        }
      };
      for await (const chunk of read(response.body!))
        for (const event of decoder.push(chunk) as any[]) {
          if (event.type === "text") answer.push(event.text);
          if (event.type === "message") answer.pushMessage(event.message);
          if (event.type === "repair") {
            repaired = event.attempt;
            answer.beginTurn();
          }
          if (event.type === "usage") actualModel = event.model;
          if (event.type === "diagnostic") diagnostics.push(event.diagnostic.code);
          if (event.type === "complete") complete = event.status;
        }
      answer.end();
    }
    const expected = item.turns.at(-1)!.expect as any;
    const components = [...(runtime.getSurface("main")?.componentsModel.values ?? [])];
    const after = JSON.stringify(
      components.map((n) => ({ id: n.id, type: n.type, props: n.properties })),
    );
    const preserved = !expected.preserveState || !path || runtime.read("main", path) === value;
    const added =
      !expected.adds ||
      components.some(
        (n) =>
          expected.adds.split("|").includes(n.type) &&
          !beforeComponents.some((b) => b.id === n.id && b.type === n.type),
      );
    const [changedKind, changedProperty] = String(expected.changed ?? "").split(".");
    const changed =
      !expected.changed ||
      (changedProperty
        ? components.some(
            (n) =>
              n.type === changedKind &&
              beforeComponents.some(
                (b) =>
                  b.id === n.id &&
                  JSON.stringify(b.props[changedProperty!]) !==
                    JSON.stringify(n.properties[changedProperty!]),
              ),
          )
        : before !== after);
    const deleted = !expected.deleteSurface || runtime.surfaceIds.length === 0;
    const infrastructure = diagnostics.some((c) => /^GATEWAY_|^HTTP_/.test(c));
    if (infrastructure) infra++;
    rows.push({
      id: item.id,
      requestedModel: model,
      actualModel,
      requests,
      repaired,
      complete,
      status: unmeasuredHostUi
        ? "not-run"
        : infrastructure
          ? "infra-fail"
          : complete === "completed" && preserved && added && changed && deleted
            ? "pass"
            : "fail",
      checks: { preserved, added, changed, deleted },
      diagnostics,
      elapsedMs: performance.now() - started,
      scope:
        "seeded prior UI + edited input + real follow-up; exact changed properties and newly added nodes. Host kit/modal UI is verified separately in browser/device tests.",
    });
  } catch (e) {
    infra++;
    rows.push({
      id: item.id,
      status: "infra-fail",
      reason: String(e),
      elapsedMs: performance.now() - started,
    });
  } finally {
    runtime.dispose();
    if (sessionId)
      await fetch(`${base}/api/sessions/${sessionId}`, { method: "DELETE" }).catch(() => {});
  }
  await mkdir("artifacts/eval", { recursive: true });
  await writeFile(
    "artifacts/eval/multiturn-current.json",
    JSON.stringify({ at: new Date().toISOString(), model, rows }, null, 2),
  );
  process.stdout.write(`${item.id}: ${rows.at(-1).status}\n`);
}
await writeFile(
  "artifacts/eval/multiturn-current.json",
  JSON.stringify({ at: new Date().toISOString(), model, rows }, null, 2),
);
