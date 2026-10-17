// Writes fixtures/interactive/cases.json: one surface that uses every general-purpose building
// block (Box, Pager, Flip, Menu, Device, QuizSet) and the input variants, with local state only —
// a phone mockup with a menu and two screens, a to-do list (add, toggle, remove), a flash-card
// deck, a graded quiz and compact controls. Web and React Native; Flutter lists these components
// as unsupported. Run: npx tsx scripts/create-interactive-fixture.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { CATALOG_ID, PROTOCOL_VERSION } from "../packages/protocol/src/index.js";

const set = (path: string, value: unknown) => ({
  functionCall: { call: "setValue", args: { path, value } },
});
const visibleWhen = (path: string, value: string) => ({
  call: "computeBoolean",
  args: { expr: { op: "eq", args: [{ ref: path }, value] } },
  returnType: "boolean",
});
const components = [
  {
    id: "root",
    component: "Column",
    children: [
      "device",
      "todos",
      "deck",
      "quiz",
      "controls",
      "relations",
      "pictures",
      "stock",
      "fx",
    ],
  },
  {
    id: "relations",
    component: "Diagram",
    nodes: [
      { id: "me", label: "나", sub: "주인공", detail: "순박하고 우직하다.", tone: "blue" },
      { id: "elder", label: "장인", sub: "인색", tone: "red" },
      { id: "bride", label: "점순이", sub: "결혼 상대", tone: "green" },
    ],
    edges: [
      { from: "me", to: "elder", label: "갈등", style: "dashed" },
      { from: "me", to: "bride", label: "혼인 약속", arrow: "none" },
    ],
  },
  {
    id: "pictures",
    component: "Collection",
    layout: "strip",
    items: [
      { image: "https://example.com/a.jpg", title: "Search", subtitle: "검색" },
      { image: "https://example.com/b.jpg", title: "YouTube", subtitle: "동영상" },
    ],
  },
  { id: "stock", component: "Quote", symbol: "AAPL", name: "Apple" },
  { id: "fx", component: "Converter", from: "USD", to: "KRW", amount: 100 },
  // Phone mockup: app bar with a menu, a segmented switch between two screens.
  {
    id: "device",
    component: "Device",
    kind: "phone",
    title: "Morit",
    children: ["appbar", "screens", "home", "search"],
  },
  {
    id: "appbar",
    component: "Box",
    direction: "row",
    justify: "between",
    children: ["appTitle", "menu"],
  },
  { id: "appTitle", component: "Text", text: "내 보관함", size: "xl", weight: "bold" },
  {
    id: "menu",
    component: "Menu",
    items: [
      { label: "홈으로", icon: "house", action: set("/tab", "home") },
      { label: "검색", icon: "search", action: set("/tab", "search") },
      { label: "모두 지우기", tone: "danger", action: set("/todos", []) },
    ],
  },
  {
    id: "screens",
    component: "Select",
    variant: "segmented",
    label: "화면",
    value: { path: "/tab" },
    options: [
      { label: "홈", value: "home" },
      { label: "검색", value: "search" },
    ],
  },
  {
    id: "home",
    component: "Box",
    tone: "subtle",
    radius: "lg",
    visible: visibleWhen("/tab", "home"),
    children: ["homeText"],
  },
  { id: "homeText", component: "Text", text: "최근 저장한 자료 12개", tone: "muted" },
  {
    id: "search",
    component: "Box",
    tone: "accentSoft",
    radius: "lg",
    visible: visibleWhen("/tab", "search"),
    children: ["searchText"],
  },
  { id: "searchText", component: "Text", text: "무엇이든 찾아보세요" },
  // To-do list: add with the field, toggle and remove per row ($rowIndex).
  { id: "todos", component: "Box", gap: "sm", children: ["todoInput", "todoList", "todoLeft"] },
  { id: "todoInput", component: "Box", direction: "row", children: ["draft", "add"] },
  {
    id: "draft",
    component: "TextField",
    label: "할 일",
    value: { path: "/draft" },
    placeholder: "새 할 일",
  },
  {
    id: "add",
    component: "Button",
    label: "추가",
    icon: "plus",
    iconOnly: true,
    action: {
      functionCall: {
        call: "setValues",
        args: {
          updates: [
            {
              path: "/todos",
              expr: {
                op: "concat",
                args: [
                  { ref: "/todos" },
                  {
                    op: "array",
                    args: [{ op: "object", args: ["text", { ref: "/draft" }, "done", false] }],
                  },
                ],
              },
            },
            { path: "/draft", value: "" },
          ],
        },
      },
    },
  },
  {
    id: "todoList",
    component: "Column",
    gap: "xs",
    children: { componentId: "todoRow", path: "/todos" },
  },
  {
    id: "todoRow",
    component: "Box",
    direction: "row",
    tone: "subtle",
    radius: "md",
    padding: "sm",
    children: ["todoCheck", "todoRemove"],
  },
  { id: "todoCheck", component: "Checkbox", label: { path: "text" }, value: { path: "done" } },
  {
    id: "todoRemove",
    component: "Button",
    label: "삭제",
    icon: "close",
    iconOnly: true,
    variant: "quiet",
    size: "sm",
    action: {
      functionCall: {
        call: "setValue",
        args: {
          path: "/todos",
          expr: {
            op: "filter",
            args: [
              { ref: "/todos" },
              { op: "ne", args: [{ ref: "$index" }, { ref: "$rowIndex" }] },
            ],
          },
        },
      },
    },
  },
  {
    id: "todoLeft",
    component: "Text",
    tone: "muted",
    size: "sm",
    text: {
      call: "computeString",
      args: {
        expr: {
          op: "format",
          args: [
            "남은 일 {0}개",
            {
              op: "count",
              args: [
                {
                  op: "filter",
                  args: [
                    { ref: "/todos" },
                    { op: "not", args: [{ op: "get", args: [{ ref: "$item" }, "done"] }] },
                  ],
                },
              ],
            },
          ],
        },
      },
      returnType: "string",
    },
  },
  // Flash cards: a pager of flip cards, one per deck row.
  {
    id: "deck",
    component: "Pager",
    value: { path: "/card" },
    children: { componentId: "card", path: "/deck" },
  },
  {
    id: "card",
    component: "Flip",
    front: "cardFront",
    back: "cardBack",
    value: { path: "flipped" },
  },
  {
    id: "cardFront",
    component: "Text",
    text: { path: "front" },
    size: "xl",
    weight: "bold",
    align: "center",
  },
  { id: "cardBack", component: "Text", text: { path: "back" }, size: "lg", align: "center" },
  // A graded quiz, answered in place.
  {
    id: "quiz",
    component: "QuizSet",
    title: "어휘 퀴즈",
    value: { path: "/quiz" },
    questions: [
      {
        prompt: "serendipity의 뜻은?",
        choices: ["뜻밖의 행운", "깊은 슬픔", "빠른 속도"],
        correctIndex: 0,
        explanation: "우연히 얻은 좋은 일.",
      },
      { prompt: "ephemeral의 뜻은?", choices: ["영원한", "잠깐 동안의"], correctIndex: 1 },
    ],
  },
  // Compact controls, two per row.
  { id: "controls", component: "Grid", columns: 2, children: ["price", "count", "notify", "ring"] },
  {
    id: "price",
    component: "Slider",
    label: "가격",
    value: { path: "/price" },
    min: 0,
    max: 100,
    unit: "만원",
  },
  { id: "count", component: "Slider", label: "개수", value: { path: "/count" }, min: 1, max: 20 },
  {
    id: "notify",
    component: "Checkbox",
    variant: "switch",
    label: "알림",
    value: { path: "/notify" },
  },
  { id: "ring", component: "Progress", variant: "ring", label: "달성률", value: { path: "/pct" } },
];
const data = {
  tab: "home",
  draft: "",
  todos: [
    { text: "우유 사기", done: false },
    { text: "택배 반품", done: true },
  ],
  card: 0,
  deck: [
    { front: "serendipity", back: "뜻밖의 행운", flipped: false },
    { front: "ephemeral", back: "잠깐 동안의", flipped: false },
  ],
  quiz: [],
  price: 30,
  count: 3,
  notify: true,
  pct: 72,
};
const fixture = {
  id: "interactive-building-blocks",
  description: "Every general-purpose building block with local state only.",
  messages: [
    { version: PROTOCOL_VERSION, createSurface: { surfaceId: "main", catalogId: CATALOG_ID } },
    { version: PROTOCOL_VERSION, updateDataModel: { surfaceId: "main", path: "/", value: data } },
    { version: PROTOCOL_VERSION, updateComponents: { surfaceId: "main", components } },
  ],
  interactions: [
    { path: "/tab", value: "search", node: "search", prop: "visible", expected: true },
    { path: "/tab", value: "search", node: "home", prop: "visible", expected: false },
    { path: "/todos/0/done", value: true, node: "todoLeft", prop: "text", expected: "남은 일 0개" },
  ],
};
mkdirSync("fixtures/interactive", { recursive: true });
writeFileSync("fixtures/interactive/cases.json", `${JSON.stringify([fixture], null, 2)}\n`);
console.log("Wrote fixtures/interactive/cases.json");
