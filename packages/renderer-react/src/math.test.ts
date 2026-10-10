import { expect, it } from "vitest";
import { safeMath } from "./math.js";

it("patched math renders block/inline formulas but never trusted links or excessive source", () => {
  const math = (value: string) => ({
    type: "element",
    tagName: "code",
    properties: { className: ["math-display"] },
    children: [{ type: "text", value }],
  });
  const root: any = {
    type: "root",
    children: [
      { type: "element", tagName: "pre", children: [math("x^2")] },
      math("\\href{https://unregistered.invalid}{click}"),
      math("x".repeat(2001)),
    ],
  };
  safeMath()(root);
  expect(root.children[0].tagName).toBe("div");
  expect(JSON.stringify(root.children[0])).toContain("katex");
  const links: any[] = [];
  const visit = (n: any) => {
    if (n.properties?.href || n.properties?.src) links.push(n.properties);
    for (const c of n.children ?? []) visit(c);
  };
  visit(root);
  expect(links).toEqual([]);
  expect(root.children[2].tagName).toBe("code");
});
