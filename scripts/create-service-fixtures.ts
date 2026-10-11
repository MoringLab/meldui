import { mkdirSync, writeFileSync } from "node:fs";
import { CATALOG_ID } from "../packages/protocol/src/index.js";

const ref = (ref: string) => ({ ref }),
  op = (op: string, ...args: any[]) => ({ op, args }),
  get = (array: any, key: any) => op("get", array, key);
const computed = (expr: any, type = "number") => ({
  call: `compute${type[0].toUpperCase() + type.slice(1)}`,
  args: { expr },
  returnType: type,
});
const n = (id: string, component: string, props: any) => ({ id, component, ...props });
const value = (path: string) => ({ path });
const local = (updates: any[]) => ({ functionCall: { call: "setValues", args: { updates } } });
const items: any[] = [];
function add(id: string, title: string, intro: string, data: any, components: any[], outro = "") {
  const wire =
    [
      intro,
      {
        engine: "v1",
        block: "surface",
        surfaceId: "main",
        title,
        fallbackText: `${title}. ${intro}`,
      },
      { version: "v0.9", createSurface: { surfaceId: "main", catalogId: CATALOG_ID } },
      { version: "v0.9", updateDataModel: { surfaceId: "main", path: "/", value: data } },
      { version: "v0.9", updateComponents: { surfaceId: "main", components } },
      outro,
    ]
      .filter(Boolean)
      .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
      .join("\n") + "\n";
  items.push({ id, title, wire });
}
const inBudget = op("filter", ref("/products"), op("lte", get(ref("$item"), 1), ref("/budget")));
const sorted = op(
  "sort",
  inBudget,
  op("if", op("eq", ref("/order"), "price"), 1, 2),
  op("ne", ref("/order"), "price"),
);
add(
  "purchase",
  "구매 후보 비교",
  "예산과 정렬 기준을 바꾸면 결과가 즉시 바뀝니다. 가격·추천 점수는 합성 데모 데이터입니다.",
  {
    products: [
      ["후드티 A", 129000, 87],
      ["후드티 B", 179000, 94],
      ["후드티 C", 239000, 90],
      ["후드티 D", 99000, 78],
    ],
    budget: 200000,
    order: "score",
  },
  [
    n("root", "Card", { title: "구매 분석", children: ["stats", "budget", "order", "table"] }),
    n("stats", "StatGroup", { children: ["count", "price"] }),
    n("count", "Stat", {
      label: "예산 내 후보",
      value: computed(op("count", inBudget)),
      precision: 0,
      unit: "개",
    }),
    n("price", "Stat", {
      label: "최저 가격",
      value: computed(
        op(
          "if",
          op("gt", op("count", inBudget), 0),
          op("min", op("map", inBudget, get(ref("$item"), 1))),
          0,
        ),
      ),
      precision: 0,
      unit: "원",
    }),
    n("budget", "Slider", {
      label: "구매 예산 · 원",
      value: value("/budget"),
      min: 50000,
      max: 300000,
      step: 1000,
    }),
    n("order", "Select", {
      label: "정렬",
      value: value("/order"),
      options: [
        { value: "score", label: "추천 점수순" },
        { value: "price", label: "낮은 가격순" },
      ],
    }),
    n("table", "Table", {
      caption: "예산 내 구매 후보 · 합성 데이터",
      columns: [
        { key: "0", label: "상품" },
        { key: "1", label: "가격 · 원" },
        { key: "2", label: "점수" },
      ],
      rows: computed(
        op(
          "map",
          sorted,
          op(
            "array",
            get(ref("$item"), 0),
            op("numberFormat", get(ref("$item"), 1), 0, true),
            get(ref("$item"), 2),
          ),
        ),
        "array",
      ),
    }),
  ],
);
const period = op(
  "if",
  op("eq", ref("/period"), "7"),
  7,
  op("if", op("eq", ref("/period"), "30"), 30, 60),
);
const counts = op(
  "series",
  period,
  op(
    "mul",
    op("add", 8, op("mod", op("mul", ref("$index"), 7), 18)),
    op("if", op("eq", ref("/metric"), "views"), 3, 1),
  ),
);
add(
  "dashboard",
  "보관함 분석",
  "기간을 바꾸면 KPI와 그래프가 함께 갱신됩니다. 실제 서비스는 호스트 데이터를 연결합니다.",
  { period: "7", metric: "saved" },
  [
    n("root", "Card", {
      title: "내 보관함 분석",
      children: ["period", "stats", "metric", "chart"],
    }),
    n("period", "Select", {
      label: "기간",
      value: value("/period"),
      options: [
        { value: "7", label: "7일" },
        { value: "30", label: "30일" },
        { value: "all", label: "전체" },
      ],
    }),
    n("stats", "StatGroup", { children: ["total", "average"] }),
    n("total", "Stat", {
      label: "항목 합계",
      value: computed(op("sum", counts)),
      precision: 0,
      unit: "개",
    }),
    n("average", "Stat", {
      label: "구간 평균",
      value: computed(op("div", op("sum", counts), period)),
      precision: 1,
      unit: "개",
    }),
    n("metric", "Select", {
      label: "지표",
      value: value("/metric"),
      options: [
        { value: "saved", label: "저장" },
        { value: "views", label: "조회" },
      ],
    }),
    n("chart", "Chart", {
      title: "기간별 항목 수",
      kind: "bar",
      values: computed(
        op("map", counts, op("array", op("add", ref("$index"), 1), ref("$item"))),
        "array",
      ),
      xKey: "0",
      yKey: "1",
    }),
  ],
  "집계 규칙·출처·데이터를 호스트에서 관리하므로 렌더러를 바꾸어도 같은 결과를 유지합니다.",
);
const question = get(ref("/questions"), ref("/index"));
add(
  "quiz-flow",
  "학습 퀴즈",
  "답을 고르고 다음 문제로 넘어가세요. 문제와 해설은 등록된 데이터입니다.",
  {
    questions: [
      [
        "벡터 임베딩의 목적은?",
        ["파일 압축", "의미를 수치로 표현", "서버 배포"],
        1,
        "의미적으로 비슷한 항목을 비교할 수 있습니다.",
      ],
      [
        "SVG 장면 조작은 어디에서 실행되나요?",
        ["매번 모델 호출", "클라이언트의 로컬 상태", "서버 파일 변경"],
        1,
        "입력이 공통 상태와 바인딩을 갱신합니다.",
      ],
      [
        "첨부 파일의 실제 주소를 누가 관리하나요?",
        ["모델", "호스트", "Quiz 컴포넌트"],
        1,
        "호스트가 인증·만료·원본 열기를 담당합니다.",
      ],
    ],
    index: 0,
    selected: -1,
    score: 0,
    done: false,
  },
  [
    n("root", "Card", {
      title: "AI 학습 퀴즈",
      children: ["progress", "question", "next", "result", "reset"],
    }),
    n("progress", "Progress", {
      label: computed(op("format", "문제 {0} / 3", op("add", ref("/index"), 1)), "string"),
      value: computed(op("add", ref("/index"), 1)),
      max: 3,
    }),
    n("question", "Quiz", {
      visible: computed(op("not", ref("/done")), "boolean"),
      prompt: computed(get(question, 0), "string"),
      choices: computed(get(question, 1), "array"),
      correctIndex: computed(get(question, 2)),
      explanation: computed(get(question, 3), "string"),
      value: value("/selected"),
    }),
    n("next", "Button", {
      label: "다음 문제",
      visible: computed(op("not", ref("/done")), "boolean"),
      disabled: computed(op("lt", ref("/selected"), 0), "boolean"),
      action: local([
        {
          path: "/score",
          expr: op(
            "add",
            ref("/score"),
            op("if", op("eq", ref("/selected"), get(question, 2)), 1, 0),
          ),
        },
        { path: "/done", expr: op("eq", ref("/index"), 2) },
        { path: "/index", expr: op("min", op("array", 2, op("add", ref("/index"), 1))) },
        { path: "/selected", value: -1 },
      ]),
    }),
    n("result", "Text", {
      visible: value("/done"),
      text: computed(op("format", "정답 {0} / 3", ref("/score")), "string"),
    }),
    n("reset", "Button", {
      label: "다시 풀기",
      action: local([
        { path: "/index", value: 0 },
        { path: "/selected", value: -1 },
        { path: "/score", value: 0 },
        { path: "/done", value: false },
      ]),
    }),
  ],
);
add(
  "settings",
  "설정과 권한",
  "토글과 선택값에 따라 필요한 설정만 표시합니다. 실제 기기 권한은 호스트 확인을 거칩니다.",
  { notify: true, smart: false, sync: "wifi", theme: "system" },
  [
    n("root", "Card", {
      title: "서비스 설정",
      children: ["notify", "smart", "sync", "theme", "save"],
    }),
    n("notify", "Checkbox", { label: "알림 허용", value: value("/notify") }),
    n("smart", "Checkbox", {
      label: "스마트 알림",
      visible: value("/notify"),
      value: value("/smart"),
    }),
    n("sync", "Select", {
      label: "동기화 방식",
      value: value("/sync"),
      options: [
        { value: "wifi", label: "Wi-Fi에서만" },
        { value: "all", label: "모든 네트워크" },
        { value: "manual", label: "수동" },
      ],
    }),
    n("theme", "Select", {
      label: "화면 테마",
      value: value("/theme"),
      options: [
        { value: "system", label: "시스템" },
        { value: "light", label: "라이트" },
        { value: "dark", label: "다크" },
      ],
    }),
    n("save", "Button", {
      label: "호스트에 저장 요청",
      action: {
        event: {
          name: "saveSettings",
          context: {
            notify: value("/notify"),
            smart: value("/smart"),
            sync: value("/sync"),
            theme: value("/theme"),
          },
        },
      },
    }),
  ],
);
add(
  "progress-ring",
  "목표 달성률",
  "숫자와 벡터 그래픽이 같은 상태를 읽습니다.",
  { progress: 71 },
  [
    n("root", "Card", { title: "목표 달성률", children: ["ring", "progress"] }),
    n("ring", "SvgScene", {
      title: "목표 진행률",
      description: "슬라이더로 0부터 100퍼센트까지 조절할 수 있습니다.",
      viewBox: [0, 0, 320, 280],
      nodes: [
        {
          type: "circle",
          attrs: { cx: 160, cy: 130, r: 88, fill: "none", stroke: "border", strokeWidth: 18 },
        },
        {
          type: "circle",
          attrs: {
            cx: 160,
            cy: 130,
            r: 88,
            fill: "none",
            stroke: "accent",
            strokeWidth: 18,
            strokeLinecap: "round",
            strokeDasharray: 2 * Math.PI * 88,
            strokeDashoffset: computed(
              op("mul", 2 * Math.PI * 88, op("sub", 1, op("div", ref("/progress"), 100))),
            ),
            transform: "rotate(-90,160,130)",
          },
        },
        {
          type: "text",
          attrs: { x: 160, y: 138, textAnchor: "middle", fontSize: 38, fill: "foreground" },
          text: computed(op("format", "{0}%", ref("/progress")), "string"),
        },
        {
          type: "text",
          attrs: { x: 160, y: 172, textAnchor: "middle", fontSize: 16, fill: "muted" },
          text: "목표 달성",
        },
      ],
    }),
    n("progress", "Slider", {
      label: "목표 달성 · %",
      value: value("/progress"),
      min: 0,
      max: 100,
      step: 1,
    }),
  ],
);
const prey = get(ref("$acc"), 0),
  pred = get(ref("$acc"), 1),
  dt = 0.1;
