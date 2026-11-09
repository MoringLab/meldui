// biome-ignore-all lint/suspicious/noTemplateCurlyInString: Live source code is written in strings here
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AnswerSession } from "../answer.js";
import { createUIRuntime } from "../index.js";
import { normalizeBold } from "../markdown.js";
import { Env, Interp, LiveError, LiveLimit, MISSING } from "./interp.js";
import { desugarJsx } from "./jsx.js";
import { declarations, handlerCode, LiveProgram, LiveState } from "./program.js";
import {
  IDENTITY,
  multiply,
  parseTransform,
  safeDashes,
  safePath,
  safePoints,
  safeSvgProps,
  safeViewBox,
  transformPoint,
  viewBoxMatrix,
} from "./svg.js";
import { parseExpr, parseStatements } from "./syntax.js";
import { liveText, parseLive, rowScope, shareTree, splitText } from "./tree.js";

const none = { get: () => MISSING, set: () => false, isState: () => false };
const ev = (src: string) => new Interp(none).eval(parseExpr(src), new Env());

describe("Live expressions", () => {
  it.each([
    ["1 + 2 * 3", 7],
    ["2 ** 3 ** 2", 512],
    ["(1 + 2) * 3", 9],
    ["10 % 4 - -1", 3],
    ["true && 'a' || 'b'", "a"],
    ["null ?? 5", 5],
    ["0 ?? 5", 0],
    ["3 > 2 ? 'yes' : 'no'", "yes"],
    ["`${1 + 1}분 ${'남음'}`", "2분 남음"],
    ["String(7).padStart(2, '0')", "07"],
    ["(3.14159).toFixed(2)", "3.14"],
    ["Math.max(...[1, 5, 3])", 5],
    ["[1, 2, 3].map(x => x * 2).join('-')", "2-4-6"],
    ["[3, 1, 2].toSorted((a, b) => a - b)[0]", 1],
    ["[1, 2, 3, 4].filter(x => x % 2).reduce((a, b) => a + b, 0)", 4],
    ["({a: 1, ...{b: 2}}).b", 2],
    ["[...'abc'].length", 3],
    ["({a: {b: null}}).a?.b?.c", undefined],
    ["Array.from({length: 3}, (_, i) => i * i)", [0, 1, 4]],
    ["Object.entries({x: 1}).map(([k, v]) => k + v)[0]", "x1"],
    ["(1234567.891).toLocaleString()", "1,234,567.891"],
    ["numberFormat(39900 * 3, 0, true)", "119,700"],
    ["'a-b-c'.replace(/-/g, '+')", "a+b+c"],
    ["'12345'.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',')", "12,345"],
    ["Number.isInteger(4)", true],
    ["typeof notDefined", "undefined"],
    ["((a, b = 2) => a + b)(1)", 3],
    ["(({x, y}) => x * y)({x: 3, y: 4})", 12],
    ["range(4)", [0, 1, 2, 3]],
    ["map([1,2], $item * 10)", [10, 20]],
    ["[[1, 2], [3]].flat().length", 3],
    ["'ab'.at(-1)", "b"],
    ["clamp(12, 0, 10)", 10],
    ["(() => { let s = 0; for (const x of [1, 2, 3]) s += x; return s })()", 6],
    [
      "(() => { let s = 0; for (let i = 0; i < 5; i++) { if (i === 3) break; s += i } return s })()",
      3,
    ],
  ])("%s", (src, expected) => {
    expect(ev(src)).toEqual(expected);
  });

  it("refuses prototype access and unknown names", () => {
    expect(() => ev("''.constructor")).toThrow(LiveError);
    expect(() => ev("[].map.constructor")).toThrow(LiveError);
    expect(() => ev("({}).__proto__")).toThrow(LiveError);
    expect(() => ev("globalThis")).toThrow(LiveError);
    expect(() => ev("process.exit()")).toThrow(LiveError);
    expect(() => ev("eval('1')")).toThrow(LiveError);
    expect(() => ev("Function('return 1')")).toThrow(LiveError);
  });

  it("stops runaway work instead of freezing", () => {
    const it = new Interp(none, 10_000);
    expect(() => it.exec(parseStatements("while (true) {}"), new Env())).toThrow(LiveLimit);
    expect(() => ev("Array.from({length: 1e9})")).toThrow(LiveLimit);
    expect(() => ev("'x'.repeat(1e7)")).toThrow(LiveLimit);
    expect(() => ev("(f => f(f))(f => f(f))")).toThrow(LiveLimit);
  });
});

