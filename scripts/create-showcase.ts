import { writeFileSync } from "node:fs";
import source from "../eval/showcase.json" with { type: "json" };
import { CATALOG_ID } from "../packages/protocol/src/index.js";

const o = (op: string, ...args: any[]) => ({ op, args }),
  r = (ref: string) => ({ ref }),
  c = (expr: any, type = "number") => ({
    call: `compute${type[0].toUpperCase()}${type.slice(1)}`,
    args: { expr },
    returnType: type,
  });
const n = (id: string, component: string, props: any) => ({ id, component, ...props });
const slider = (
  id: string,
  label: string,
  path: string,
  min: number,
  max: number,
  value: any,
  step = 1,
) => n(id, "Slider", { label, value: { path }, min, max, step });
const action = (path: string, expr: any) => ({
  functionCall: { call: "setValue", args: { path, expr } },
});
const button = (id: string, label: string, path: string, expr: any) =>
  n(id, "Button", { label, action: action(path, expr) });
const stat = (id: string, label: string, expr: any, unit = "") =>
  n(id, "Stat", { label, value: c(expr), unit });
const scene = (title: string, nodes: any[], description: string) =>
  n("visual", "SvgScene", { title, description, viewBox: [0, 0, 500, 300], nodes });
const circle = (cx: any, cy: any, radius: any = 8, fill = "accent", extra = {}) => ({
  type: "circle",
  attrs: { cx, cy, r: radius, fill },
  ...extra,
});
const label = (text: string, x: number, y: number) => ({
  type: "text",
  attrs: { x, y, fill: "foreground" },
  text,
});
const plot = (title: string, values: any, kind = "line") =>
  n("visual", "Plot", {
    title,
    values: c(values, "array"),
    kind,
    xKey: "x",
    yKey: "y",
    xUnit: "step",
    yUnit: "model units",
  });
const sum = (values: any) => o("sum", values),
  a = r("/a"),
  b = r("/b"),
  idx = r("$index"),
  acc = r("$acc");
