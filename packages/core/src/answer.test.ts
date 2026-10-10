import { describe, expect, it } from "vitest";
import fixtures from "../../../fixtures/cases.json" with { type: "json" };
import { AnswerDecoder, AnswerSession, migrateSnapshot } from "./answer.js";
import { createUIRuntime } from "./index.js";

const calc = fixtures.find((f) => f.id === "calculator")!;
const decl = (
  surfaceId = "main",
  fallbackText = "계산기: 총 금액과 인원으로 1인당 금액을 계산합니다.",
) => JSON.stringify({ engine: "v1", block: "surface", surfaceId, fallbackText });
const hybrid = [
  "먼저 **간단히** 설명하면 이렇습니다. 😀",
  "",
  decl(),
  ...calc.messages.map((m) => JSON.stringify(m)),
  "",
  "정리하면 **인원**이 늘수록 줄어듭니다.",
].join("\n");

const collect = (chunks: string[]) => {
  const d = new AnswerDecoder();
  const items = chunks.flatMap((c) => d.push(c));
  items.push(...d.finish());
  // Merge adjacent text so differently sliced streams compare equal.
  return items.reduce<typeof items>((acc, item) => {
    const last = acc.at(-1);
    if (last?.kind === "text" && item.kind === "text") last.text += item.text;
    else acc.push({ ...item });
    return acc;
  }, []);
};

describe("AnswerDecoder", () => {
  const whole = collect([hybrid]);
  it("separates markdown from control lines", () => {
    expect(whole.filter((i) => i.kind === "json").length).toBe(calc.messages.length + 1);
    expect(whole[0]).toMatchObject({ kind: "text" });
    expect(whole.at(-1)).toMatchObject({ kind: "text" });
  });
  it("is identical for every two-way split, including inside multi-byte characters", () => {
    for (let i = 1; i < hybrid.length; i += 7)
      expect(collect([hybrid.slice(0, i), hybrid.slice(i)])).toEqual(whole);
  });
  it("is identical when fed one character at a time", () => {
    expect(collect([...hybrid])).toEqual(whole);
  });
  it("decodes UTF-8 bytes split across chunks", () => {
    const bytes = new TextEncoder().encode(`한글 😀 텍스트\n${decl()}\n`);
    const d = new AnswerDecoder();
    const items = [...d.push(bytes.slice(0, 5)), ...d.push(bytes.slice(5)), ...d.finish()];
    expect(
      items
        .filter((i) => i.kind === "text")
        .map((i) => (i as { text: string }).text)
        .join(""),
    ).toBe("한글 😀 텍스트\n");
  });
  it("streams text before the line ends but holds back half-received JSON", () => {
    const d = new AnswerDecoder();
    expect(d.push("partial words")).toEqual([{ kind: "text", text: "partial words" }]);
    expect(d.push(" and more\n")).toEqual([{ kind: "text", text: " and more\n" }]);
    expect(d.push('{"engine":"v1","block":"sur')).toEqual([]);
  });
  it("treats fenced JSON and ordinary brace lines as markdown", () => {
    const text = '```json\n{"version":"v0.9","createSurface":{}}\n```\n{x}\n{"a":1}\n';
    const items = collect([text]);
    expect(items).toEqual([{ kind: "text", text }]);
  });
  it("reports a broken control line instead of showing it as text", () => {
    expect(collect(['{"version":"v0.9","createSurface":{\n'])).toEqual([
      { kind: "invalid", line: '{"version":"v0.9","createSurface":{' },
    ]);
  });
});

function run(policy: object = {}, text = hybrid) {
  const runtime = createUIRuntime();
  const session = new AnswerSession(runtime, { policy });
  session.push(text);
  session.end();
  return { runtime, session };
}