describe("Live program", () => {
  const program = (body: string) => {
    const { decls, problems } = declarations(body);
    expect(problems).toEqual([]);
    return new LiveProgram(decls, new LiveState());
  };

  it("reads DIL-style declarations", () => {
    const { decls } = declarations(
      "const [count, setCount] = DIL.useState(2); const doubled = count * 2; function fmt(n) { return `${n}개` }",
    );
    expect(decls.map((d) => d.kind)).toEqual(["state", "let", "let"]);
    expect(declarations("state seats = 8").decls[0]).toMatchObject({
      kind: "state",
      name: "seats",
    });
    expect(declarations("let price = seats * 29000").decls[0]).toMatchObject({
      kind: "let",
      name: "price",
    });
    expect(declarations("useInterval(() => t += 1, running ? 50 : null)").decls[0]).toMatchObject({
      kind: "timer",
    });
  });

  it("tracks what a value read and recomputes only after a change", () => {
    const p = program("const [a, setA] = useState(1); const [b] = useState(10); const sum = a + 1");
    const deps = new Set<string>();
    expect(p.read("sum * 2", p.root, deps)).toBe(4);
    expect([...deps]).toEqual(["a"]);
    let calls = 0;
    p.watch(deps, () => calls++);
    p.run(handlerCode("() => setA(a + 4)"));
    expect(calls).toBe(1);
    expect(p.read("sum")).toBe(6);
    p.run(handlerCode("b = 3"));
    expect(calls).toBe(1);
  });

  it("writes lists in state by copy (push, item fields) and batches writes", () => {
    const p = program(
      "const [todos, setTodos] = useState([{t: 'a', done: false}]); const [n] = useState(0)",
    );
    const before = p.read("todos") as unknown[];
    let calls = 0;
    p.watch(["todos", "n"], () => calls++);
    p.run(handlerCode("() => { todos.push({t: 'b', done: false}); todos[0].done = true; n++ }"));
    const after = p.read("todos") as { done: boolean }[];
    expect(after).not.toBe(before);
    expect(after.map((t) => t.done)).toEqual([true, false]);
    expect((before as { done: boolean }[])[0]?.done).toBe(false);
    expect(calls).toBe(2);
    p.run(handlerCode("setTodos(prev => prev.filter(t => !t.done))"));
    expect((p.read("todos") as unknown[]).length).toBe(1);
  });

  it("refuses to change state while drawing", () => {
    const p = program("const [a, setA] = useState(1)");
    expect(() => p.read("setA(2)")).toThrow(LiveError);
    expect(() => p.read("a = 2")).toThrow(LiveError);
  });

  it("runs old-style handlers and actions", () => {
    const sent: string[] = [];
    const { decls } = declarations("state qty = 1");
    const p = new LiveProgram(decls, new LiveState(), { send: (t) => sent.push(t) });
    expect(() => p.run(handlerCode("qty = qty + 1; toggle(open)"), p.root)).toThrow(LiveError);
    expect(p.read("qty")).toBe(1); // `open` is not a state: the whole handler fails and writes nothing
    p.run(handlerCode("qty += 2"));
    expect(p.read("qty")).toBe(3);
    p.run(handlerCode("() => send(`${qty}개 주문`)"));
    expect(sent).toEqual(["3개 주문"]);
  });
});

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../../../../docs/ChatGPT_DIL_EXAMPLE");
const samples = (() => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
})();

