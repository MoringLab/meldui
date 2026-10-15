import { describe, expect, it } from "vitest";
import { parseComponent } from "./index.js";
import { normalizeAction, repairComponent } from "./repair.js";

const fix = (value: Record<string, unknown>) => {
  const { component, repairs } = repairComponent(value);
  expect(() => parseComponent(component)).not.toThrow();
  return { component: component as Record<string, any>, repairs };
};

describe("component repair", () => {
  it("fixes the three reported errors", () => {
    // too_big at width: a percentage or pixels where a fraction belongs
    expect(fix({ id: "a", component: "Box", width: 50, children: [] }).component.width).toBe(0.5);
    expect(fix({ id: "b", component: "Box", width: 320 }).component.width).toBe(1);
    // invalid_union at action: actions in other shapes
    expect(
      fix({
        id: "c",
        component: "Button",
        label: "+",
        action: { call: "setValue", args: { path: "/n", value: 1 } },
      }).component.action,
    ).toEqual({ functionCall: { call: "setValue", args: { path: "/n", value: 1 } } });
    expect(
      fix({
        id: "d",
        component: "Button",
        label: "+",
        action: { setValue: { path: "/n", formula: "/n + 1" } },
      }).component.action,
    ).toEqual({ functionCall: { call: "setValue", args: { path: "/n", formula: "/n + 1" } } });
    expect(fix({ id: "e", component: "Button", label: "?", action: 42 }).component.action).toEqual({
      functionCall: { call: "setValues", args: { updates: [] } },
    });
    // invalid_type at max: a string number, or a binding where a literal belongs
    expect(
      fix({ id: "f", component: "Slider", label: "x", value: { path: "/x" }, max: "100" }).component
        .max,
    ).toBe(100);
    const bound = fix({
      id: "g",
      component: "Slider",
      label: "x",
      value: { path: "/x" },
      max: { path: "/limit" },
    });
    expect(bound.component.max).toBe(100); // the default
    expect(bound.repairs.join()).toContain("max");
  });

  it("maps synonyms, drops unknown keys, coerces and fills", () => {
    const box = fix({
      id: "a",
      component: "Box",
      justify: "space-between",
      align: "flex-start",
      style: { color: "red" },
      padding: "large",
    }).component;
    expect(box).toMatchObject({ justify: "between", align: "start", padding: "lg" });
    expect(box.style).toBeUndefined();
    expect(fix({ id: "b", component: "Text", text: 42, size: "huge" }).component).toEqual({
      id: "b",
      component: "Text",
      text: "42",
    });
    expect(fix({ id: "c", component: "Checkbox", label: "a", value: "true" }).component.value).toBe(
      true,
    );
    expect(fix({ id: "d", component: "Heading" }).component.text).toBe("");
  });

  it("drops a bad list entry and keeps the rest", () => {
    const quiz = fix({
      id: "q",
      component: "QuizSet",
      questions: [
        { prompt: "a", choices: ["x", "y"], correctIndex: 0 },
        { prompt: "b", choices: ["only one"], correctIndex: 0 },
      ],
    }).component;
    expect(quiz.questions).toHaveLength(1);
  });

  it("replaces what cannot be fixed with a safe stand-in", () => {
    expect(fix({ id: "a", component: "VStack", children: ["x"] }).component).toEqual({
      id: "a",
      component: "Box",
      children: ["x"],
    });
    expect(fix({ id: "b", component: "Banner", text: "안녕" }).component).toEqual({
      id: "b",
      component: "Text",
      text: "안녕",
    });
    expect(
      fix({ id: "c", component: "Tabs", tabs: "nope", children: ["x"] }).component.component,
    ).toBe("Box");
    expect(fix({ id: "d", component: "Text", props: { text: "nested" } }).component.text).toBe(
      "nested",
    );
  });

  it("normalizes action shapes", () => {
    expect(normalizeAction("submit")).toEqual({ event: { name: "submit" } });
    expect(normalizeAction({ event: "go", context: 1 })).toEqual({ event: { name: "go" } });
    expect(normalizeAction({ path: "/a", value: 1 })).toEqual({
      functionCall: {
        call: "setValue",
        args: { path: "/a", value: 1, expr: undefined, formula: undefined },
      },
    });
    expect(normalizeAction({ functionCall: { call: "eval", args: {} } })).toBeNull();
  });
});

describe("component repair never fails", () => {
  it("turns any props on any component into a valid component", async () => {
    const { COMPONENT_NAMES } = await import("./index.js");
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const junk = (depth = 0): unknown => {
      const r = rnd();
      if (depth > 2 || r < 0.15) return Math.round(rnd() * 2000) - 500;
      if (r < 0.3)
        return ["", "space-between", "large", "100", "true", "x".repeat(40)][Math.floor(rnd() * 6)];
      if (r < 0.4) return rnd() > 0.5;
      if (r < 0.5) return null;
      if (r < 0.65) return { path: "/x" };
      if (r < 0.8) return Array.from({ length: Math.floor(rnd() * 4) }, () => junk(depth + 1));
      return Object.fromEntries(
        ["a", "label", "call", "path", "id"]
          .slice(0, 1 + Math.floor(rnd() * 4))
          .map((k) => [k, junk(depth + 1)]),
      );
    };
    const keys = [
      "text",
      "label",
      "value",
      "max",
      "min",
      "width",
      "action",
      "children",
      "tabs",
      "items",
      "questions",
      "values",
      "kind",
      "tone",
      "gap",
      "variant",
      "columns",
      "front",
      "back",
      "options",
    ];
    for (const name of COMPONENT_NAMES)
      for (let i = 0; i < 40; i++) {
        const props = Object.fromEntries(keys.filter(() => rnd() < 0.35).map((k) => [k, junk()]));
        const { component } = repairComponent({ id: `n${i}`, component: name, ...props });
        expect(() => parseComponent(component), `${name} ${JSON.stringify(props)}`).not.toThrow();
      }
  });
});
