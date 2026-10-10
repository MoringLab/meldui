import { mkdirSync, writeFileSync } from "node:fs";
import { CATALOG_ID } from "../packages/protocol/src/index.js";

const components = [
  { id: "panel", component: "ControlPanel", title: "Variables", children: ["stat"] },
  { id: "stat", component: "Stat", label: "Result", value: 42, unit: "units" },
  { id: "stats", component: "StatGroup", children: ["stat2"] },
  { id: "stat2", component: "Stat", label: "Second", value: 2 },
  { id: "legend", component: "Legend", items: [{ label: "Observed", color: "accent" }] },
  {
    id: "formula",
    component: "Formula",
    latex: "V=IR",
    meaning: "Voltage equals current times resistance.",
  },
  { id: "annotation", component: "Annotation", text: "These values are illustrative." },
  {
    id: "walk",
    component: "Walkthrough",
    steps: [
      { title: "Observe", text: "Change the input." },
      { title: "Explain", text: "Compare the result." },
    ],
    value: { path: "/step" },
  },
  {
    id: "quiz",
    component: "Quiz",
    prompt: "2 + 2?",
    choices: ["4", "5"],
    correctIndex: 0,
    explanation: "Addition gives four.",
    value: { path: "/answer" },
  },
  { id: "timeline", component: "Timeline", items: [{ label: "First", detail: "Start here." }] },
  { id: "clock", component: "Playback", path: "/clock" },
  {
    id: "scene",
    component: "SvgScene",
    title: "Scene",
    description: "A circle and a labelled line.",
    viewBox: [0, 0, 500, 300],
    nodes: [
      { type: "circle", attrs: { cx: 150, cy: 120, r: 50, fill: "accent" } },
      { type: "text", attrs: { x: 220, y: 140, fill: "foreground" }, text: "Bounded scene" },
    ],
  },
  {
    id: "plot",
    component: "Plot",
    title: "Distribution",
    kind: "line",
    values: [
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 1 },
    ],
    xKey: "x",
    yKey: "y",
  },
  {
    id: "route",
    component: "RouteMap",
    title: "Approximate route",
    points: [
      { label: "A", x: 126, y: 37 },
      { label: "B", x: 127, y: 38 },
    ],
    approximate: true,
  },
  {
    id: "sim",
    component: "Simulation",
    title: "Trusted particles",
    module: "nBody",
    seed: 42,
    params: { count: 12 },
  },
  {
    id: "confirmation",
    component: "Confirmation",
    title: "Review",
    detail: "The host validates the final action.",
    label: "Confirm action",
    action: { event: { name: "hostConfirm" } },
  },
];
const root = {
  id: "root",
  component: "Column",
  children: components.filter((c) => !["stat", "stat2"].includes(c.id)).map((c) => c.id),
};
const fixture = {
  id: "advanced-catalog",
  title: "Learning and visuals",
  prompt: "학습·계산·시각화 공통 컴포넌트",
  messages: [
    { version: "v0.9", createSurface: { surfaceId: "main", catalogId: CATALOG_ID } },
    {
      version: "v0.9",
      updateDataModel: { surfaceId: "main", value: { step: 0, answer: -1, clock: { $time: 0 } } },
    },
    { version: "v0.9", updateComponents: { surfaceId: "main", components: [root, ...components] } },
  ],
};
mkdirSync("fixtures/advanced", { recursive: true });
writeFileSync("fixtures/advanced/cases.json", JSON.stringify([fixture], null, 2) + "\n");