describe("AnswerSession", () => {
  it("builds ordered markdown, surface, markdown blocks", () => {
    const { session, runtime } = run();
    expect(session.blocks.map((b) => b.kind)).toEqual(["markdown", "surface", "markdown"]);
    const surface = session.blocks[1] as Extract<
      (typeof session.blocks)[number],
      { kind: "surface" }
    >;
    expect(surface).toMatchObject({
      surfaceId: "main",
      fallbackSource: "model",
      status: "complete",
    });
    expect(surface.fallbackText).toContain("계산기");
    expect((session.blocks[0] as { text: string }).text).toBe(
      "먼저 **간단히** 설명하면 이렇습니다. 😀",
    );
    expect(runtime.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
  it("markdown-only creates zero surfaces and reports once", () => {
    const { session, runtime } = run({ mode: "markdown-only" });
    expect(session.blocks.map((b) => b.kind)).toEqual(["markdown", "markdown"]);
    expect(runtime.surfaceIds).toEqual([]);
    expect(runtime.diagnostics.filter((d) => d.code === "POLICY_SURFACES_DISABLED")).toHaveLength(
      1,
    );
  });
  it("engine-only creates no markdown blocks", () => {
    const { session } = run({ mode: "engine-only" });
    expect(session.blocks.map((b) => b.kind)).toEqual(["surface"]);
  });
  it("enforces maxSurfaces", () => {
    const second = calc.messages.map((m: any) =>
      JSON.parse(JSON.stringify(m).replaceAll('"main"', '"two"')),
    );
    const text = [
      decl(),
      ...calc.messages.map((m) => JSON.stringify(m)),
      decl("two"),
      ...second.map((m) => JSON.stringify(m)),
    ].join("\n");
    const { session, runtime } = run({ maxSurfaces: 1 }, text);
    expect(session.blocks.filter((b) => b.kind === "surface")).toHaveLength(1);
    expect(runtime.surfaceIds).toEqual(["main"]);
    expect(runtime.diagnostics.some((d) => d.code === "POLICY_MAX_SURFACES")).toBe(true);
  });
  it("quarantines components outside allowedComponents", () => {
    const { runtime } = run({
      allowedComponents: ["Column", "Heading", "Text", "Grid", "Card", "Slider"],
    });
    expect(runtime.diagnostics.some((d) => d.code === "COMPONENT_NOT_ALLOWED")).toBe(false); // calc uses only allowed
    const { runtime: r2 } = run({ allowedComponents: ["Column", "Heading"] });
    expect(r2.diagnostics.some((d) => d.code === "COMPONENT_NOT_ALLOWED")).toBe(true);
  });
  it("generates fallback text for legacy streams without declarations", () => {
    const { session, runtime } = run({}, calc.messages.map((m) => JSON.stringify(m)).join("\n"));
    const surface = session.blocks[0] as Extract<
      (typeof session.blocks)[number],
      { kind: "surface" }
    >;
    expect(surface.fallbackSource).toBe("generated");
    expect(surface.fallbackText).toContain("함께 나누는 저녁");
    expect(runtime.diagnostics.some((d) => d.code === "FALLBACK_TEXT_MISSING")).toBe(true);
  });
  it("blocks sandbox declarations unless allowed and never executes them", () => {
    const line = JSON.stringify({
      engine: "v1",
      block: "sandbox",
      mode: "app",
      fallbackText: "데모",
    });
    const { session, runtime } = run({}, `${line}\n`);
    expect(session.blocks[0]).toMatchObject({
      kind: "sandbox",
      status: "blocked",
      fallbackText: "데모",
    });
    expect(runtime.diagnostics.some((d) => d.code === "POLICY_SANDBOX_DISABLED")).toBe(true);
  });
  it("emits sequential events and supports separate channels", () => {
    const events: number[] = [];
    const runtime = createUIRuntime();
    const session = new AnswerSession(runtime, { onEvent: (e) => events.push(e.seq) });
    session.pushMarkdown("텍스트 채널");
    session.declareSurface({ surfaceId: "main", fallbackText: "계산기" });
    for (const m of calc.messages) session.pushMessage(m);
    session.declareMedia({ attachments: ["att-1"], layout: "hero" });
    session.end();
    expect(session.blocks.map((b) => b.kind)).toEqual(["markdown", "surface", "media"]);
    expect(events).toEqual(events.map((_, i) => i + 1));
  });
  it("round-trips a snapshot and keeps the user's edits", () => {
    const { session, runtime } = run();
    runtime.setValue("main", "/b", 7 as never);
    const stored = JSON.parse(JSON.stringify(session.serialize()));
    const restored = createUIRuntime();
    const again = AnswerSession.restore(stored, restored);
    expect(again.blocks.map((b) => b.kind)).toEqual(["markdown", "surface", "markdown"]);
    expect(restored.read("main", "/b")).toBe(7);
    expect(restored.getNodeSnapshot("main", "_result").props.text).toBe(12000);
  });
  it("reset restores the model's data", () => {
    const { session, runtime } = run();
    runtime.setValue("main", "/b", 7 as never);
    session.reset("main");
    expect(runtime.read("main", "/b")).toBe(4);
  });
  it("migrates pre-hybrid histories (array, wrapped and NDJSON)", () => {
    const bare = calc.messages;
    for (const input of [
      bare,
      { schema: 1, messages: bare },
      bare.map((m) => JSON.stringify(m)).join("\n"),
    ]) {
      const runtime = createUIRuntime();
      const session = AnswerSession.restore(input, runtime);
      expect(session.blocks.map((b) => b.kind)).toEqual(["surface"]);
      expect(runtime.getNodeSnapshot("main", "_result").props.text).toBe(21000);
      expect((session.blocks[0] as { fallbackText: string }).fallbackText).toContain(
        "함께 나누는 저녁",
      );
    }
    expect(() => migrateSnapshot({ schema: 9 })).toThrow("UNSUPPORTED_SNAPSHOT");
  });
});

it("composer consumes model events", async () => {
  const runtime = createUIRuntime(),
    session = new AnswerSession(runtime);
  async function* stream() {
    yield { type: "text" as const, text: "Hello\n" };
    yield { type: "complete" as const, status: "completed" as const };
  }
  await session.consume(stream());
  expect(session.asText()).toContain("Hello");
  runtime.dispose();
});
it("an empty engine-only answer is a repairable error rather than a successful blank screen", () => {
  const runtime = createUIRuntime(),
    session = new AnswerSession(runtime, { policy: { mode: "engine-only" } });
  session.push("Plain prose");
  session.end();
  session.end();
  expect(runtime.diagnostics.filter((d) => d.code === "MISSING_ANSWER")).toHaveLength(1);
  runtime.dispose();
});
it("cancelled model streams retain the last received content without completing the answer", async () => {
  const runtime = createUIRuntime(),
    session = new AnswerSession(runtime);
  async function* stream() {
    yield { type: "text" as const, text: "Received\n" };
    yield { type: "complete" as const, status: "cancelled" as const };
    yield { type: "text" as const, text: "Late output" };
  }
  await session.consume(stream());
  expect(session.asText()).toContain("Received");
  expect(session.asText()).not.toContain("Late output");
  expect(session.blocks.some((b) => b.status === "complete")).toBe(false);
  runtime.dispose();
});
