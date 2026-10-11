import { writeFileSync } from "node:fs";
import { compileSvg } from "../packages/core/src/svg.js";

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 440">${body}</svg>`;
const path = (d: string, stroke = "foreground", width = 3, fill = "none") =>
  `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const wheel = (cx: number) =>
  `<circle cx="${cx}" cy="290" r="89" fill="surface" stroke="foreground" stroke-width="7"/><circle cx="${cx}" cy="290" r="79" fill="none" stroke="muted" stroke-width="2"/>${Array.from(
    { length: 16 },
    (_, i) => {
      const t = (i * Math.PI) / 8;
      return `<line x1="${cx}" y1="290" x2="${(cx + 79 * Math.cos(t)).toFixed(2)}" y2="${(290 + 79 * Math.sin(t)).toFixed(2)}" stroke="border" stroke-width="1"/>`;
    },
  ).join("")}<circle cx="${cx}" cy="290" r="8" fill="muted"/>`;
export const sceneNames: Record<string, string> = {
  "01": "자전거를 이루는 부품",
  "03": "DNA의 구조와 염기쌍",
  "08": "전압·저항·전류",
  "09": "피스톤과 크랭크의 움직임",
  "18": "정규분포의 모양과 확률",
  "16": "시간이 만드는 복리",
  "06": "태양계의 중력",
  "02": "블랙홀의 사건 지평선",
};
export function upgradedScene(id: string, data: any) {
  let source = "",
    parts: Record<string, any> = {};
  const move = (name: string, label: string, x: number, y: number) => {
    parts[name] = {
      label,
      explode: { path: "/a", x: x / 100, y: y / 100 },
      action: { functionCall: { call: "setValue", args: { path: "/selectedPart", value: label } } },
    };
  };
  if (id === "06") {
    const fn = (op: string, ...args: any[]) => ({ op, args });
    const bind = (expr: any) => ({ call: "computeNumber", returnType: "number", args: { expr } });
    const planets: [string, number, number, number][] = [
      ["Mercury", 52, 4, 88],
      ["Venus", 80, 6, 225],
      ["Earth", 112, 7, 365],
      ["Mars", 143, 5, 687],
      ["Jupiter", 193, 14, 4333],
      ["Saturn", 247, 12, 10759],
      ["Uranus", 291, 9, 30687],
      ["Neptune", 329, 8, 60190],
    ];
    source = svg(
      '<circle cx="380" cy="220" r="25" fill="accent"/><text x="380" y="262" fill="foreground" text-anchor="middle" font-size="15">태양 / Sun</text>' +
        planets
          .map(([name, radius, size, period]) => {
            const phase = fn("mul", { ref: "/clock/time" }, (365 / period) * 0.1);
            parts[name] = {
              label: name,
              attributes: {
                cx: bind(fn("add", 380, fn("mul", radius, fn("cos", phase)))),
                cy: bind(fn("add", 220, fn("mul", radius * 0.52, fn("sin", phase)))),
              },
              action: {
                functionCall: { call: "setValue", args: { path: "/selectedPart", value: name } },
              },
            };
            return `<ellipse cx="380" cy="220" rx="${radius}" ry="${radius * 0.52}" fill="none" stroke="border" stroke-width="1"/><circle id="${name}" cx="${380 + radius}" cy="220" r="${size}" fill="${name === "Earth" ? "success" : "foreground"}"/>`;
          })
          .join(""),
    );
    data.selectedPart = "Earth";
    data.clock = { time: 0, running: false, speed: 1 };
  }
  if (id === "01") {
    source = svg(
      `<g id="rearWheel">${wheel(225)}</g><g id="frontWheel">${wheel(540)}</g><g id="frame">${path("M225 290 L310 158 L370 290 Z M310 158 L480 158 L370 290", "accent", 13)}${path("M225 290 L310 158 L370 290 Z M310 158 L480 158 L370 290", "surface", 3)}</g><g id="fork">${path("M475 132 L490 204 L540 290", "foreground", 7)}${path("M488 140 L507 209 L552 281", "muted", 3)}</g><g id="stem">${path("M475 140 L464 94 L504 86", "foreground", 7)}</g><g id="handlebar">${path("M504 86 C550 62 585 89 568 112 L548 126", "foreground", 8)}${path("M548 126 L560 134", "accent", 9)}</g><g id="seatpost">${path("M310 158 L297 112", "foreground", 7)}</g><g id="saddle">${path("M271 100 C284 93 305 92 336 99 L333 111 L284 113 Z", "foreground", 2, "foreground")}</g><g id="crank"><circle cx="370" cy="290" r="27" fill="surface" stroke="foreground" stroke-width="4"/><circle cx="370" cy="290" r="19" fill="none" stroke="muted"/>${path("M370 290 L403 316", "foreground", 6)}</g><g id="pedal"><rect x="394" y="310" width="28" height="10" rx="3" fill="accent"/></g><g id="chain">${path("M225 278 L370 263 Q395 290 370 317 L225 302 Q211 290 225 278", "muted", 3)}</g><g id="cassette"><circle cx="225" cy="290" r="15" fill="none" stroke="muted" stroke-width="3"/><circle cx="225" cy="290" r="10" fill="none" stroke="foreground"/></g><g id="brake">${path("M210 212 Q225 196 240 212 M526 210 Q540 196 554 210", "muted", 4)}</g>`,
    );
    for (const row of [
      ["rearWheel", "뒷바퀴", -100, 55],
      ["frontWheel", "앞바퀴", 100, 55],
      ["frame", "프레임", 0, 0],
      ["fork", "포크", 65, -5],
      ["stem", "스템", 45, -45],
      ["handlebar", "핸들바", 80, -55],
      ["seatpost", "시트포스트", -35, -40],
      ["saddle", "안장", -40, -70],
      ["crank", "크랭크", 5, 72],
      ["pedal", "페달", 50, 90],
      ["chain", "체인", -30, 65],
      ["cassette", "스프라켓", -65, 70],
      ["brake", "브레이크", 10, -45],
    ] as [string, string, number, number][])
      move(...row);
    data.selectedPart = "프레임";
  }
  if (id === "09") {
    source = svg(
      `<g id="block"><rect x="275" y="60" width="200" height="176" rx="12" fill="surface" stroke="border" stroke-width="12"/><rect x="307" y="87" width="136" height="142" rx="3" fill="background" stroke="muted" stroke-width="3"/>${path("M275 98 L244 98 M475 98 L509 98", "muted", 9)}</g><g id="head">${path("M265 60 L265 41 L485 41 L485 60", "foreground", 7)}${path("M335 43 L335 23 M415 43 L415 23", "accent", 6)}</g><g id="piston"><rect x="314" y="114" width="122" height="53" rx="5" fill="surface" stroke="foreground" stroke-width="4"/>${path("M316 126 L434 126 M316 138 L434 138", "muted", 3)}<circle cx="375" cy="156" r="8" fill="accent"/></g><g id="rod"><line id="rodShaft" x1="375" y1="156" x2="375" y2="282" stroke="foreground" stroke-width="18" stroke-linecap="round"/><line id="rodHighlight" x1="375" y1="156" x2="375" y2="282" stroke="surface" stroke-width="8" stroke-linecap="round"/></g><g id="crank"><circle cx="375" cy="324" r="64" fill="none" stroke="border" stroke-width="12"/>${path("M375 324 L375 282", "foreground", 22)}<circle cx="375" cy="324" r="10" fill="muted"/></g><g id="plug">${path("M375 25 L375 52", "accent", 9)}</g>`,
    );
    data.rpm = 1200;
    data.angle = 0;
    move("block", "실린더", -90, 0);
    move("head", "실린더 헤드", 0, -24);
    move("piston", "피스톤", 65, 0);
    move("rod", "커넥팅 로드", 90, 0);
    move("crank", "크랭크축", -80, 0);
    move("plug", "점화 플러그", 0, -45);
    const angle = { op: "mul", args: [{ ref: "/clock/$time" }, { ref: "/rpm" }, Math.PI / 30] };
    const calc = (expr: any) => ({ call: "computeNumber", returnType: "number", args: { expr } });
    const sin = { op: "sin", args: [angle] },
      cos = { op: "cos", args: [angle] };
    const pin = {
      op: "sub",
      args: [
        { op: "sub", args: [324, { op: "mul", args: [42, cos] }] },
        {
          op: "sqrt",
          args: [
            {
              op: "sub",
              args: [16900, { op: "mul", args: [1764, { op: "pow", args: [sin, 2] }] }],
            },
          ],
        },
      ],
    };
    parts.piston.transforms = [{ kind: "translate", y: calc({ op: "sub", args: [pin, 156] }) }];
    const attributes = {
      x1: 375,
      y1: calc(pin),
      x2: calc({ op: "add", args: [375, { op: "mul", args: [42, sin] }] }),
      y2: calc({ op: "sub", args: [324, { op: "mul", args: [42, cos] }] }),
    };
    parts.rodShaft = { attributes };
    parts.rodHighlight = { attributes };
    parts.crank.transforms = [
      {
        kind: "rotate",
        angle: calc({ op: "mul", args: [{ ref: "/clock/$time" }, { ref: "/rpm" }, 6] }),
        cx: 375,
        cy: 324,
      },
    ];
    data.selectedPart = "피스톤";
  }
  if (id === "08") {
    source = svg(
      `<g id="wiring">${path("M165 225 L165 100 L335 100 M425 100 L600 100 L600 320 L165 320 L165 225", "muted", 4)}</g><g id="battery">${path("M140 185 L190 185", "foreground", 5)}${path("M150 215 L180 215", "foreground", 5)}<text x="113" y="182" fill="accent" font-size="20">+</text><text x="117" y="220" fill="muted" font-size="20">−</text></g><g id="resistor">${path("M335 100 L346 85 L361 115 L377 85 L393 115 L408 85 L425 100", "accent", 5)}</g><g id="ammeter"><circle cx="600" cy="220" r="28" fill="surface" stroke="foreground" stroke-width="3"/><text x="600" y="227" text-anchor="middle" fill="foreground" font-size="21">A</text></g><g id="charge"><circle cx="230" cy="100" r="7" fill="accent"/><path d="M255 92 L270 100 L255 108" fill="none" stroke="accent" stroke-width="3"/></g><text x="380" y="63" fill="muted" text-anchor="middle" font-size="16">R · 저항</text><text x="155" y="365" fill="muted" font-size="16">V · 전압</text>`,
    );
    data.selectedPart = "저항";
    parts.resistor = {
      label: "저항",
      action: {
        functionCall: { call: "setValue", args: { path: "/selectedPart", value: "저항" } },
      },
    };
    parts.charge = {
      transforms: [
        {
          kind: "translate",
          x: {
            call: "computeNumber",
            returnType: "number",
            args: { expr: { op: "mul", args: [15, { ref: "/a" }] } },
          },
        },
      ],
    };
  }
  if (!source) return null;
  const result = compileSvg(source, {
    title: sceneNames[id],
    description: "부품을 선택하거나 컨트롤을 조작해 구조와 움직임을 확인하세요.",
    parts,
  });
  writeFileSync(`fixtures/showcase/assets/${id}.svg`, source + "\n");
  return { id: "visual", component: "SvgScene", ...result.scene };
}
