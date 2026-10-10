import { CATALOG_ID, PROTOCOL_VERSION } from "@engine/protocol";
import { describe, expect, it } from "vitest";
import { createUIRuntime, evaluateExpression, NDJSONDecoder } from "./index.js";

const create = {
  version: PROTOCOL_VERSION,
  createSurface: { surfaceId: "s", catalogId: CATALOG_ID },
};
const update = (components: unknown[]) => ({
  version: PROTOCOL_VERSION,
  updateComponents: { surfaceId: "s", components },
});
const data = (value: unknown, path = "/") => ({
  version: PROTOCOL_VERSION,
  updateDataModel: { surfaceId: "s", path, value },
});

describe("NDJSON boundary safety", () => {
  it("preserves every possible split of Korean UTF-8, CRLF and the final line", () => {
    const source = new TextEncoder().encode(
      `${JSON.stringify({ text: "안녕 🌏" })}\r\n${JSON.stringify(create)}`,
    );
    for (let boundary = 0; boundary <= source.length; boundary++) {
      const decoder = new NDJSONDecoder();
      expect([
        ...decoder.push(source.slice(0, boundary)),
        ...decoder.push(source.slice(boundary)),
        ...decoder.finish(),
      ]).toEqual([{ text: "안녕 🌏" }, create]);
    }
  });
  it("quarantines malformed lines and rejects oversized buffers", () => {
    const errors: unknown[] = [];
    const decoder = new NDJSONDecoder((d) => errors.push(d), 100);
    expect(decoder.push('invalid\n{"ok":true}\n')).toEqual([{ ok: true }]);
    expect(errors).toHaveLength(1);
    expect(() => decoder.push("x".repeat(101))).toThrow("MESSAGE_LIMIT");
  });
});
describe("runtime", () => {
  it("isolates invalid nodes and resolves children that arrive later", () => {
    const r = createUIRuntime();
    expect(r.accept(create)).toEqual([]);
    r.accept(update([{ id: "root", component: "Column", children: ["child"] }]));
    expect(r.getNodeSnapshot("s", "child").component).toBeUndefined();
    r.accept(
      update([
        { id: "bad", component: "Executable", code: "ignored" },
        { id: "child", component: "Text", text: "ready" },
      ]),
    );
    expect(r.getNodeSnapshot("s", "child").props.text).toBe("ready");
    expect(r.diagnostics).toHaveLength(1);
    r.finish();
    expect(r.diagnostics).toHaveLength(1);
    r.dispose();
  });
  it("rejects cycles before corrupting the previous tree", () => {
    const r = createUIRuntime();
    r.accept(create);
    r.accept(
      update([
        { id: "root", component: "Column", children: ["child"] },
        { id: "child", component: "Text", text: "ok" },
      ]),
    );
    r.accept(update([{ id: "child", component: "Column", children: ["root"] }]));
    expect(r.diagnostics.length).toBeGreaterThan(0);
    expect(r.getNodeSnapshot("s", "child").component).toBe("Text");
    r.dispose();
  });
  it("notifies only the bound node and preserves edited values", () => {
    const r = createUIRuntime();
    r.accept(create);
    r.accept(data({ x: 1, y: 2 }));
    r.accept(
      update([
        { id: "root", component: "Text", text: { path: "/x" } },
        { id: "other", component: "Text", text: { path: "/y" } },
      ]),
    );
    let x = 0;
    let y = 0;
    const off = r.subscribeNode("s", "root", "/", () => x++);
    const off2 = r.subscribeNode("s", "other", "/", () => y++);
    const initialY = y;
    r.setValue("s", "/x", 3);
    expect(x).toBeGreaterThan(1);
    expect(y).toBe(initialY);
    r.accept(data(99, "/x"));
    expect(r.read("s", "/x")).toBe(3);
    expect(r.diagnostics.at(-1)?.code).toBe("LOCAL_EDIT_CONFLICT");
    off();
    off2();
    r.dispose();
  });
  it("denies unregistered client actions and prototype access", async () => {
    const r = createUIRuntime();
    r.accept(create);
    r.accept(update([{ id: "root", component: "Text", text: "safe" }]));
    await r.dispatch("s", "root", {
      functionCall: { call: "openUrl", args: { url: "https://example.com" } },
    });
    expect(r.diagnostics.at(-1)?.code).toBe("CLIENT_ACTION_DENIED");
    expect(() => r.setValue("s", "/__proto__/polluted", true)).toThrow("UNSAFE_PATH");
    r.dispose();
  });
  it("handles duplicate transport IDs without duplicating createSurface", () => {
    const r = createUIRuntime();
    r.accept(create, "1");
    r.accept(create, "1");
    expect(r.diagnostics).toHaveLength(0);
    r.accept(create);
    expect(r.diagnostics).toHaveLength(1);
    r.dispose();
  });
});
describe("runtime regression boundaries", () => {
  it("shares catalog caches while isolating conversation data and disposal", () => {
    const first = createUIRuntime();
    const second = createUIRuntime();
    for (const runtime of [first, second]) {
      runtime.accept(create);
      runtime.accept(
        update([
          {
            id: "root",
            component: "Text",
            text: {
              call: "computeString",
              args: { expr: { op: "format", args: ["{0}", { ref: "/value" }] } },
              returnType: "string",
            },
          },
        ]),
      );
    }
    first.accept(data({ value: 11 }));
    second.accept(data({ value: 22 }));
    expect(first.getNodeSnapshot("s", "root").props.text).toBe("11");
    expect(second.getNodeSnapshot("s", "root").props.text).toBe("22");
    first.dispose();
    second.setValue("s", "/value", 33);
    expect(second.getNodeSnapshot("s", "root").props.text).toBe("33");
    second.dispose();
  });
  it("reports fresh errors after the diagnostic ring fills", () => {
    const r = createUIRuntime();
    for (let i = 0; i < 205; i++) expect(r.accept({ bad: i })).toHaveLength(1);
    expect(r.diagnostics).toHaveLength(200);
    r.accept(create);
    expect(r.finish()).toHaveLength(1);
    r.dispose();
  });
  it("includes resolvable expression errors in completion diagnostics", () => {
    const r = createUIRuntime();
    r.accept(create);
    r.accept(
      update([
        {
          id: "root",
          component: "Text",
          text: {
            call: "computeString",
            args: { expr: { op: "format", args: ["{0}", { op: "div", args: [1, 0] }] } },
            returnType: "string",
          },
        },
      ]),
    );
    r.finish();
    expect(r.diagnostics.at(-1)?.code).toBe("DIVISION_BY_ZERO");
    r.dispose();
  });
  it("does not notify 499 unrelated node subscribers for one local edit", () => {
    const r = createUIRuntime();
    r.accept(create);
    r.accept(data(Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`x${i}`, i]))));
    r.accept(
      update([
        {
          id: "root",
          component: "Column",
          children: Array.from({ length: 500 }, (_, i) => `n${i}`),
        },
        ...Array.from({ length: 500 }, (_, i) => ({
          id: `n${i}`,
          component: "Text",
          text: { path: `/x${i}` },
        })),
      ]),
    );
    const counters = Array(500).fill(0);
    for (let i = 0; i < 500; i++) r.subscribeNode("s", `n${i}`, "/", () => counters[i]++);
    const baseline = [...counters];
    r.setValue("s", "/x0", 999);
    expect(counters[0]).toBeGreaterThan(baseline[0]);
    expect(counters.slice(1)).toEqual(baseline.slice(1));
    r.dispose();
  });
});
describe("conflict decisions", () => {
  it("holds a model write across generation changes until the host chooses", () => {
    const r = createUIRuntime();
    r.accept(create);
    r.accept(data(1, "/x"));
    r.setValue("s", "/x", 7);
    r.beginRun("s");
    r.accept(data(99, "/x"));
    expect(r.read("s", "/x")).toBe(7);
    expect(r.getPendingWrites("s")).toHaveLength(1);
    r.resolveConflict("s", "/x", "accept-model");
    expect(r.read("s", "/x")).toBe(99);
    r.dispose();
  });
});
describe("expressions", () => {
  it("evaluates a lazy conditional and rejects an unsafe calculation", () => {
    expect(
      evaluateExpression({ op: "if", args: [true, 42, { op: "div", args: [1, 0] }] }, () => 0),
    ).toBe(42);
    expect(() => evaluateExpression({ op: "div", args: [1, 0] }, () => 0)).toThrow(
      "DIVISION_BY_ZERO",
    );
  });
  it("bounds repeated work", () => {
    expect(() =>
      evaluateExpression({ op: "array", args: Array.from({ length: 300 }, () => 1) }, () => 0),
    ).toThrow("EXPRESSION_LIMIT");
  });
});
