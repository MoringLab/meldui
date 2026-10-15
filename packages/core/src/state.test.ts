import { CATALOG_ID } from "@engine/protocol";
import { describe, expect, it } from "vitest";
import { createUIRuntime, evaluateExpression } from "./index.js";

const read = (data: Record<string, unknown>) => (path: string) => data[path.replace(/^\//, "")];
const ev = (expr: unknown, data: Record<string, unknown> = {}) =>
  evaluateExpression(expr as never, read(data));

describe("state operators", () => {
  it("reads and sorts records by field", () => {
    const rows = [
      { name: "b", price: 2 },
      { name: "a", price: 1 },
    ];
    expect(ev({ op: "get", args: [{ ref: "/r" }, "price"] }, { r: rows[0] })).toBe(2);
    expect(
      ev(
        { op: "map", args: [{ ref: "/rows" }, { op: "get", args: [{ ref: "$item" }, "name"] }] },
        { rows },
      ),
    ).toEqual(["b", "a"]);
    expect(ev({ op: "sort", args: [{ ref: "/rows" }, "price"] }, { rows })).toEqual([
      rows[1],
      rows[0],
    ]);
    expect(ev({ op: "get", args: [{ ref: "/r" }, "missing"] }, { r: rows[0] })).toBeNull();
    expect(() => ev({ op: "get", args: [{ ref: "/r" }, "__proto__"] }, { r: rows[0] })).toThrow(
      "UNSAFE_KEY",
    );
  });

  it("builds and changes lists and records", () => {
    const todos = [{ text: "우유", done: false }];
    const added = ev(
      {
        op: "concat",
        args: [
          { ref: "/todos" },
          {
            op: "array",
            args: [{ op: "object", args: ["text", { ref: "/draft" }, "done", false] }],
          },
        ],
      },
      { todos, draft: "빵" },
    );
    expect(added).toEqual([...todos, { text: "빵", done: false }]);
    expect(ev({ op: "set", args: [{ ref: "/t" }, "done", true] }, { t: todos[0] })).toEqual({
      text: "우유",
      done: true,
    });
    expect(ev({ op: "set", args: [{ ref: "/a" }, 1, 9] }, { a: [1, 2, 3] })).toEqual([1, 9, 3]);
    expect(ev({ op: "slice", args: [{ ref: "/a" }, 1] }, { a: [1, 2, 3] })).toEqual([2, 3]);
    expect(ev({ op: "join", args: [{ ref: "/a" }, " · "] }, { a: ["a", 2] })).toBe("a · 2");
    expect(ev({ op: "includes", args: [{ ref: "/a" }, 2] }, { a: [1, 2] })).toBe(true);
    expect(ev({ op: "concat", args: ["점수 ", 3, "/5"] })).toBe("점수 3/5");
    expect(ev({ op: "abs", args: [-4] })).toBe(4);
    expect(() => ev({ op: "object", args: ["only-key"] })).toThrow("EXPECTED_PAIRS");
    expect(() => ev({ op: "object", args: ["constructor", 1] })).toThrow("UNSAFE_KEY");
  });
});

describe("template rows", () => {
  it("lets a row's button toggle and remove its own row ($item, $index)", async () => {
    const r = createUIRuntime();
    r.accept({ version: "v0.9", createSurface: { surfaceId: "s", catalogId: CATALOG_ID } });
    r.accept({
      version: "v0.9",
      updateDataModel: {
        surfaceId: "s",
        path: "/",
        value: {
          todos: [
            { text: "a", done: false },
            { text: "b", done: false },
          ],
        },
      },
    });
    r.accept({
      version: "v0.9",
      updateComponents: {
        surfaceId: "s",
        components: [
          { id: "root", component: "Column", children: { componentId: "row", path: "/todos" } },
          { id: "row", component: "Row", children: ["toggle", "remove"] },
          {
            id: "toggle",
            component: "Button",
            label: { path: "text" },
            action: {
              functionCall: {
                call: "setValue",
                args: { path: "done", expr: { op: "not", args: [{ ref: "done" }] } },
              },
            },
          },
          {
            id: "remove",
            component: "Button",
            label: "삭제",
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
        ],
      },
    });
    r.finish();
    await r.dispatch(
      "s",
      "toggle",
      {
        functionCall: {
          call: "setValue",
          args: { path: "done", expr: { op: "not", args: [{ ref: "done" }] } },
        },
      },
      "/todos/1",
    );
    expect(r.read("s", "/todos/1/done")).toBe(true);
    expect(r.read("s", "$index", "/todos/1")).toBe(1);
    expect(r.read("s", "$item", "/todos/1")).toEqual({ text: "b", done: true });
    const remove = r.getSurface("s")!.componentsModel.get("remove")!.properties.action as never;
    await r.dispatch("s", "remove", remove, "/todos/0");
    expect(r.read("s", "/todos")).toEqual([{ text: "b", done: true }]);
  });
});

describe("answer context", () => {
  it("describes generated UI with its current values, not only the fallback", async () => {
    const { AnswerSession } = await import("./answer.js");
    const session = new AnswerSession(createUIRuntime(), { policy: { allowSandbox: true } });
    const lines = [
      "질량을 바꿔 보세요.",
      '{"engine":"v1","block":"surface","surfaceId":"main","fallbackText":"질량 슬라이더와 반지름"}',
      `{"version":"v0.9","createSurface":{"surfaceId":"main","catalogId":"${CATALOG_ID}"}}`,
      '{"version":"v0.9","updateDataModel":{"surfaceId":"main","path":"/","value":{"m":10}}}',
      '{"version":"v0.9","updateComponents":{"surfaceId":"main","components":[{"id":"root","component":"Column","children":["s","t"]},{"id":"s","component":"Slider","label":"질량","value":{"path":"/m"},"min":1,"max":100},{"id":"t","component":"Text","text":"반지름"}]}}',
      '{"engine":"v1","block":"sandbox","mode":"app","source":"<style>p{}</style><h2>궤도</h2><p>속도 조절</p><script>1</script>","fallbackText":"궤도 시뮬레이션"}',
    ];
    session.push(`${lines.join("\n")}\n`);
    session.end();
    session.runtime.setValue("main", "/m", 42);
    const context = session.asContext();
    expect(context).toContain('<ui surface="main">');
    expect(context).toContain('Slider#s label="질량" value="42" min="1" max="100"');
    expect(context).toContain('data: {"m":42}');
    expect(context).toContain("shows: 궤도 속도 조절");
    expect(context).not.toContain("<script>");
  });
});
