import { describe, expect, it } from "vitest";
import hybrid from "../fixtures/hybrid/cases.json" with { type: "json" };
import { AnswerSession, createUIRuntime } from "../packages/core/src/index.js";
import type { HostPolicy } from "../packages/protocol/src/index.js";

const slices = (text: string, size: number) =>
  text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) ?? [];

describe("hybrid fixtures", () => {
  for (const fixture of hybrid) {
    for (const size of [1, 7, 64, 100000])
      it(`${fixture.id} renders identically when streamed in ${size}-char chunks`, () => {
        const runtime = createUIRuntime();
        const session = new AnswerSession(runtime);
        for (const chunk of slices(fixture.wire, size)) session.push(chunk);
        session.end();
        expect(session.blocks.map((b) => b.kind)).toEqual(fixture.expect.blocks);
        expect(runtime.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
        for (const block of session.blocks)
          if (block.kind === "surface") {
            expect(block.fallbackText.length).toBeGreaterThan(10);
            expect(block.status).toBe("complete");
          }
      });
    it(`${fixture.id} produces zero surfaces under markdown-only`, () => {
      const runtime = createUIRuntime();
      const session = new AnswerSession(runtime, { policy: { mode: "markdown-only" } });
      session.push(fixture.wire);
      session.end();
      expect(runtime.surfaceIds).toEqual([]);
      expect(session.blocks.some((b) => b.kind === "surface")).toBe(false);
    });
    it(`${fixture.id} survives serialize and restore (schema 2)`, () => {
      const runtime = createUIRuntime();
      const session = new AnswerSession(runtime);
      session.push(fixture.wire);
      session.end();
      const stored = JSON.parse(JSON.stringify(session.serialize()));
      const again = AnswerSession.restore(stored, createUIRuntime());
      expect(again.blocks.map((b) => b.kind)).toEqual(fixture.expect.blocks);
      expect(again.asText()).toBe(session.asText());
    });
  }
  it("no markdown block ever contains a control line", () => {
    for (const fixture of hybrid) {
      const session = new AnswerSession(createUIRuntime());
      session.push(fixture.wire);
      session.end();
      for (const block of session.blocks)
        if (block.kind === "markdown")
          expect(block.text).not.toMatch(/"version":"v0\.9"|"engine":"v1"/);
    }
  });
});

import vectors from "../fixtures/hybrid/vectors.json" with { type: "json" };
import { AnswerDecoder } from "../packages/core/src/index.js";

describe("parity vectors (reference for the Dart port)", () => {
  const merge = (items: { kind: string; text?: string }[]) =>
    items.reduce<{ kind: string; text?: string }[]>((acc, item) => {
      const last = acc.at(-1);
      if (last?.kind === "text" && item.kind === "text")
        last.text = (last.text ?? "") + (item.text ?? "");
      else acc.push({ ...item });
      return acc;
    }, []);
  for (const v of vectors.decoder)
    it(`decoder ${v.name} is stable under any chunking`, () => {
      for (const size of [1, 3, 11, 10000]) {
        const d = new AnswerDecoder();
        const items = slices(v.text, size).flatMap((c) => d.push(c));
        items.push(...d.finish());
        expect(merge(items)).toEqual(v.items);
      }
    });
  for (const v of vectors.session)
    it(`session ${v.name}`, () => {
      const runtime = createUIRuntime();
      const session = new AnswerSession(runtime, { policy: v.policy as HostPolicy });
      for (const chunk of slices(v.text, 9)) session.push(chunk);
      session.end();
      expect(session.blocks.map((b) => b.kind)).toEqual(v.blocks);
      expect(runtime.surfaceIds).toEqual(v.surfaces);
      expect([...new Set(runtime.diagnostics.map((d) => d.code))].sort()).toEqual(
        v.diagnosticCodes,
      );
    });
});
