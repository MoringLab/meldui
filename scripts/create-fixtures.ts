import { mkdir, writeFile } from "node:fs/promises";
import {
  CATALOG_ID,
  type Component,
  PROTOCOL_VERSION,
  type UIMessage,
} from "../packages/protocol/src/index.js";

const c = (id: string, component: string, props: Record<string, unknown>): Component => ({
  id,
  component,
  ...props,
});
const bind = (path: string) => ({ path });
const calc = (expr: unknown, type = "number") => ({
  call: `compute${type[0].toUpperCase()}${type.slice(1)}`,
  args: { expr },
  returnType: type,
});
type Fixture = {
  id: string;
  title: string;
  category: string;
  prompt: string;
  messages: UIMessage[];
  interactions: { path: string; value: unknown; node: string; prop: string; expected: unknown }[];
};
const fixtures: Fixture[] = [];
function add(
  id: string,
  title: string,
  category: string,
  prompt: string,
  components: Component[],
  data: Record<string, unknown>,
  interactions: Fixture["interactions"] = [],
) {
  const root = c("root", "Column", {
    children: [
      "heading",
      "intro",
      ...components.filter((x) => !x.id.startsWith("_")).map((x) => x.id),
    ],
  });
  fixtures.push({
    id,
    title,
    category,
    prompt,
    interactions,
    messages: [
      { version: PROTOCOL_VERSION, createSurface: { surfaceId: "main", catalogId: CATALOG_ID } },
      { version: PROTOCOL_VERSION, updateDataModel: { surfaceId: "main", value: data } },
      {
        version: PROTOCOL_VERSION,
        updateComponents: {
          surfaceId: "main",
          components: [
            root,
            c("heading", "Heading", { text: title, level: 1 }),
            c("intro", "Text", { text: prompt, tone: "muted" }),
          ],
        },
      },
      ...components.map((component) => ({
        version: PROTOCOL_VERSION,
        updateComponents: { surfaceId: "main", components: [component] },
      })),
    ],
  });
}
const calculators = [
  [
    "calculator",
    "함께 나누는 저녁",
    "총 금액과 인원을 바꾸며 1인당 금액을 계산하세요.",
    84000,
    4,
    "총 금액 (원)",
    "인원",
    "div",
  ],
  [
    "trip-budget",
    "여행 예산",
    "하루 예산과 여행 일수로 총 예산을 계산하세요.",
    65000,
    5,
    "하루 예산 (원)",
    "여행 일수",
    "mul",
  ],
  [
    "study-time",
    "이번 주 공부 시간",
    "매일 공부할 시간과 일수로 계획을 세우세요.",
    2,
    5,
    "하루 시간",
    "일수",
    "mul",
  ],
  [
    "unit-price",
    "단위 가격 비교",
    "묶음 가격과 수량으로 개당 가격을 확인하세요.",
    18000,
    6,
    "묶음 가격 (원)",
    "수량",
    "div",
  ],
  [
    "remaining-budget",
    "남은 예산",
    "예산에서 사용한 금액을 빼고 남은 금액을 확인하세요.",
    100000,
    25000,
    "예산 (원)",
    "사용한 금액 (원)",
    "sub",
  ],
] as const;
for (const [id, title, prompt, a, b, first, second, op] of calculators) {
  add(
    id,
    title,
    "calculator",
    prompt,
    [
      c("controls", "Grid", { columns: 2, children: ["_a", "_b"] }),
      c("_a", "Slider", {
        label: first,
        value: bind("/a"),
        min: 0,
        max: Math.max(a * 2, 10),
        step: a >= 1000 ? 1000 : 1,
      }),
      c("_b", "Slider", {
        label: second,
        value: bind("/b"),
        min: 1,
        max: Math.max(b * 2, 10),
        step: b >= 1000 ? 1000 : 1,
      }),
      c("result", "Card", { title: "계산 결과", children: ["_result"] }),
      c("_result", "Heading", {
        level: 2,
        text: calc({ op: "round", args: [{ op, args: [{ ref: "/a" }, { ref: "/b" }] }, 2] }),
      }),
      c("note", "Text", {
        text: "입력값을 바꾸면 기기에서 바로 계산됩니다. 예시 금액입니다.",
        tone: "muted",
      }),
    ],
    { a, b },
    [
      {
        path: "/a",
        value: a * 2,
        node: "_result",
        prop: "text",
        expected: op === "mul" ? a * 2 * b : op === "div" ? (a * 2) / b : a * 2 - b,
      },
    ],
  );
}
for (const [id, title, subject] of [
  ["comparison", "도구를 고르는 기준", "노트 앱"],
  ["travel-compare", "이동 수단 비교", "교통수단"],
  ["plan-compare", "요금제 비교", "예시 요금제"],
  ["course-compare", "학습 과정 비교", "학습 과정"],
] as const) {
  add(
    id,
    title,
    "comparison",
    `${subject}의 차이를 표로 살펴보세요. 수치는 비교를 위한 예시입니다.`,
    [
      c("table", "Table", {
        caption: `${subject} 비교`,
        columns: [
          { key: "name", label: "선택지" },
          { key: "cost", label: "비용" },
          { key: "strength", label: "특징" },
        ],
        rows: bind("/rows"),
      }),
      c("choice", "Select", {
        label: "관심 있는 선택지",
        value: bind("/choice"),
        options: ["A", "B", "C"].map((v) => ({ value: v, label: `선택 ${v}` })),
      }),
      c("selection", "Text", {
        text: calc({ op: "format", args: ["현재 선택: {0}", { ref: "/choice" }] }, "string"),
      }),
    ],
    {
      choice: "A",
      rows: [
        { name: "A", cost: "무료", strength: "간단하게 시작" },
        { name: "B", cost: "월 10,000원", strength: "함께 작업" },
        { name: "C", cost: "월 20,000원", strength: "세밀한 설정" },
      ],
    },
    [{ path: "/choice", value: "B", node: "selection", prop: "text", expected: "현재 선택: B" }],
  );
}
for (const [id, title] of [
  ["form", "참가 신청"],
  ["reservation", "방문 예약"],
  ["feedback", "의견 남기기"],
  ["contact", "연락 요청"],
  ["onboarding", "시작 설정"],
] as const) {
  add(
    id,
    title,
    "form",
    "필요한 정보를 입력하고 제출하세요. 제출 전까지 입력은 기기에만 보관됩니다.",
    [
      c("form", "Form", {
        label: title,
        children: ["_name", "_date", "_topic", "_memo", "_consent"],
        onSubmit: {
          event: {
            name: "submit_form",
            context: {
              name: bind("/name"),
              date: bind("/date"),
              topic: bind("/topic"),
              memo: bind("/memo"),
              consent: bind("/consent"),
            },
          },
        },
      }),
      c("_name", "TextField", {
        label: "이름",
        value: bind("/name"),
        placeholder: "이름을 입력하세요",
      }),
      c("_date", "DatePicker", { label: "날짜", value: bind("/date") }),
      c("_topic", "Select", {
        label: "주제",
        value: bind("/topic"),
        options: [
          { label: "제품", value: "product" },
          { label: "디자인", value: "design" },
        ],
      }),
      c("_memo", "TextField", { label: "메모", value: bind("/memo"), multiline: true }),
      c("_consent", "Checkbox", { label: "입력한 내용을 확인했습니다", value: bind("/consent") }),
    ],
    { name: "", date: "2026-10-15", topic: "product", memo: "", consent: false },
    [{ path: "/name", value: "루이", node: "_name", prop: "value", expected: "루이" }],
  );
}
for (const [id, title] of [
  ["planner", "하루를 가볍게 계획하기"],
  ["packing", "여행 준비"],
  ["meeting", "회의 준비"],
  ["habit", "작은 습관 만들기"],
] as const) {
  add(
    id,
    title,
    "planner",
    "할 일을 정리하고 완료한 항목을 체크하세요.",
    [
      c("tabs", "Tabs", {
        value: bind("/tab"),
        tabs: [
          { id: "today", label: "오늘", child: "_today" },
          { id: "next", label: "다음", child: "_next" },
        ],
      }),
      c("_today", "Column", { children: ["_task1", "_task2", "_progress"] }),
      c("_next", "Text", { text: "다음 단계를 위한 여유를 남겨두세요." }),
      c("_task1", "Checkbox", { label: "중요한 일 한 가지 정하기", value: bind("/done1") }),
      c("_task2", "Checkbox", { label: "필요한 자료 준비하기", value: bind("/done2") }),
      c("_progress", "Progress", {
        label: "진행 상황",
        value: calc({
          op: "add",
          args: [
            { op: "if", args: [{ ref: "/done1" }, 50, 0] },
            { op: "if", args: [{ ref: "/done2" }, 50, 0] },
          ],
        }),
        max: 100,
      }),
      c("add", "TextField", { label: "나의 메모", value: bind("/memo") }),
    ],
    { tab: "today", done1: false, done2: false, memo: "" },
    [{ path: "/done1", value: true, node: "_progress", prop: "value", expected: 50 }],
  );
}
for (const [i, [id, title]] of [
  ["dashboard", "한 주의 흐름"],
  ["energy", "에너지 사용량"],
  ["activity", "활동 기록"],
  ["experiment", "실험 데이터"],
  ["sales", "매출 추이"],
].entries()) {
  add(
    id,
    title,
    "dashboard",
    "예시 데이터의 변화를 살펴보세요. 조절 막대로 가운데 값을 바꿀 수 있습니다.",
    [
      c("chart", "Chart", {
        title: "일별 변화 · 예시 데이터",
        kind: ["line", "bar", "scatter"][i % 3],
        values: bind("/points"),
        xKey: "x",
        yKey: "y",
      }),
      c("slider", "Slider", {
        label: "수요일 값",
        value: bind("/points/2/y"),
        min: 0,
        max: 100,
        step: 1,
      }),
      c("badge", "Badge", { text: "기기에서 즉시 업데이트", tone: "success" }),
    ],
    {
      points: [
        { x: "월", y: 32 },
        { x: "화", y: 58 },
        { x: "수", y: 46 },
        { x: "목", y: 72 },
        { x: "금", y: 65 },
      ],
    },
    [{ path: "/points/2/y", value: 80, node: "slider", prop: "value", expected: 80 }],
  );
}
for (const [id, title] of [
  ["explanation", "복잡한 것을 작은 단계로"],
  ["streaming", "스트리밍 이해하기"],
  ["accessibility", "접근성 체크리스트"],
  ["components", "인터페이스의 구성 요소"],
] as const) {
  add(
    id,
    title,
    "explanation",
    "설명을 펼쳐보고, 예제를 확인하며 개념을 이해하세요.",
    [
      c("callout", "Callout", {
        title: "핵심 아이디어",
        text: "UI의 구조와 상태를 분리하면 같은 인터페이스를 여러 기기에서 사용할 수 있습니다.",
        tone: "info",
      }),
      c("accordion", "Accordion", {
        value: bind("/open"),
        items: [
          { id: "one", label: "구조와 데이터", child: "_detail" },
          { id: "two", label: "실행 순서", child: "_list" },
        ],
      }),
      c("_detail", "CodeBlock", { language: "json", code: '{"value":{"path":"/name"}}' }),
      c("_list", "List", { ordered: true, children: ["_line1", "_line2"] }),
      c("_line1", "Text", { text: "메시지를 검증합니다." }),
      c("_line2", "Text", { text: "등록된 컴포넌트로 표시합니다." }),
      c("divider", "Divider", {}),
      c("icon", "Icon", { name: "check", label: "확인됨" }),
      c("image", "Image", {
        asset: "engine-pattern",
        alt: "세 개의 연결된 인터페이스를 나타내는 기하학 그림",
        aspectRatio: 3,
      }),
    ],
    { open: "one" },
    [{ path: "/open", value: "two", node: "accordion", prop: "value", expected: "two" }],
  );
}
for (const [id, title, answer] of [
  ["quiz", "작은 수학 퀴즈", 8],
  ["counting-game", "숫자 맞히기", 5],
  ["logic-game", "규칙 찾기", 3],
] as const) {
  add(
    id,
    title,
    "game",
    `정답은 ${answer}입니다. 버튼으로 값을 바꾸며 정답을 맞혀보세요.`,
    [
      c("number", "Heading", { text: bind("/guess"), level: 2 }),
      c("buttons", "Row", { children: ["_minus", "_plus"] }),
      c("_minus", "Button", {
        label: "하나 빼기",
        variant: "secondary",
        action: {
          functionCall: {
            call: "setValue",
            args: { path: "/guess", expr: { op: "sub", args: [{ ref: "/guess" }, 1] } },
          },
        },
      }),
      c("_plus", "Button", {
        label: "하나 더하기",
        action: {
          functionCall: {
            call: "setValue",
            args: { path: "/guess", expr: { op: "add", args: [{ ref: "/guess" }, 1] } },
          },
        },
      }),
      c("answer", "Text", {
        text: calc(
          {
            op: "if",
            args: [
              { op: "eq", args: [{ ref: "/guess" }, answer] },
              "정답입니다!",
              "조금 더 시도해보세요.",
            ],
          },
          "string",
        ),
      }),
    ],
    { guess: 0 },
    [{ path: "/guess", value: answer, node: "answer", prop: "text", expected: "정답입니다!" }],
  );
}
if (fixtures.length !== 30) throw new Error(`Expected 30 fixtures, got ${fixtures.length}`);
await mkdir("fixtures", { recursive: true });
await writeFile("fixtures/cases.json", `${JSON.stringify(fixtures, null, 2)}\n`);
console.log(`Generated ${fixtures.length} fixtures.`);