const fixtures: any[] = [];
for (const item of source) {
  const id = item.id,
    title = item.key;
  const data: any = {
    a: 10,
    b: 5,
    clock: { $time: 0 },
    selected: -1,
    rotation: 0.3,
    score: 0,
    trials: 600,
    cash: 1000,
    holdings: 0,
  };
  let controls: any[] = [slider("a", "매개변수 a", "/a", 1, 100, data.a)];
  let extra: any[] = [];
  let visual: any = scene(
    title,
    [circle(c(o("mul", a, 4)), 150, 25)],
    "입력과 연결된 좌표를 관찰하세요.",
  );
  let goal = "매개변수와 결과의 관계를 관찰하세요.",
    formula = "",
    question = "입력이 바뀌면 결과를 다시 계산해야 할까요?",
    choices = ["예", "아니요"],
    correct = 0;
  const path = item.path;
  switch (id) {
    case "01": {
      goal = "슬라이더로 부품을 벌려 바퀴·프레임·구동계의 연결을 살펴보세요.";
      controls = [slider("a", "분해 거리", "/a", 0, 100, data.a)];
      visual = scene(
        title,
        [
          circle(c(o("sub", 100, a)), 220, 50, "none"),
          circle(c(o("add", 400, a)), 220, 50, "none"),
          {
            type: "polygon",
            attrs: {
              points: "100,220 200,120 300,220",
              fill: "none",
              stroke: "accent",
              strokeWidth: 4,
            },
          },
          {
            type: "line",
            attrs: {
              x1: c(o("add", 250, a)),
              y1: 120,
              x2: c(o("add", 350, a)),
              y2: 220,
              stroke: "foreground",
              strokeWidth: 5,
            },
          },
          label("앞바퀴", 350, 285),
          label("프레임", 170, 100),
          label("뒷바퀴", 15, 285),
          label("포크", 360, 120),
          circle(250, c(o("sub", 180, a)), 12),
        ],
        goal,
      );
      visual.nodes[0].attrs.stroke = "foreground";
      visual.nodes[1].attrs.stroke = "foreground";
      break;
    }
    case "03": {
      goal =
        "수평 드래그 또는 회전 슬라이더로 나선을 돌려보고 두 가닥을 벌려보세요. 염기는 A–T, G–C로 짝지어집니다.";
      data.a = 20;
      controls = [
        slider("a", "가닥 분리", "/a", 0, 80, 20),
        slider("rotate", "회전", "/rotation", 0, 1, 0.3, 0.01),
      ];
      const nodes: any[] = [];
      for (let i = 0; i < 20; i++) {
        const x = (sign: number) =>
          c(
            o(
              "add",
              250,
              o(
                "mul",
                sign,
                o("add", 50, a),
                o("sin", o("add", i * 0.6, o("mul", r("/rotation"), Math.PI * 2))),
              ),
            ),
          );
        nodes.push(
          {
            type: "line",
            attrs: {
              x1: x(1),
              x2: x(-1),
              y1: 20 + i * 12,
              y2: 20 + i * 12,
              stroke: i % 2 ? "muted" : "accent",
            },
          },
          circle(x(1), 20 + i * 12, 5),
          circle(x(-1), 20 + i * 12, 5, "foreground"),
        );
      }
      nodes.push({
        type: "rect",
        attrs: { x: 0, y: 0, width: 500, height: 300, fill: "none", opacity: 0 },
        dragPath: "/rotation",
      });
      visual = scene(title, nodes, goal);
      break;
    }
    case "04":
    case "06":
    case "07":
    case "15":
      visual = n("visual", "Simulation", {
        title,
        module: id === "06" ? "nBody" : id === "07" ? "cellular" : "agents",
        seed: 42,
        params: { count: 24, size: 24 },
      });
      controls = [];
      goal =
        id === "06"
          ? "중력으로 움직이는 궤도와 전체 에너지를 관찰하세요. 속도를 바꾸어도 물리 시간의 의미는 유지됩니다."
          : id === "07"
            ? "물을 붓고 바닥과 장애물 주변의 이동을 관찰하세요. 리셋은 같은 seed의 상태를 복원합니다."
            : id === "15"
              ? "먹이를 찾는 속성의 분포와 세대별 평균을 관찰하세요. 자원 소비와 돌연변이는 이 단순화된 모형의 가정입니다."
              : "먹이·피식자·포식자가 상호작용하며 개체수 곡선이 변하는 모습을 관찰하세요.";
      formula = "";
      break;
    case "08":
      data.a = 12;
      data.b = 6;
      goal = "전압과 저항을 바꾸며 I=V/R 관계를 확인하세요.";
      formula = "I=\\frac{V}{R}";
      controls = [slider("a", "전압 V", "/a", 0, 24, 12), slider("b", "저항 Ω", "/b", 1, 20, 6)];
      extra = [
        stat("current", "전류", o("div", a, b), "A"),
        n("clock", "Playback", { path: "/clock" }),
      ];
      visual = scene(
        title,
        [
          {
            type: "polyline",
            attrs: {
              points: "80,80 420,80 420,240 80,240 80,80",
              fill: "none",
              stroke: "foreground",
              strokeWidth: 3,
            },
          },
          circle(
            c(
              o(
                "add",
                80,
                o(
                  "mul",
                  340,
                  o(
                    "sub",
                    o("mul", r("/clock/$time"), o("div", a, b)),
                    o("floor", o("mul", r("/clock/$time"), o("div", a, b))),
                  ),
                ),
              ),
            ),
            80,
            8,
          ),
          label("전원 V", 40, 160),
          label("저항 R", 370, 160),
        ],
        goal,
      );
      break;
    case "09": {
      data.a = 30;
      data.b = 0;
      goal = "RPM을 높이고 한 단계씩 피스톤과 크랭크의 위상 관계를 확인하세요.";
      formula = "y=r\\cos(\\theta)+\\sqrt{l^2-r^2\\sin^2(\\theta)}";
      controls = [
        slider("a", "RPM", "/a", 1, 120, 30),
        n("explode", "Checkbox", { label: "부품 분해", value: { path: "/b" } }),
      ];
      data.b = false;
      const theta = o("mul", r("/clock/$time"), o("div", o("mul", a, Math.PI * 2), 60));
      visual = scene(
        title,
        [
          {
            type: "rect",
            attrs: { x: 180, y: 25, width: 140, height: 180, fill: "none", stroke: "foreground" },
          },
          {
            type: "rect",
            attrs: {
              x: 185,
              y: c(
                o(
                  "add",
                  o("add", 40, o("mul", 35, o("cos", theta))),
                  o("sqrt", o("sub", 10000, o("mul", 1225, o("pow", o("sin", theta), 2)))),
                ),
              ),
              width: 130,
              height: 35,
              fill: "accent",
            },
          },
          circle(250, 250, 30, "none"),
          circle(
            c(o("add", 250, o("mul", 30, o("sin", theta)))),
            c(o("add", 250, o("mul", 30, o("cos", theta)))),
            6,
          ),
          label("피스톤", 330, 100),
          label("크랭크", 330, 255),
        ],
        goal,
      );
      visual.nodes[2].attrs.stroke = "foreground";
      visual.nodes[1].attrs.x = c(o("if", b, 350, 185));
      extra = [n("clock", "Playback", { path: "/clock" })];
      break;
    }
    case "10":
      data.a = 420;
      goal =
        "CO₂ 농도를 높여 단순 에너지 평형 모형의 온도 응답을 비교하세요. 관측·예측 자료가 아닌 교육용 모형입니다.";
      controls = [slider("a", "CO₂ ppm", "/a", 280, 840, 420)];
      formula = "\\Delta T=\\lambda\\,5.35\\ln(C/C_0)";
      visual = plot(
        title,
        o(
          "scan",
          0,
          o(
            "add",
            acc,
            o("mul", 0.05, o("sub", o("mul", 0.8 * 5.35, o("log", o("div", a, 280))), acc)),
          ),
          80,
        ),
      );
      break;
    case "13": {
      data.a = 10;
      goal = "고정 seed 가격 경로에서 한 주씩 사고팔며 현금과 보유 자산 합계를 비교하세요.";
      formula = "W=C+qP";
      visual = plot(
        title,
        o("series", 100, o("add", 100, o("mul", a, o("sub", o("rng", 42, idx), 0.5)))),
      );
      const price = o("add", 100, o("mul", a, o("sub", o("rng", 42, 0), 0.5)));
      extra = [
        stat("cash", "현금", r("/cash")),
        stat("holdings", "보유 주식", r("/holdings")),
        stat("wealth", "총 자산", o("add", r("/cash"), o("mul", r("/holdings"), price))),
      ];
      const trade = (buy: boolean) =>
        n(buy ? "buy" : "sell", "Button", {
          label: buy ? "한 주 구매" : "한 주 판매",
          visible: c(buy ? o("gte", r("/cash"), price) : o("gt", r("/holdings"), 0), "boolean"),
          action: {
            functionCall: {
              call: "setValues",
              args: {
                updates: [
                  { path: "/cash", expr: o(buy ? "sub" : "add", r("/cash"), price) },
                  { path: "/holdings", expr: o(buy ? "add" : "sub", r("/holdings"), 1) },
                ],
              },
            },
          },
        });
      controls.push(trade(true), trade(false));
      break;
    }
    case "14": {
      data.a = 2;
      goal = "R₀를 바꿔 감염 정점을 비교하세요. S+I+R=1000 보존량을 확인하세요.";
      controls = [slider("a", "기초재생산수 R₀", "/a", 0.1, 5, 2, 0.1)];
      formula = "\\dot S=-\\beta SI/N,\\quad\\dot I=\\beta SI/N-\\gamma I,\\quad\\dot R=\\gamma I";
      const S = o("get", acc, 0),
        I = o("get", acc, 1),
        R = o("get", acc, 2),
        infection = o("mul", o("mul", 0.1, a), o("mul", S, o("div", I, 1000))),
        recovery = o("mul", 0.1, I);
      const states = o(
        "scan",
        o("array", 999, 1, 0),
        o(
          "array",
          o("sub", S, infection),
          o("sub", o("add", I, infection), recovery),
          o("add", R, recovery),
        ),
        100,
      );
      visual = plot(title, o("map", states, o("get", r("$item"), 1)));
      extra = [stat("conservation", "S+I+R", sum(o("get", states, 100)), "人")];
      break;
    }
    case "16":
      data.a = 5;
      controls = [slider("a", "연이율 %", "/a", 0, 20, 5)];
      goal = "이율을 바꾸고 20년 후 금액을 단리와 비교하세요.";
      formula = "FV=P(1+r)^n";
      visual = plot(title, o("scan", 1000, o("mul", acc, o("add", 1, o("div", a, 100))), 20));
      extra = [
        stat("future", "20년 후", o("mul", 1000, o("pow", o("add", 1, o("div", a, 100)), 20)), ""),
      ].filter(Boolean);
      break;
    case "17": {
      data.a = 600;
      controls = [
        slider("a", "시행 수", "/a", 30, 900, 600, 30),
        button("reset", "시행 초기화", "/a", 30),
      ];
      goal =
        "사회자는 정답을 알고 반드시 염소 문을 엽니다. 고정 seed에서 유지와 변경의 승률을 비교하세요.";
      const wins = sum(o("series", a, o("if", o("lt", o("rng", 42, idx), 1 / 3), 1, 0)));
      visual = n("visual", "StatGroup", { children: ["stay", "switch"] });
      extra = [
        stat("stay", "선택 유지 승률", o("div", wins, a)),
        stat("switch", "선택 변경 승률", o("sub", 1, o("div", wins, a))),
      ];
      data.door = 0;
      data.revealed = false;
      data.finalDoor = -1;
      data.trialIndex = 0;
      const car = o("floor", o("mul", 3, o("rng", 42, r("/trialIndex"))));
      const goat = o(
        "if",
        o("and", o("ne", car, 0), o("ne", r("/door"), 0)),
        0,
        o("if", o("and", o("ne", car, 1), o("ne", r("/door"), 1)), 1, 2),
      );
      for (let door = 0; door < 3; door++)
        controls.push({
          ...button(`door-${door}`, `문 ${door + 1} 선택`, "/door", door),
          disabled: { path: "/revealed" },
        });
      controls.push(
        {
          ...button("reveal", "염소 문 열기", "/revealed", true),
          visible: c(o("not", r("/revealed")), "boolean"),
        },
        {
          ...button("stay-door", "처음 선택 유지", "/finalDoor", r("/door")),
          visible: { path: "/revealed" },
        },
        {
          ...button(
            "switch-door",
            "남은 문으로 변경",
            "/finalDoor",
            o("sub", o("sub", 3, r("/door")), goat),
          ),
          visible: { path: "/revealed" },
        },
      );
      const nextGameAction = {
        functionCall: {
          call: "setValues",
          args: {
            updates: [
              { path: "/door", value: 0 },
              { path: "/revealed", value: false },
              { path: "/finalDoor", value: -1 },
              { path: "/trialIndex", expr: o("add", r("/trialIndex"), 1) },
            ],
          },
        },
      };
      controls.push(n("next-game", "Button", { label: "새 게임", action: nextGameAction }));
      extra.push(
        n("opened", "Text", {
          visible: { path: "/revealed" },
          text: c(o("format", "진행자가 {0}번 염소 문을 열었습니다.", o("add", goat, 1)), "string"),
        }),
        n("game-result", "Text", {
          visible: c(o("gte", r("/finalDoor"), 0), "boolean"),
          text: c(
            o(
              "if",
              o("eq", car, r("/finalDoor")),
              "자동차 당첨!",
              "이번에는 염소입니다. 새 게임을 해보세요.",
            ),
            "string",
          ),
        }),
      );
      formula = "P(\\mathrm{stay})=1/3,\\quad P(\\mathrm{switch})=2/3";
      break;
    }
    case "18": {
      data.a = 1;
      controls = [slider("a", "표준편차 σ", "/a", 0.5, 3, 1, 0.1)];
      goal = "표준편차를 바꾸면서 밀도 곡선과 ±1σ 구간의 면적을 비교하세요.";
      formula = "f(x)=exp(-x²/(2σ²))/(σ√(2π))";
      const pdf = (x: any) =>
        o(
          "div",
          o("exp", o("mul", -0.5, o("pow", o("div", x, a), 2))),
          o("mul", a, Math.sqrt(2 * Math.PI)),
        );
      visual = plot(title, o("series", 121, pdf(o("sub", o("div", idx, 10), 6))), "area");
      const midpoint = o("mul", a, o("add", -1, o("mul", 0.02, o("add", idx, 0.5))));
      extra = [
        stat(
          "probability",
          "±1σ 확률 (중점 적분)",
          o("mul", o("mul", 0.02, a), sum(o("series", 100, pdf(midpoint)))),
        ),
      ];
      break;
    }
    case "19":
      data.a = 1;
      controls = [slider("a", "진동수 a", "/a", 0.1, 5, 1, 0.1)];
      goal = "진동수가 증가할 때 주기와 원점 접선 기울기의 관계를 관찰하세요.";
      formula = "f(x)=\\sin(ax),\\quad f'(0)=a";
      visual = plot(title, o("series", 100, o("sin", o("mul", o("div", idx, 10), a))));
      extra = [
        n("annotation", "Annotation", { text: "원점에서 접선의 기울기는 a입니다." }),
        stat("slope", "접선 기울기", a),
      ];
      break;
    case "20": {
      data.a = 63001;
      data.b = 3;
      controls = [
        slider("a", "총 금액", "/a", 1000, 100000, 63001),
        slider("b", "첫 사람의 몫 (나머지 1:1)", "/b", 1, 6, 3),
      ];
      goal = "몫을 바꾸면서 반올림 잔액까지 총액이 보존되는지 확인하세요.";
      const first = o("floor", o("mul", a, o("div", b, o("add", b, 2)))),
        second = o("floor", o("div", a, o("add", b, 2))),
        third = o("sub", o("sub", a, first), second);
      visual = n("visual", "StatGroup", { children: ["person1", "person2", "person3"] });
      extra = [
        stat("person1", "사람 1", first, "원"),
        stat("person2", "사람 2", second, "원"),
        stat("person3", "사람 3 (잔액 포함)", third, "원"),
      ];
      formula = "\\mathrm{share}_i=T\\,w_i/\\sum w";
      break;
    }
    case "21":
      goal = "키보드 Tab과 Enter 또는 터치로 별을 잡으세요. 점수가 올라가면 목표 위치가 바뀝니다.";
      visual = scene(
        title,
        [
          { type: "rect", attrs: { x: 0, y: 0, width: 500, height: 300, fill: "surface" } },
          circle(
            c(o("add", 40, o("mul", 420, o("rng", 42, r("/score"))))),
            c(o("add", 40, o("mul", 220, o("rng", 43, r("/score"))))),
            18,
            "accent",
            { action: action("/score", o("add", r("/score"), 1)) },
          ),
        ],
        goal,
      );
      controls = [
        button("catch", "별 잡기", "/score", o("add", r("/score"), 1)),
        button("reset", "게임 초기화", "/score", 0),
      ];
      extra = [stat("score", "점수", r("/score"))];
      formula = "";
      break;
    case "22":
    case "H-04":
      visual = n("visual", "RouteMap", {
        title,
        points: [
          { label: "서울역", x: 126.9706, y: 37.5547 },
          { label: "남산", x: 126.9918, y: 37.5512 },
          { label: "경복궁", x: 126.977, y: 37.5796 },
        ],
        approximate: true,
        verifyAction: { event: { name: "verifyRoute" } },
      });
      controls = [];
      goal = "좌표는 개략 표시입니다. 출발 전에 호스트 지도에서 위치와 경로를 확인하세요.";
      extra = [
        n("timeline", "Timeline", {
          items: [
            { label: "09:00 서울역", detail: "출발" },
            { label: "11:00 남산", detail: "산책" },
            { label: "14:00 경복궁", detail: "관람" },
          ],
        }),
      ];
      break;
    case "H-05":
      data.a = 63000;
      data.b = 3;
      visual = n("visual", "Stat", { label: "1인 금액", value: c(o("div", a, b)), unit: "원" });
      controls = [
        slider("a", "총 금액", "/a", 1000, 100000, 63000, 1000),
        slider("b", "인원", "/b", 1, 12, 3),
      ];
      goal = "같은 금액으로 나눕니다. 다른 몫과 세금은 포함하지 않습니다.";
      formula = "\\mathrm{share}=T/n";
      break;
  }
  if (typeof extra[0] === "string") extra = [];
  const questions: Record<string, [string, string[], number]> = {
    "08": ["전압을 두 배로, 저항은 그대로 두면 전류는?", ["두 배", "절반"], 0],
    "14": ["이 모형에서 감염이 퍼져도 변하지 않는 값은?", ["S+I+R", "감염자 I"], 0],
    "16": [
      "복리에서 같은 이율로 시간이 늘면 이자의 기준 금액은?",
      ["누적된 원금과 이자", "처음 원금만"],
      0,
    ],
    "17": [
      "사회자가 항상 염소 문을 열 때 유리한 전략은?",
      ["문을 바꾼다", "항상 처음 문을 유지한다"],
      0,
    ],
    "18": ["표준편차가 커질 때 정규분포의 정점 높이는?", ["낮아진다", "높아진다"], 0],
    "20": ["반올림 잔액까지 나눌 때 금액 합계는?", ["원래 총액", "반드시 총액보다 작다"], 0],
    "13": ["같은 가격으로 사고판 직후 총 자산은?", ["변하지 않는다", "한 주 가격만큼 증가한다"], 0],
  };
  if (questions[id]) [question, choices, correct] = questions[id]!;
  const quiz = n("quiz", "Quiz", {
    prompt: question,
    choices,
    correctIndex: correct,
    explanation: goal,
    value: { path: "/selected" },
  });
  const body = [
    n("heading", "Heading", { text: title }),
    n("goal", "Text", { text: goal }),
    ...(controls.length
      ? [n("workspace", "Grid", { columns: 2, children: [visual.id, "controls"] })]
      : [visual]),
    ...extra.filter((component) => !visual.children?.includes(component.id)),
    n("observe", "Callout", { tone: "observe", title: "관찰할 점", text: goal }),
    ...(formula ? [n("formula", "Formula", { latex: formula, meaning: goal })] : []),
    n("note", "Callout", {
      tone: "model-note",
      title: "모형의 가정",
      text: "교육용 단순화입니다. 외부 데이터·전문 판단·실제 물리 예측을 대신하지 않습니다.",
    }),
    quiz,
  ];
  const components = [
    n("root", "Column", { children: body.map((x) => x.id) }),
    ...body,
    ...(controls.length
      ? [
          visual,
          n("controls", "ControlPanel", {
            title: "직접 바꿔보기",
            children: controls.map((x) => x.id),
          }),
        ]
      : []),
    ...extra.filter((component) => visual.children?.includes(component.id)),
    ...controls,
  ];
  let wire: any[] = [
    { engine: "v1", block: "surface", surfaceId: "main", fallbackText: `${title}: ${goal}`, title },
    { version: "v0.9", createSurface: { surfaceId: "main", catalogId: CATALOG_ID } },
    { version: "v0.9", updateDataModel: { surfaceId: "main", value: data } },
    { version: "v0.9", updateComponents: { surfaceId: "main", components } },
  ];
  const media = (ids: string[], layout: string, markdown: string, placement = "right") => ({
    engine: "v1",
    block: "media",
    attachments: ids,
    layout,
    markdown,
    placement,
    mediaFraction: 0.45,
  });
  if (id === "H-01")
    wire = [
      media(
        ["photo-a", "photo-b"],
        "carousel",
        "## 사진 비교\n좌우 스와이프나 이전·다음 버튼으로 사진을 비교하세요. 사진의 의미는 호스트가 제공한 설명만 사용합니다.",
        "left",
      ),
    ];
  if (id === "H-02") {
    wire = [
      media(
        ["file-a"],
        "files",
        "## PDF 핵심 수치\n호스트가 제공한 추출값: 2024년 120, 2025년 150. 변화율은 25%입니다. 원본 파일에서 단위와 범위를 확인하세요.",
      ),
      ...wire,
    ];
    const update = wire.at(-1);
    update.updateComponents.components = [
      n("root", "Column", { children: ["heading", "chart", "stat"] }),
      n("heading", "Heading", { text: "호스트 추출 수치" }),
      n("chart", "Chart", {
        kind: "bar",
        title: "연도별 매출",
        values: [
          { year: "2024", value: 120 },
          { year: "2025", value: 150 },
        ],
        xKey: "year",
        yKey: "value",
      }),
      n("stat", "Stat", { label: "증가율", value: 25, unit: "%" }),
    ];
  }
  if (id === "H-03") {
    wire = [
      media(
        ["video-a"],
        "player",
        "## 영상 챕터\n호스트 타임스탬프를 누르면 해당 위치로 이동합니다. 소리 있는 자동 재생은 사용하지 않습니다.",
        "above",
      ),
    ];
  }
  if (id === "H-04")
    wire = [
      media(
        ["photo-a", "photo-b"],
        "carousel",
        "## 여행 팁\n사진을 넘기며 방문 장소를 확인하세요. 아래 경로는 개략 좌표이며 운영 시간은 별도 확인이 필요합니다.",
        "left",
      ),
      ...wire,
    ];
  if (id === "H-05")
    wire.unshift(
      "## 계산 가정\n금액은 원 단위, 모두 같은 몫입니다. 계산은 이 화면에서 즉시 실행합니다.",
    );
  if (id === "H-06") wire = ["프랑스의 수도는 파리입니다."];
  if (id === "H-07")
    wire = [
      "```javascript\nconst unique = [...new Set(items)];\n```\n원시값 배열의 중복을 첫 등장 순서대로 제거합니다.",
    ];
  if (path === "C") {
    wire = [
      {
        engine: "v1",
        block: "sandbox",
        mode: "app",
        source: sandboxSource(id, title),
        fallbackText: `${title}. 검증된 웹 샌드박스가 필요합니다.`,
      },
    ];
  }
  fixtures.push({
    id,
    title,
    path,
    promptKo: item.prompts.ko,
    promptEn: item.prompts.en,
    wire: wire.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n") + "\n",
    acceptance: "implemented replay; domain, browser and numerical checks are recorded separately",
  });
}
function sandboxSource(id: string, title: string) {
  const start = `<h1>${title}</h1><p>교육용 단순화 모형 · 외부 데이터 없음</p>`;
  if (id === "02")
    return (
      start +
      `<label>Mass<input id="mass" type="range" min="1" max="10" value="3"></label><label>Spin<input id="spin" type="range" min="0" max="99" value="30"></label><output id="out"></output><canvas id="c" width="480" height="240"></canvas><script>function render(){const m=+mass.value,s=+spin.value/100,r=m*(1+Math.sqrt(1-s*s));out.textContent='Horizon radius (GM/c²) '+r.toFixed(3);const x=c.getContext('2d');x.clearRect(0,0,480,240);x.fillStyle='#17212b';x.fillRect(0,0,480,240);x.strokeStyle='#ffa448';for(let i=0;i<7;i++){x.beginPath();x.ellipse(240,120,40+r*5+i*9,15+i*5,s,0,7);x.stroke();}x.fillStyle='#000';x.beginPath();x.arc(240,120,r*5,0,7);x.fill();}mass.oninput=spin.oninput=render;render();</script>`
    );
  if (id === "05" || id === "12")
    return (
      start +
      `<button id="step">Next turn</button><button id="reset">Reset</button><output id="out"></output><div id="map" style="display:grid;grid-template-columns:repeat(8,32px);gap:2px"></div><ol id="events"></ol><script>let turn=0,food=20,people=5,gold=10;function render(){out.textContent='Turn '+turn+' · Food '+food+' · People '+people+' · Economy '+gold;map.replaceChildren();for(let i=0;i<64;i++){let e=document.createElement('span');e.textContent=i<people?'🏠':i%4===0?'🌾':'·';e.style.minHeight='32px';map.append(e);}}step.onclick=()=>{turn++;food+=people*2-people;gold+=people;if(turn%3===0&&food>people*2){people++;food-=people;}let e=document.createElement('li');e.textContent=turn%3===0?'Settlement expanded':'Harvest and trade';events.prepend(e);while(events.children.length>10)events.lastChild.remove();render();};reset.onclick=()=>{turn=0;food=20;people=5;gold=10;events.replaceChildren();render();};render();</script>`
    );
  if (id === "11")
    return (
      start +
      `<label>Food patches<input id="food" type="range" min="1" max="8" value="3"></label><button id="step">Forage</button><button id="reset">Reset colony</button><output id="out"></output><canvas id="c" width="480" height="240"></canvas><script>let ants=8,stored=0,turn=0;function render(){out.textContent='Ants '+ants+' · Stored food '+stored+' · Turn '+turn;const x=c.getContext('2d');x.clearRect(0,0,480,240);for(let i=0;i<ants;i++){x.fillStyle='#17212b';x.beginPath();x.arc(240+Math.cos(i+turn)*Math.min(100,i*3),120+Math.sin(i+turn)*Math.min(80,i*2),3,0,7);x.fill();}x.fillStyle='#165cff';for(let i=0;i<+food.value;i++)x.fillRect(i*50+30,20,8,8);}step.onclick=()=>{turn++;stored+=Math.min(ants,+food.value*3);if(stored>=20&&ants<64){stored-=20;ants++;}render();};reset.onclick=()=>{ants=8;stored=0;turn=0;render();};food.oninput=render;render();</script>`
    );
  return (
    start +
    `<button id="step">Step particles</button><button id="reset">Reset</button><output id="out"></output><canvas id="c" width="480" height="240"></canvas><script>let t=0;function render(){out.textContent='Frame '+t;const x=c.getContext('2d');x.clearRect(0,0,480,240);for(let i=0;i<40;i++){x.fillStyle=i%2?'#165cff':'#17212b';x.beginPath();x.arc(240+Math.cos(i+t*.1)*i*3,120+Math.sin(i+t*.1)*i*2,4,0,7);x.fill();}}step.onclick=()=>{t++;render();};reset.onclick=()=>{t=0;render();};render();</script>`
  );
}
writeFileSync("fixtures/showcase/cases.json", JSON.stringify(fixtures, null, 2) + "\n");
