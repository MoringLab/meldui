import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

export type MarkdownPart = { markdown: string } | { attachmentId: string; alt: string };
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkStringify);
const attachment = /^attachment:([A-Za-z0-9._:-]{1,128})$/;
/** Only identifiers and approved external link schemes. Images never accept remote URLs. */
export function markdownDestination(value: string, image = false): string | undefined {
  if (attachment.test(value)) return value;
  // An entity link ([[name]] → entity:…) is opened by the host, never fetched.
  if (!image && /^entity:[A-Za-z0-9%._~!*'()-]{1,2000}$/.test(value)) return value;
  if (image || [...value].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)) return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return value;
    if (url.protocol === "mailto:" && !url.search && !url.hash) return value;
  } catch {
    /* malformed / relative destination */
  }
}
export function attachmentIdFrom(value: string) {
  return attachment.exec(value)?.[1];
}

/** A native-safe AST boundary: no HTML or library-owned image/network loader survives it.
 * Images become host media parts, including reference images. Code remains literal text.
 * Rich typography stays in Markdown; all links still need host approval at interaction time.
 */
export function prepareMarkdown(
  text: string,
  maxChars = 65_536,
  formattingHtml = false,
): MarkdownPart[] {
  if (text.length > maxChars) throw new Error("MARKDOWN_LIMIT");
  const tree = parser.parse(text);
  const definitions = new Map<string, string>();
  type Node = {
    type: string;
    children?: Node[];
    value?: string;
    url?: string;
    identifier?: string;
    alt?: string;
  };
  const root = tree as unknown as Node;
  const collect = (node: Node) => {
    if (node.type === "definition" && node.identifier && node.url)
      definitions.set(node.identifier.toLowerCase(), node.url);
    for (const child of node.children ?? []) collect(child);
  };
  collect(root);
  const formats: Record<string, string> = {
    strong: "strong",
    b: "strong",
    em: "emphasis",
    i: "emphasis",
    s: "delete",
    del: "delete",
    code: "inlineCode",
  };
  const formatted = (tag: string, value: string): Node =>
    formats[tag] === "inlineCode"
      ? { type: "inlineCode", value }
      : { type: formats[tag]!, children: [{ type: "text", value }] };
  const images: { attachmentId: string; alt: string }[] = [];
  const clean = (node: Node, depth = 0): Node | undefined => {
    if (depth > 64) throw new Error("MARKDOWN_DEPTH");
    if (node.type === "html") {
      const pair =
        formattingHtml &&
        /^<(strong|b|em|i|s|del|code)>([^<>\n]*)<\/\1>\s*$/i.exec(node.value ?? "");
      return pair
        ? { type: "paragraph", children: [formatted(pair[1]!.toLowerCase(), pair[2]!)] }
        : undefined;
    }
    if (node.type === "definition") return;
    const isImage = node.type === "image" || node.type === "imageReference";
    const isLink = node.type === "link" || node.type === "linkReference";
    if (isImage || isLink) {
      const value = node.url ?? definitions.get(node.identifier?.toLowerCase() ?? "") ?? "";
      const destination = markdownDestination(value, isImage);
      if (isImage) {
        const id = destination ? attachmentIdFrom(destination) : undefined;
        if (id) images.push({ attachmentId: id, alt: node.alt || id });
        return { type: "text", value: id ? "" : `[${node.alt || "Image unavailable"}]` };
      }
      if (!destination)
        return { type: "text", value: (node.children ?? []).map((n) => n.value ?? "").join("") };
      node = { ...node, type: "link", url: destination };
      delete node.identifier;
    }
    if (node.children) {
      if (formattingHtml) {
        const children: Node[] = [];
        for (let i = 0; i < node.children.length; i++) {
          const current = node.children[i]!,
            middle = node.children[i + 1],
            closing = node.children[i + 2];
          const open =
            current.type === "html" && /^<(strong|b|em|i|s|del|code)>$/i.exec(current.value ?? "");
          if (
            open &&
            middle?.type === "text" &&
            closing?.type === "html" &&
            closing.value?.toLowerCase() === `</${open[1]!.toLowerCase()}>`
          ) {
            children.push(formatted(open[1]!.toLowerCase(), middle.value ?? ""));
            i += 2;
          } else children.push(current);
        }
        node.children = children;
      }
      node.children = node.children.flatMap((child) => {
        const safe = clean(child, depth + 1);
        return safe ? [safe] : [];
      });
    }
    return node;
  };
  const parts: MarkdownPart[] = [];
  let segment: Node[] = [];
  const flush = () => {
    if (segment.length) {
      parts.push({ markdown: parser.stringify({ type: "root", children: segment } as never) });
      segment = [];
    }
  };
  for (const child of root.children ?? []) {
    const before = images.length;
    const safe = clean(child);
    if (safe) segment.push(safe);
    if (images.length > before) {
      flush();
      parts.push(...images.slice(before));
    }
  }
  flush();
  return parts;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const MATH = /^\s{0,3}\$\$/;
const REFERENCE = /^\s{0,3}\[[^\]]+\]:\s*\S/m;