const states = op(
  "scan",
  op("array", ref("/prey"), ref("/predators")),
  op(
    "array",
    op(
      "max",
      op(
        "array",
        0,
        op(
          "add",
          prey,
          op("mul", dt, op("sub", op("mul", ref("/growth"), prey), op("mul", 0.005, prey, pred))),
        ),
      ),
    ),
    op(
      "max",
      op(
        "array",
        0,
        op(
          "add",
          pred,
          op("mul", dt, op("sub", op("mul", 0.0006, prey, pred), op("mul", 0.4, pred))),
        ),
      ),
    ),
  ),
  op("mul", ref("/years"), 10),
);
add(
  "ecosystem",
  "생태계 시뮬레이터",
  "슬라이더로 초기 개체수와 번식 계수를 조절하세요. Lotka–Volterra의 단순화된 교육용 수치 모형입니다.",
  { prey: 120, predators: 12, years: 12, growth: 1 },
  [
    n("root", "Card", {
      title: "토끼와 여우",
      children: ["prey", "predators", "years", "growth", "chart", "summary"],
    }),
    n("prey", "Slider", {
      label: "초기 토끼 · 마리",
      value: value("/prey"),
      min: 20,
      max: 240,
      step: 10,
    }),
    n("predators", "Slider", {
      label: "초기 여우 · 마리",
      value: value("/predators"),
      min: 2,
      max: 40,
      step: 1,
    }),
    n("years", "Slider", {
      label: "관찰 기간 · 년",
      value: value("/years"),
      min: 1,
      max: 20,
      step: 1,
    }),
    n("growth", "Slider", {
      label: "번식 계수",
      value: value("/growth"),
      min: 0.1,
      max: 1.5,
      step: 0.1,
    }),
    n("chart", "Chart", {
      title: "개체 수 변화",
      kind: "line",
      values: computed(
        op(
          "map",
          states,
          op("array", op("div", ref("$index"), 10), get(ref("$item"), 0), get(ref("$item"), 1)),
        ),
        "array",
      ),
      xKey: "0",
      yKey: "1",
      series: [
        { key: "1", label: "토끼", color: "accent" },
        { key: "2", label: "여우", color: "muted" },
      ],
    }),
    n("summary", "Text", {
      text: "실제 생태계를 예측하는 모델이 아닙니다. 시간 간격은 0.1년입니다.",
    }),
  ],
);
items.push({
  id: "media-collection",
  title: "미디어 컬렉션",
  wire:
    "사진을 설명하는 본문과 다른 비율의 미디어를 함께 배치합니다. 이 자료는 호스트가 등록한 합성 이미지입니다.\n" +
    JSON.stringify({
      engine: "v1",
      block: "media",
      attachments: ["photo-a", "photo-b", "photo-a"],
      layout: "mosaic",
      placement: "below",
      alt: ["해안 합성 이미지", "산 합성 이미지", "해안 합성 이미지"],
    }) +
    "\n",
});
mkdirSync("fixtures/service", { recursive: true });
writeFileSync("fixtures/service/cases.json", JSON.stringify(items, null, 2) + "\n");
