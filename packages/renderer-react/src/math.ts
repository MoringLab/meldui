import { fromHtmlIsomorphic } from "hast-util-from-html-isomorphic";
import { renderToString } from "katex";
/** Use the patched renderer directly; rehype-katex 7 still installs its own older KaTeX. */
export function safeMath() {
  return (tree: any) => {
    const text = (node: any): string => node.value ?? (node.children ?? []).map(text).join("");
    const visit = (node: any) => {
      const display =
        node.tagName === "pre" &&
        node.children?.[0]?.properties?.className?.includes("math-display");
      const classes: string[] =
        (display ? node.children[0].properties : node.properties)?.className ?? [];
      if (classes.includes("math-inline") || classes.includes("math-display")) {
        const source = text(node);
        if (source.length > 2000) return;
        try {
          const html = renderToString(source, {
            displayMode: classes.includes("math-display"),
            trust: false,
            throwOnError: false,
            maxExpand: 100,
            maxSize: 10,
          });
          if (html.length > 100000) return;
          node.tagName = classes.includes("math-display") ? "div" : "span";
          node.properties = {};
          node.children = fromHtmlIsomorphic(html, { fragment: true }).children;
        } catch {
          /* Preserve the literal formula when parsing cannot finish. */
        }
        return;
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
}
