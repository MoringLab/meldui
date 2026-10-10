import { mkdir, writeFile } from "node:fs/promises";
import { AnswerSession, createUIRuntime } from "../../packages/core/src/index.js";
import { NDJSONDecoder, readBytes } from "../../packages/core/src/stream.js";

if (!process.argv.includes("--live"))
  throw Error("Model calls require --live and the local OmniRoute server");
const model = process.env.EVAL_MODEL ?? "auto/claude-sonnet";
const attachments = ["photo-a", "photo-b"].map((id, i) => ({
  id,
  kind: "image",
  mime: "image/png",
  name: i ? "Mountain illustration" : "Coast illustration",
  alt: i ? "Mountain illustration" : "Coast illustration",
  width: 640,
  height: 480,
}));
const jobs = [
  {
    id: "media-left",
    prompt:
      "호스트가 제공한 사진 두 장을 넘겨보는 답변을 만들어줘. media 제어 줄 하나로 attachments photo-a/photo-b, layout carousel, placement left를 사용하고 같은 블록의 markdown에 한국어 설명을 넣어줘. 이미지의 실제 내용을 추측하지 마.",
    policy: { mode: "auto", maxSurfaces: 0 },
  },
  {
    id: "local-calculator",
    prompt:
      "두 입력 /a=10, /b=20을 바꾸면 합계가 기기에서 즉시 계산되는 작은 화면을 만들어줘. Slider 두 개와 합계 Stat 하나로 충분해. 합계는 add 표현식과 데이터 바인딩을 사용하고 모델 후속 호출 없이 갱신돼야 해.",
    policy: { mode: "engine-only", maxSurfaces: 1 },
  },
];
const rows: any[] = [];
let stopped = false;
for (const job of jobs) {
  if (stopped) {
    rows.push({
      id: job.id,
      status: "not-run",
      reason: "bounded stop after an infrastructure failure",
    });
    continue;
  }
  const runtime = createUIRuntime();
  for (const record of attachments) runtime.attachments.attach(record as any);
  const answer = new AnswerSession(runtime, { policy: job.policy as any });
  const events: any[] = [];
  let sessionId: string | undefined;
  try {
    const response = await fetch("http://127.0.0.1:8787/api/ui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: job.prompt,
        policy: { ...job.policy, latencyBudgetMs: 30000, maxOutputTokens: 1800 },
        format: "hybrid",
        platform: "web",
        attachments,
      }),
      signal: AbortSignal.timeout(40000),
    });
    sessionId = response.headers.get("X-Session-Id") ?? undefined;
    if (!response.ok) throw Error("HTTP_" + response.status);
    const decoder = new NDJSONDecoder();
    for await (const chunk of readBytes(response.body!))
      for (const event of decoder.push(chunk) as any[]) {
        events.push(event);
        if (event.type === "text") answer.push(event.text);
        if (event.type === "message") answer.pushMessage(event.message);
      }
    answer.end();
    const infrastructure = events.some(
      (e) => e.type === "diagnostic" && /^GATEWAY_/.test(e.diagnostic.code),
    );
    stopped = infrastructure;
    const media = answer.blocks.find((b) => b.kind === "media");
    const stat = runtime.surfaceIds
      .flatMap((s) =>
        [...runtime.getSurface(s)!.componentsModel.values].map((n) =>
          runtime.getNodeSnapshot(s, n.id),
        ),
      )
      .find((n) => n.component === "Stat");
    let local = false;
    if (stat) {
      runtime.setValue("main", "/a", 5);
      runtime.setValue("main", "/b", 7);
      local = runtime.getNodeSnapshot("main", stat.id).props.value === 12;
    }
    const passed =
      job.id === "media-left"
        ? media?.kind === "media" &&
          media.layout === "carousel" &&
          media.placement === "left" &&
          Boolean(media.markdown)
        : local;
    rows.push({
      id: job.id,
      requestedModel: model,
      actualModel: events.filter((e) => e.type === "usage").at(-1)?.model ?? null,
      status: infrastructure ? "infra-fail" : passed ? "pass" : "fail",
      scope:
        job.id === "media-left"
          ? "model-authored registered media layout"
          : "model-authored state + local input calculation",
      events,
      blocks: answer.blocks,
      diagnostics: runtime.diagnostics,
    });
  } catch (e) {
    stopped = true;
    rows.push({ id: job.id, requestedModel: model, status: "infra-fail", reason: String(e) });
  } finally {
    runtime.dispose();
    if (sessionId)
      await fetch("http://127.0.0.1:8787/api/sessions/" + sessionId, { method: "DELETE" }).catch(
        () => {},
      );
  }
}
await mkdir("artifacts/eval", { recursive: true });
await writeFile(
  "artifacts/eval/feature-smoke.json",
  JSON.stringify({ at: new Date().toISOString(), rows }, null, 2),
);
console.log(rows.map(({ events, blocks, diagnostics, ...row }) => row));
