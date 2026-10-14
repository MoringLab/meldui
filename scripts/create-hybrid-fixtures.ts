import { mkdirSync, writeFileSync } from "node:fs";
import cases from "../fixtures/cases.json" with { type: "json" };
import { AnswerDecoder, AnswerSession, createUIRuntime } from "../packages/core/src/index.js";

/** Hybrid replay fixtures: the exact mixed text a model would stream (Markdown + one-line control lines). */
const messages = (id: string, surfaceId = "main") =>
  (cases.find((c) => c.id === id)?.messages ?? []).map((m) =>
    JSON.stringify(JSON.parse(JSON.stringify(m).replaceAll('"main"', JSON.stringify(surfaceId)))),
  );
const decl = (surfaceId: string, fallbackText: string, title?: string) =>
  JSON.stringify({
    engine: "v1",
    block: "surface",
    surfaceId,
    fallbackText,
    ...(title ? { title } : {}),
  });
const fixtures = [
  {
    id: "h-calc",
    title: "계산기 + 가정 설명",
    prompt: "더치페이를 계산해주고 가정을 설명해줘.",
    showcase: "H-05",
    expect: { blocks: ["markdown", "surface", "markdown"] },
    wire: [
      "1인당 금액은 **총 금액 ÷ 인원**으로 계산합니다. 팁과 세금은 포함하지 않은 단순한 가정입니다.",
      "",
      decl(
        "main",
        "총 금액과 인원을 조절하면 1인당 금액을 계산합니다. 기본값은 84,000원, 4명으로 1인당 21,000원입니다.",
        "더치페이 계산기",
      ),
      ...messages("calculator"),
      "",
      "인원이 늘면 1인당 금액은 줄어들지만 전체 금액은 그대로입니다.",
    ].join("\n"),
  },
  {
    id: "h-fact",
    title: "사실 질문 (마크다운만)",
    prompt: "프랑스의 수도는 어디야?",
    showcase: "H-06",
    expect: { blocks: ["markdown"] },
    wire: "프랑스의 수도는 **파리**입니다.",
  },
  {
    id: "h-code",
    title: "코드 질문 (마크다운 + 코드)",
    prompt: "JavaScript에서 배열 중복을 제거하는 방법은?",
    showcase: "H-07",
    expect: { blocks: ["markdown"] },
    wire: [
      "`Set`을 사용하면 가장 간단합니다.",
      "",
      "```js",
      "const unique = [...new Set(items)];",
      "```",
      "",
      "객체 배열이라면 키를 정해 `Map`으로 걸러야 합니다.",
    ].join("\n"),
  },
  {
    id: "h-explore",
    title: "차트 탐색 + 설명",
    prompt: "한 주의 흐름을 슬라이더로 바꿔보며 보고 싶어.",
    expect: { blocks: ["markdown", "surface", "markdown"] },
    wire: [
      "수요일 값을 바꾸면 차트가 바로 달라집니다.",
      decl(
        "main",
        "한 주의 값을 보여주는 선 차트와 수요일 값을 바꾸는 조절 막대가 있습니다. 수요일 기본값은 42입니다.",
        "한 주의 흐름",
      ),
      ...messages("dashboard"),
      "예시 데이터이므로 실제 수치가 아닙니다.",
    ].join("\n"),
  },
  {
    id: "h-two",
    title: "표 비교 + 계산기 (두 surface)",
    prompt: "노트 앱을 비교하고 비용도 계산해줘.",
    expect: { blocks: ["markdown", "surface", "markdown", "surface"] },
    wire: [
      "먼저 앱의 차이를 표로 볼까요?",
      decl(
        "compare",
        "노트 앱 세 가지를 비교한 표와 선택 목록입니다. 수치는 예시입니다.",
        "앱 비교",
      ),
      ...messages("comparison", "compare"),
      "마음에 드는 앱이 있다면 구독 비용을 나눠 볼 수 있습니다.",
      decl("cost", "총 금액과 인원을 조절해 1인당 금액을 계산합니다.", "비용 나누기"),
      ...messages("calculator", "cost"),
    ].join("\n"),
  },
  {
    id: "h-legacy",
    title: "선언 없는 기존 스트림",
    prompt: "(이전 버전 출력)",
    expect: { blocks: ["surface"] },
    wire: messages("planner").join("\n"),
  },
];
mkdirSync("fixtures/hybrid", { recursive: true });
writeFileSync("fixtures/hybrid/cases.json", `${JSON.stringify(fixtures, null, 1)}\n`);
console.log(`Wrote ${fixtures.length} hybrid fixtures`);

// ── Cross-platform parity vectors: TypeScript is the reference, Dart must match ──────────────

const mergeItems = (items: ReturnType<AnswerDecoder["push"]>) =>
  items.reduce<typeof items>((acc, item) => {
    const last = acc.at(-1);
    if (last?.kind === "text" && item.kind === "text") last.text += item.text;
    else acc.push({ ...item });
    return acc;
  }, []);
const brokenLine = '{"version":"v0.9","createSurface":{\n';
const edgeTexts: Record<string, string> = {
  "korean-emoji": "안녕하세요 😀 **굵게**\n둘째 줄\n",
  "fenced-json-is-text": '```json\n{"version":"v0.9","createSurface":{}}\n```\n{x}\n{"a":1}\n',
  "broken-control-line": brokenLine,
  "truncated-control-line": `${decl("main", "잘린 선언")}`.replace(/}\s*$/, "") + "\n",
  "blank-lines": "\n\n첫 문단\n\n\n둘째 문단\n",
  "no-trailing-newline": '문장 끝{"engine":"v1"}',
  "indented-control": `  ${decl("main", "들여쓴 선언")}\n`,
};
const wires: Record<string, string> = {
  ...edgeTexts,
  ...Object.fromEntries(fixtures.map((f) => [f.id, f.wire])),
};
const decoderVectors = Object.entries(wires).map(([name, text]) => {
  const d = new AnswerDecoder();
  return { name, text, items: mergeItems([...d.push(text), ...d.finish()]) };
});
const policies: Record<string, object> = {
  auto: {},
  "markdown-only": { mode: "markdown-only" },
  "engine-only": { mode: "engine-only" },
  "max-1": { maxSurfaces: 1 },
};
const sessionVectors = [];
for (const [name, text] of Object.entries(wires))
  for (const [policyName, policy] of Object.entries(policies)) {
    const runtime = createUIRuntime();
    const session = new AnswerSession(runtime, { policy });
    session.push(text);
    session.end();
    sessionVectors.push({
      name: `${name}/${policyName}`,
      policy,
      text,
      blocks: session.blocks.map((b) => b.kind),
      surfaces: runtime.surfaceIds,
      markdown: session.blocks.filter((b) => b.kind === "markdown").map((b: any) => b.text),
      fallbackSources: session.blocks
        .filter((b) => b.kind === "surface")
        .map((b: any) => b.fallbackSource),
      diagnosticCodes: [...new Set(runtime.diagnostics.map((d) => d.code))].sort(),
    });
  }
writeFileSync(
  "fixtures/hybrid/vectors.json",
  `${JSON.stringify({ decoder: decoderVectors, session: sessionVectors }, null, 1)}\n`,
);
console.log(`Wrote ${decoderVectors.length} decoder and ${sessionVectors.length} session vectors`);
