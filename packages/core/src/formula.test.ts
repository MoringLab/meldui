import { CATALOG_ID } from "@engine/protocol";
import { describe, expect, it } from "vitest";
import { compileFormula } from "./formula.js";
import { createUIRuntime, evaluateExpression } from "./index.js";

const run = (formula: string, data: Record<string, unknown> = {}) =>
  evaluateExpression(compileFormula(formula), (path) => data[path.replace(/^\//, "")]);

describe("formulas", () => {
  it("computes with precedence, powers, functions and conditions", () => {
    expect(run("1 + 2 * 3 ^ 2")).toBe(19);
    expect(run("-2 ^ 2")).toBe(-4);
    expect(run("(1 + 2) * 3")).toBe(9);
    expect(run("/a / /b", { a: 10, b: 4 })).toBe(2.5);
    expect(run("min(/a, /b, 3)", { a: 10, b: 4 })).toBe(3);
    expect(run("round(/a / 3, 2)", { a: 10 })).toBe(3.33);
    expect(run("/tab == 'home' ? 'H' : \"S\"", { tab: "home" })).toBe("H");
    expect(run("!(/a > 3) || /a <= 10 && true", { a: 4 })).toBe(true);
    expect(run("numberFormat(/a * 1000, 0, true)", { a: 1234 })).toBe("1,234,000");
  });

  it("reads records, lists and template values", () => {
    const rows = [
      { price: 3, done: true },
      { price: 4, done: false },
    ];
    expect(run("/rows[1].price", { rows })).toBe(4);
    expect(run("sum(map(/rows, $item.price))", { rows })).toBe(7);
    expect(run("count(filter(/rows, !$item.done))", { rows })).toBe(1);
    expect(run("[1, 2, /a]", { a: 3 })).toEqual([1, 2, 3]);
  });

  it("matches a monthly loan payment", () => {
    const pay = run("/p * (/rate / 1200) / (1 - (1 + /rate / 1200) ^ -(/years * 12))", {
      p: 10_000_000,
      rate: 5,
      years: 3,
    });
    expect(Math.round(pay as number)).toBe(299709);
  });

  it("rejects what is not a formula", () => {
    expect(() => compileFormula("1 +")).toThrow("FORMULA_SYNTAX");
    expect(() => compileFormula("alert(1)")).toThrow("unknown function");
    expect(() => compileFormula("a = 1")).toThrow("FORMULA_SYNTAX");
    expect(() => compileFormula("'open")).toThrow("unclosed");
  });

  it("drives props and actions, and re-renders on the paths it reads", async () => {
    const r = createUIRuntime();
    r.accept({ version: "v0.9", createSurface: { surfaceId: "s", catalogId: CATALOG_ID } });
    r.accept({
      version: "v0.9",
      updateDataModel: { surfaceId: "s", path: "/", value: { n: 2, total: 0 } },
    });
    r.accept({
      version: "v0.9",
      updateComponents: {
        surfaceId: "s",
        components: [
          { id: "root", component: "Column", children: ["t", "b"] },
          {
            id: "t",
            component: "Text",
            text: { call: "computeString", args: { formula: "format('{0}개', /n * 2)" } },
          },
          {
            id: "b",
            component: "Button",
            label: "+",
            action: { functionCall: { call: "setValue", args: { path: "/n", formula: "/n + 1" } } },
          },
        ],
      },
    });
    r.finish();
    expect(r.diagnostics).toEqual([]);
    let renders = 0;
    r.subscribeNode("s", "t", "/", () => renders++);
    expect(r.getNodeSnapshot("s", "t").props.text).toBe("4개");
    const before = renders;
    await r.dispatch("s", "b", {
      functionCall: { call: "setValue", args: { path: "/n", formula: "/n + 1" } },
    });
    expect(r.read("s", "/n")).toBe(3);
    expect(renders).toBeGreaterThan(before);
    expect(r.getNodeSnapshot("s", "t").props.text).toBe("6개");
  });
});