/**
 * Splits Markdown into top-level blocks at blank lines, never inside code fences or $$ math,
 * and never before an indented continuation line. While a long answer streams, finished
 * blocks keep identical text, so renderers can memoise them and only re-parse the last one.
 * Text with reference-style link definitions stays whole (definitions apply document-wide).
 */
export function splitMarkdownBlocks(text: string): string[] {
  if (REFERENCE.test(text)) return text.trim() ? [text] : [];
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let math = false;
  const flush = () => {
    const block = current.join("\n").replace(/\n+$/, "");
    if (block.trim()) blocks.push(block);
    current = [];
  };
  lines.forEach((line, index) => {
    const opener = FENCE.exec(line)?.[1];
    if (fence) {
      if (opener && opener[0] === fence[0] && opener.length >= fence.length) fence = null;
    } else if (opener) fence = opener;
    else if (MATH.test(line)) math = !math;
    const next = lines[index + 1];
    const blank = !line.trim();
    if (blank && !fence && !math && current.length && next !== undefined && !/^\s/.test(next)) {
      flush();
      return;
    }
    current.push(line);
  });
  flush();
  return blocks;
}

/**
 * Models often write LaTeX as \( … \) and \[ … \]; Markdown math only knows $ … $ and $$ … $$.
 * Rewrites the former outside code fences and inline code, so the formula renders instead of
 * showing its backslashes.
 */
export function normalizeMathDelimiters(text: string): string {
  if (!text.includes("\\(") && !text.includes("\\[") && !text.includes("$")) return text;
  let fence = false;
  return text
    .split("\n")
    .map((line) => {
      if (FENCE.test(line)) {
        fence = !fence;
        return line;
      }
      if (fence) return line;
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, index) =>
          index % 2
            ? part
            : part
                .replace(/\\\[/g, "$$$$")
                .replace(/\\\]/g, "$$$$")
                .replace(/\\\(\s*/g, "$$")
                .replace(/\s*\\\)/g, "$$")
                .replace(INLINE_MATH, spaced),
        )
        .join("");
    })
    .join("\n");
}

// Inline math whose content neither starts nor ends with a space (so "$5와 $10" is money, not math).
const INLINE_MATH = /(?<!\$)\$(?!\$)(?=\S)([^$\n]*?\S)\$(?!\$)/g;
const HAIR = "\u200A";
const LETTER = /[\p{L}\p{N}]/u;

/**
 * Markdown math ($…$) only opens after whitespace or punctuation and only closes before it, so
 * "질량 $M$을" stays raw text. A hair space (Unicode whitespace, nearly invisible) goes where the
 * formula touches a letter.
 */
function spaced(match: string, _body: string, offset: number, line: string): string {
  const before = offset > 0 && LETTER.test(line[offset - 1] ?? "") ? HAIR : "";
  const after = LETTER.test(line[offset + match.length] ?? "") ? HAIR : "";
  return before + match + after;
}