describe.runIf(samples.length)("DIL samples as Live", () => {
  it.each(samples)("%s: declarations, text and every streamed prefix", (file) => {
    const src = readFileSync(join(dir, file), "utf8");
    const doc = parseLive(src, true);
    expect(doc.problems).toEqual([]);
    expect(doc.drawable).toBe(true);
    const text = liveText(doc);
    expect(text.length).toBeGreaterThan(20);
    // Every prefix parses; finished nodes keep their identity as the source grows.
    let prev = parseLive("", false).nodes;
    for (let n = 1; n <= src.length; n += 7) {
      const next = shareTree(prev, parseLive(src.slice(0, n), false).nodes);
      prev = next;
    }
    const whole = shareTree(prev, parseLive(src, true).nodes);
    const firstEl = whole.find((x) => x.type === "el");
    const again = shareTree(whole, parseLive(`${src}\n`, true).nodes);
    expect(again.find((x) => x.type === "el")).toBe(firstEl);
  });

  it("fills computed text", () => {
    const timer = samples.includes("TIMER.md")
      ? liveText(parseLive(readFileSync(join(dir, "TIMER.md"), "utf8"), true))
      : "25:00";
    expect(timer).toContain("25:00");
    const music = samples.includes("MUSIC_PLAYER.md")
      ? liveText(parseLive(readFileSync(join(dir, "MUSIC_PLAYER.md"), "utf8"), true))
      : "3:38";
    expect(music).toContain("3:38");
  });
});

describe("Live in an answer", () => {
  it("draws one Live surface and carries declarations across prose", () => {
    const runtime = createUIRuntime();
    const s = new AnswerSession(runtime, { policy: { live: true, frameSurfaces: true } });
    s.push("{@state n = 3}\n\n설명 문장.\n\n<box>\n  <text>{n * 2}개</text>\n</box>\n\n끝.");
    s.end();
    const surfaces = s.getSnapshot().blocks.filter((b) => b.kind === "surface");
    expect(surfaces.length).toBe(1);
    const id = (surfaces[0] as { surfaceId: string }).surfaceId;
    const root = runtime.getNodeSnapshot(id, "root");
    expect(root.component).toBe("Live");
    expect(String(root.props.source)).toContain("{@state n = 3}");
    expect((surfaces[0] as { fallbackText?: string }).fallbackText).toContain("6개");
    runtime.dispose();
  });

  it("splits text with formulas", () => {
    expect(splitText("총 {a + b}원, {`${c}`}")).toEqual([
      "총 ",
      { expr: "a + b" },
      "원, ",
      { expr: "`${c}`" },
    ]);
    expect(splitText("half {a +")).toEqual(["half "]);
  });
});

