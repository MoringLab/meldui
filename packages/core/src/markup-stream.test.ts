import { describe, expect, it } from "vitest";
import { AnswerSession } from "./answer.js";
import { createUIRuntime } from "./index.js";

const ANSWER = `후드티 가격을 비교해 볼게요.

{@state qty = 1}
<Box tone="subtle" padding="md" gap="sm">
  <Slider label="수량" min={1} max={5} value={qty}/>
  <Text size="xl" weight="bold">{numberFormat(qty * 39900, 0, true)}원</Text>
</Box>

두 벌이면 **79,800원**이에요.
`;

function run(chunks: string[]) {
  const session = new AnswerSession(createUIRuntime());
  const seen: string[] = [];
  for (const c of chunks) {
    session.push(c);
    seen.push(session.blocks.map((b) => b.kind).join(","));
  }
  session.end();
  return { session, seen };
}

describe("markup in an answer stream", () => {
  it("text, then a live surface, then text again — at any chunking", () => {
    for (const size of [1, 3, 7, 40, ANSWER.length]) {
      const chunks: string[] = [];
      for (let i = 0; i < ANSWER.length; i += size) chunks.push(ANSWER.slice(i, i + size));
      const { session } = run(chunks);
      expect(
        session.blocks.map((b) => b.kind),
        `size ${size}`,
      ).toEqual(["markdown", "surface", "markdown"]);
      const [first, , last] = session.blocks as any[];
      expect(first.text).toBe("후드티 가격을 비교해 볼게요.");
      expect(last.text).toBe("두 벌이면 **79,800원**이에요.");
      const surface = session.runtime.getSurface("ui1");
      expect(surface?.componentsModel.get("root")).toBeTruthy();
      expect(session.runtime.read("ui1", "/qty")).toBe(1);
      expect(session.runtime.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    }
  });

  it("the surface appears before its region is finished", () => {
    const cut = ANSWER.indexOf("<Text");
    const session = new AnswerSession(createUIRuntime());
    session.push(ANSWER.slice(0, cut + 12));
    expect(session.blocks.map((b) => b.kind)).toEqual(["markdown", "surface"]);
    expect(session.runtime.getSurface("ui1")?.componentsModel.get("m2")).toBeTruthy(); // the slider
  });

  it("state the person changed is kept while the region keeps streaming", () => {
    const cut = ANSWER.indexOf("<Text");
    const session = new AnswerSession(createUIRuntime());
    session.push(ANSWER.slice(0, cut));
    session.runtime.setValue("ui1", "/qty", 3);
    session.push(ANSWER.slice(cut));
    session.end();
    expect(session.runtime.read("ui1", "/qty")).toBe(3);
  });
});
