import { CATALOG_ID } from "@engine/protocol";
import { describe, expect, it } from "vitest";
import { AnswerSession } from "./answer.js";
import { createUIRuntime } from "./index.js";

const lines = [
  "가격을 비교해 볼게요.",
  JSON.stringify({ engine: "v1", block: "surface", surfaceId: "s", fallbackText: "가격 비교" }),
  JSON.stringify({ version: "v0.9", createSurface: { surfaceId: "s", catalogId: CATALOG_ID } }),
  JSON.stringify({
    version: "v0.9",
    updateComponents: {
      surfaceId: "s",
      components: [
        { id: "root", component: "Column", children: ["title", "note", "go"] },
        { id: "title", component: "Text", text: "비교", variant: "h3" },
        { id: "note", component: "Text", text: '{중괄호} "따옴표" 포함' },
        {
          id: "go",
          component: "Button",
          label: "다시",
          action: { kind: "setValue", args: { path: "/n", value: 1 } },
        },
      ],
    },
  }),
  "끝.",
].join("\n");

const ids = (session: AnswerSession) =>
  ["go", "note", "root", "title"].filter((id) =>
    session.runtime.getSurface("s")?.componentsModel.has(id),
  );

describe("UI builds while it streams", () => {
  it("applies each component of a streaming line as soon as it closes", () => {
    const session = new AnswerSession(createUIRuntime());
    const cut = lines.indexOf('{"id":"note"');
    session.push(lines.slice(0, cut));
    expect(ids(session).sort()).toEqual(["root", "title"]);
    expect(session.blocks.map((b) => b.kind)).toEqual(["markdown", "surface"]);
    session.push(lines.slice(cut));
    session.end();
    expect(ids(session).sort()).toEqual(["go", "note", "root", "title"]);
    expect(session.blocks.map((b) => [b.kind, b.status])).toEqual([
      ["markdown", "complete"],
      ["surface", "complete"],
      ["markdown", "complete"],
    ]);
  });

  it("ends the same however the stream is chunked", () => {
    const whole = new AnswerSession(createUIRuntime());
    whole.push(lines);
    whole.end();
    const bytes = new AnswerSession(createUIRuntime());
    for (const c of lines) bytes.push(c);
    bytes.end();
    expect(bytes.asContext()).toBe(whole.asContext());
    expect(bytes.blocks.map((b) => b.kind)).toEqual(whole.blocks.map((b) => b.kind));
    expect(ids(bytes).sort()).toEqual(ids(whole).sort());
  });

  it("shows a building sandbox that becomes the finished one in its place", () => {
    const decl = JSON.stringify({
      engine: "v1",
      block: "sandbox",
      mode: "html",
      title: "블랙홀",
      source: "<style>body{margin:0}</style><div id=a></div><script>a.textContent=1</script>",
      fallbackText: "블랙홀 시뮬레이션",
    });
    const session = new AnswerSession(createUIRuntime(), { policy: { allowSandbox: true } });
    session.push("시뮬레이션이에요.\n");
    session.push(decl.slice(0, decl.indexOf("body{")));
    const building = session.blocks.at(-1)!;
    expect(building).toMatchObject({
      kind: "sandbox",
      status: "building",
      progress: "style",
      title: "블랙홀",
    });
    session.push(decl.slice(decl.indexOf("body{"), decl.indexOf("a.text")));
    expect(session.blocks.at(-1)).toMatchObject({ id: building.id, progress: "script" });
    session.push(`${decl.slice(decl.indexOf("a.text"))}\n`);
    expect(session.blocks.at(-1)).toMatchObject({
      id: building.id,
      status: "complete",
      fallbackText: "블랙홀 시뮬레이션",
    });
    expect(session.blocks.filter((b) => b.kind === "sandbox")).toHaveLength(1);
  });

  it("drops the placeholder of a sandbox the answer never finished", () => {
    const session = new AnswerSession(createUIRuntime(), { policy: { allowSandbox: true } });
    session.push('{"engine":"v1","block":"sandbox","mode":"html","source":"<div>');
    expect(session.blocks.at(-1)?.status).toBe("building");
    session.end();
    expect(session.blocks.some((b) => b.kind === "sandbox" && b.status === "building")).toBe(false);
  });
});
