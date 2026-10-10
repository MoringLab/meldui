import { mkdirSync, writeFileSync } from "node:fs";
import split from "../eval/split.json" with { type: "json" };
import cases from "../fixtures/cases.json" with { type: "json" };
import { AnswerSession, createUIRuntime, describeSurface } from "../packages/core/src/index.js";

/**
 * Kit examples are derived from DEV fixtures only. A held-out fixture must never become a
 * few-shot example, or the held-out score would measure memorization (see docs/quality/targets.md).
 */
const picks: Record<
  string,
  { fixture: string; category: string; keywords: string[]; intro: string; outro: string }
> = {
  calculator: {
    fixture: "calculator",
    category: "calculator",
    keywords: [
      "계산",
      "계산기",
      "합계",
      "총액",
      "나누",
      "더치페이",
      "1인당",
      "calculator",
      "calculate",
      "split",
      "total",
      "tip",
      "converter",
    ],
    intro: "값을 바꾸면 결과가 바로 달라지는 계산기입니다.",
    outro: "계산은 이 기기에서 즉시 이루어지며 입력값은 저장되지 않습니다.",
  },
  comparison: {
    fixture: "plan-compare",
    category: "compare",
    keywords: [
      "비교",
      "차이",
      "요금제",
      "표",
      "선택",
      "compare",
      "comparison",
      "versus",
      "plans",
      "table",
      "pros",
    ],
    intro: "항목별 차이를 표로 먼저 보여드립니다.",
    outro: "표의 수치는 비교를 위한 예시입니다.",
  },
  form: {
    fixture: "feedback",
    category: "form",
    keywords: [
      "신청",
      "입력",
      "양식",
      "폼",
      "예약",
      "가입",
      "form",
      "sign-up",
      "signup",
      "register",
      "survey",
      "feedback",
    ],
    intro: "필요한 정보를 입력하고 제출하는 양식입니다.",
    outro: "제출 전까지 입력은 기기에만 보관됩니다.",
  },
  planner: {
    fixture: "planner",
    category: "planner",
    keywords: [
      "계획",
      "체크리스트",
      "할 일",
      "일정",
      "준비물",
      "습관",
      "planner",
      "checklist",
      "todo",
      "plan",
      "tasks",
    ],
    intro: "해야 할 일을 정리하고 체크하며 진행 상황을 볼 수 있습니다.",
    outro: "완료한 항목은 진행률에 바로 반영됩니다.",
  },
  dashboard: {
    fixture: "energy",
    category: "dashboard",
    keywords: [
      "차트",
      "그래프",
      "대시보드",
      "추이",
      "변화",
      "데이터",
      "chart",
      "graph",
      "dashboard",
      "trend",
      "metrics",
      "sales",
    ],
    intro: "값을 바꾸면 차트가 즉시 다시 그려집니다.",
    outro: "예시 데이터이므로 실제 수치가 아닙니다.",
  },
  explanation: {
    fixture: "explanation",
    category: "explain",
    keywords: [
      "설명",
      "이해",
      "개념",
      "원리",
      "알려",
      "explain",
      "concept",
      "how",
      "why",
      "learn",
      "walkthrough",
    ],
    intro: "개념을 단계별로 펼쳐 보면서 이해할 수 있습니다.",
    outro: "더 궁금한 부분은 이어서 물어보세요.",
  },
  game: {
    fixture: "counting-game",
    category: "game",
    keywords: ["게임", "퀴즈", "맞히", "놀이", "game", "quiz", "guess", "puzzle", "play"],
    intro: "버튼으로 값을 바꾸며 정답을 맞혀 보세요.",
    outro: "정답을 맞히면 바로 알려줍니다.",
  },
};
const heldout = new Set(
  Object.entries(split.original)
    .filter(([, v]) => v === "heldout")
    .map(([k]) => k),
);
const examples = Object.entries(picks).map(([id, pick]) => {
  if (heldout.has(pick.fixture))
    throw new Error(`Example ${id} would use held-out fixture ${pick.fixture}`);
  const fixture = cases.find((c) => c.id === pick.fixture);
  if (!fixture) throw new Error(`Unknown fixture ${pick.fixture}`);
  const runtime = createUIRuntime();
  const session = new AnswerSession(runtime);
  session.push(fixture.messages.map((m) => JSON.stringify(m)).join("\n"));
  session.end();
  const example = {
    id,
    title: fixture.title,
    category: pick.category,
    keywords: pick.keywords,
    source: `fixture:${pick.fixture}`,
    intro: pick.intro,
    fallbackText: describeSurface(runtime, "main", 300),
    messages: fixture.messages,
    outro: pick.outro,
  };
  runtime.dispose();
  return example;
});
for (const kit of ["neutral", "editorial", "brand"]) {
  const dir = `packages/kits/${kit}/examples`;
  mkdirSync(dir, { recursive: true });
  for (const example of examples)
    writeFileSync(`${dir}/${example.id}.json`, `${JSON.stringify(example, null, 1)}\n`);
}
console.log(`Wrote ${examples.length} examples × 3 kits`);