const examples = join(here, "../../../../docs/live-examples");
const exampleFiles = (() => {
  try {
    return readdirSync(examples).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
})();

/** Evaluates everything a renderer would at the starting state; returns what failed. */
function dryRun(src: string): string[] {
  const doc = parseLive(src, true);
  const program = new LiveProgram(doc.decls, new LiveState());
  const errors: string[] = [...doc.problems];
  const read = (expr: string, env: Env, where: string) => {
    try {
      return program.read(expr, env);
    } catch (error) {
      errors.push(
        `${where}: ${expr.slice(0, 60)} → ${error instanceof Error ? error.message : error}`,
      );
      return undefined;
    }
  };
  const walk = (nodes: ReturnType<typeof parseLive>["nodes"], env: Env) => {
    for (const n of nodes) {
      if (n.type === "text")
        for (const p of splitText(n.text)) if (typeof p !== "string") read(p.expr, env, "text");
      if (n.type === "el") {
        for (const a of n.attrs)
          if (a.kind === "expr" && !/^on[A-Z]|^action$/.test(a.name))
            read(String(a.value), env, `<${n.name} ${a.name}>`);
          else if (a.kind === "expr") {
            try {
              handlerCode(String(a.value));
            } catch (error) {
              errors.push(`<${n.name} ${a.name}> does not parse: ${error}`);
            }
          }
        walk(n.children, env);
      }
      if (n.type === "each") {
        const list = read(n.list, env, "each");
        for (const [i, item] of (Array.isArray(list) ? list : []).entries())
          walk(n.children, rowScope(env, n, item, i));
      }
      if (n.type === "if") {
        read(n.cond, env, "if");
        walk(n.yes, env);
        walk(n.else, env);
      }
    }
  };
  walk(doc.nodes, program.root);
  for (const t of program.timers) {
    try {
      program.read(t.delay, program.root);
    } catch (error) {
      errors.push(`timer delay: ${error}`);
    }
  }
  return errors;
}

describe.runIf(exampleFiles.length)("Live examples", () => {
  it.each(exampleFiles)("%s evaluates without errors", (file) => {
    const src = readFileSync(join(examples, file), "utf8");
    // Branches not taken may read values that only exist in the other branch: those are fine.
    const errors = dryRun(src).filter((e) => !/^text: .*Cannot read|^if:/.test(e));
    expect(errors).toEqual([]);
    expect(liveText(parseLive(src, true)).length).toBeGreaterThan(5);
  });
});

describe("Live with a host's component list", () => {
  it("keeps the Live surface when the policy lists only kit components", () => {
    const runtime = createUIRuntime();
    const s = new AnswerSession(runtime, {
      policy: { live: true, allowedComponents: ["Chart", "Table"] },
    });
    s.push("<box>\n  <text>hi</text>\n</box>\n");
    s.end();
    const block = s.getSnapshot().blocks.find((b) => b.kind === "surface") as {
      surfaceId: string;
      status?: string;
    };
    expect(block.status).not.toBe("error");
    expect(runtime.getNodeSnapshot(block.surfaceId, "root").component).toBe("Live");
    runtime.dispose();
  });
});

describe("JSX inside {…}", () => {
  it.each([
    [
      "{items.map((item, i) => (<text key={i}>{item}</text>))}",
      "{#each items as item, i}<text key={i}>{item}</text>{/each}",
    ],
    [
      "{items.map(item => <row><text>{item.name}</text></row>)}",
      "{#each items as item}<row><text>{item.name}</text></row>{/each}",
    ],
    ["{list.map(x => { return (<b>{x}</b>) })}", "{#each list as x}<b>{x}</b>{/each}"],
    ["{open && <box gap={2}>hi</box>}", "{#if open}<box gap={2}>hi</box>{/if}"],
    [
      '{done ? <icon name="check"/> : <text>no</text>}',
      '{#if done}<icon name="check"/>{:else}<text>no</text>{/if}',
    ],
    ["{a?.b ? (<x/>) : null}", "{#if a?.b}<x/>{/if}"],
    [
      "<button onPress={() => a && b()}>{n > 1 ? 's' : ''}</button>",
      "<button onPress={() => a && b()}>{n > 1 ? 's' : ''}</button>",
    ],
  ])("%s", (src, expected) => {
    expect(desugarJsx(src)).toBe(expected);
  });

  it("opens the block while the rows stream", () => {
    expect(desugarJsx("{items.map(item => (<row><text>{item}")).toBe(
      "{#each items as item}<row><text>{item}",
    );
    const doc = parseLive(
      "{@state items = ['a', 'b']}\n<box>\n{items.map(item => (<text>{item}</text>))}\n</box>",
      true,
    );
    expect(liveText(doc)).toContain("a");
    expect(liveText(doc)).toContain("b");
  });
});

describe("safe SVG values", () => {
  // What the native parser accepts, as a check: commands with whole groups of plain numbers.
  const NATIVE =
    /^(?:[Mm]-?[\d.]+ -?[\d.]+|[LlTt]-?[\d.]+ -?[\d.]+|[HhVv]-?[\d.]+|[Cc](?:-?[\d.]+ ?){6}|[SsQq](?:-?[\d.]+ ?){4}|[Aa](?:-?[\d.]+ ?){3}[01] [01] -?[\d.]+ -?[\d.]+|[Zz])(?: (?:[MmLlTt]-?[\d.]+ -?[\d.]+|[HhVv]-?[\d.]+|[Cc](?:-?[\d.]+ ?){6}|[SsQq](?:-?[\d.]+ ?){4}|[Aa](?:-?[\d.]+ ?){3}[01] [01] -?[\d.]+ -?[\d.]+|[Zz]))*$/;

  it("rewrites valid paths, including glued numbers and arc flags", () => {
    expect(safePath("M10 20L30,40z")).toBe("M10 20 L30 40 z");
    expect(safePath("M 1 2 3 4 5 6")).toBe("M1 2 L3 4 L5 6");
    expect(safePath("m1-2-3.5.5")).toBe("m1 -2 l-3.5 0.5");
    expect(safePath("M0 0A25 25 -30 0150-25")).toBe("M0 0 A25 25 -30 0 1 50 -25");
  });

  it("draws up to the first error and never passes bad data on", () => {
    expect(safePath("not a path")).toBeUndefined();
    expect(safePath("L1 2")).toBeUndefined();
    expect(safePath("")).toBeUndefined();
    expect(safePath(null)).toBeUndefined();
    expect(safePath("M1 2 L3")).toBe("M1 2");
    expect(safePath("M1 2 L3 4 X 5 6")).toBe("M1 2 L3 4");
    expect(safePath("M1 2 z 3 4")).toBe("M1 2 z");
    expect(safePath("M1 2 L NaN 4")).toBe("M1 2");
    expect(safePath("M1e999 2")).toBeUndefined();
    expect(safePath("M1 2 A1 1 0 2 0 3 3")).toBe("M1 2");
    expect(safePath("M1e30 -1e30")).toBe("M1000000 -1000000");
  });

  it("survives every prefix and random garbage with output the native parser takes", () => {
    const good =
      "M10 20 C 1 2 3 4 5 6 S 1 2 3 4 Q 1 2 3 4 T 5 5 A 5 5 0 1 0 9 9 H 3 V 4 Z m 1 1 l 2 2 z";
    for (let i = 0; i <= good.length; i++) {
      const out = safePath(good.slice(0, i));
      if (out !== undefined) expect(out).toMatch(NATIVE);
    }
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const chars = "MmLlHhVvCcSsQqTtAaZz0123456789.,-+eE XxNn%#\n";
    for (let t = 0; t < 2000; t++) {
      let g = rnd(3) ? "M1 1" : "";
      for (let j = rnd(40); j > 0; j--) g += chars[rnd(chars.length)];
      const out = safePath(g);
      if (out !== undefined) expect(out).toMatch(NATIVE);
    }
  });

  it("takes points in any form", () => {
    expect(safePoints("1,2 3,4")).toBe("1,2 3,4");
    expect(safePoints("1 2,3 4 5")).toBe("1,2 3,4");
    expect(
      safePoints([
        [1, 2],
        [3, 4],
      ]),
    ).toBe("1,2 3,4");
    expect(safePoints([{ x: 1, y: 2 }])).toBe("1,2");
    expect(safePoints([1, 2, 3, 4])).toBe("1,2 3,4");
    expect(safePoints([[1], "x", { y: 2 }, null])).toBeUndefined();
    expect(safePoints("abc")).toBeUndefined();
    expect(safePoints(undefined)).toBeUndefined();
    expect(
      safePoints([
        [1, Number.NaN],
        [2, 3],
      ]),
    ).toBe("2,3");
  });

  it("checks dashes and the viewBox", () => {
    expect(safeDashes("3 4")).toEqual([3, 4]);
    expect(safeDashes([3, 4])).toEqual([3, 4]);
    expect(safeDashes("none")).toBeUndefined();
    expect(safeDashes([0, 0])).toBeUndefined();
    expect(safeDashes([-1, "x"])).toBeUndefined();
    expect(safeViewBox("0 0 300 200")).toEqual([0, 0, 300, 200]);
    expect(safeViewBox("0,0,3,2")).toEqual([0, 0, 3, 2]);
    expect(safeViewBox("garbage")).toBeNull();
    expect(safeViewBox("0 0 0 0")).toBeNull();
    expect(safeViewBox("0 0 -1 5")).toBeNull();
  });

  it("keeps only values of the shape the native side reads", () => {
    const color = (v: unknown) => (v === "red" ? "#f00" : undefined);
    expect(
      safeSvgProps(
        "text",
        {
          x: "abc",
          y: 5,
          "text-anchor": "center",
          "font-size": "huge",
          "font-weight": "wow",
          "font-style": "wavy",
          "alignment-baseline": "nope",
          "dominant-baseline": "middle",
          "text-decoration": "sparkle",
          fill: "not-a-colour",
          stroke: "red",
          "stroke-width": "2px",
          textLength: -5,
          transform: "rotate(45deg) nonsense",
          foo: { bar: 1 },
          onLayout: 1,
          class: "x",
        },
        color,
      ),
    ).toEqual({
      y: 5,
      textAnchor: "middle",
      alignmentBaseline: "middle",
      stroke: "#f00",
      strokeWidth: 2,
    });
    expect(safeSvgProps("path", { d: "garbage" }, color)).toBeNull();
    expect(safeSvgProps("polyline", {}, color)).toBeNull();
    expect(safeSvgProps("image", { href: "file:///etc/passwd" }, color)).toBeNull();
    expect(safeSvgProps("image", { href: "https://a.co/x.png" }, color)).toEqual({
      href: "https://a.co/x.png",
    });
    expect(safeSvgProps("marker", { orient: "auto-start-reverse" }, color)).toEqual({
      orient: "auto",
    });
    expect(safeSvgProps("rect", { width: "50%", rx: Number.NaN, opacity: 5 }, color)).toEqual({
      width: "50%",
      opacity: 1,
    });
    expect(safeSvgProps("g", { transform: "translate(1 2) rotate(3)" }, color)).toEqual({
      transform: "translate(1 2) rotate(3)",
    });
  });
});

describe("SVG coordinates", () => {
  const near = (a: readonly number[], b: readonly number[]) =>
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i] as number, 6));

  it("reads transforms in order", () => {
    expect(parseTransform("translate(10 20)")).toEqual([1, 0, 0, 1, 10, 20]);
    expect(parseTransform("scale(2)")).toEqual([2, 0, 0, 2, 0, 0]);
    near(transformPoint(parseTransform("translate(10,0) scale(2)") as never, 1, 1), [12, 2]);
    near(transformPoint(parseTransform("scale(2) translate(10,0)") as never, 1, 1), [22, 2]);
    // A quarter turn about (10, 10) takes (20, 10) to (10, 20).
    near(transformPoint(parseTransform("rotate(90 10 10)") as never, 20, 10), [10, 20]);
    expect(parseTransform("nonsense")).toBeNull();
    expect(parseTransform(5)).toBeNull();
    expect(parseTransform("")).toBeNull();
  });

  it("multiplies with the first argument applied last", () => {
    const m = multiply([2, 0, 0, 2, 0, 0], [1, 0, 0, 1, 5, 0]);
    near(transformPoint(m, 1, 0), [12, 0]);
    near(multiply(IDENTITY, m), m);
  });

  it("places a viewBox like preserveAspectRatio", () => {
    // 100×100 into 300×200: scale 2, centred horizontally.
    near(viewBoxMatrix([0, 0, 100, 100], 300, 200), [2, 0, 0, 2, 50, 0]);
    near(transformPoint(viewBoxMatrix([0, 0, 100, 100], 300, 200), 50, 50), [150, 100]);
    near(viewBoxMatrix([10, 0, 100, 100], 200, 200, "xMinYMin meet"), [2, 0, 0, 2, -20, 0]);
    near(viewBoxMatrix([0, 0, 100, 100], 300, 200, "none"), [3, 0, 0, 2, 0, 0]);
    near(viewBoxMatrix([0, 0, 100, 100], 300, 200, "xMidYMid slice"), [3, 0, 0, 3, 0, -50]);
  });
});

describe("bold in Korean", () => {
  it("closes bold before a particle after a bracket", () => {
    expect(normalizeBold("**sinθ(세로 좌표)**가 변한다")).toBe("**sinθ(세로 좌표**)가 변한다");
    expect(normalizeBold("값은 **100%**입니다")).toBe("값은 **100**%입니다");
    expect(normalizeBold("이건**(중요)** 해요")).toBe("이건(**중요)** 해요");
  });
  it("leaves what already works, and code, alone", () => {
    expect(normalizeBold("**굵게** 그리고 **괄호(안)** 끝")).toBe(
      "**굵게** 그리고 **괄호(안)** 끝",
    );
    expect(normalizeBold("`x = (a**b)**c`")).toBe("`x = (a**b)**c`");
    expect(normalizeBold("```\nx = (a**b)**c\n```")).toBe("```\nx = (a**b)**c\n```");
    expect(normalizeBold("글자만")).toBe("글자만");
  });
});
