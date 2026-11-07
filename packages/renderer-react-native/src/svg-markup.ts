// SVG markup from a model, made safe to draw: only shape, text and gradient elements with
// presentation attributes survive. Scripts, styles, links, images, foreign content, event
// handlers, entities and every address other than a local `url(#id)` are dropped.

const ELEMENTS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "title",
  "desc",
]);
/** Elements dropped with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "foreignobject",
  "a",
  "image",
  "use",
  "iframe",
  "animate",
  "set",
  "animatetransform",
  "animatemotion",
  "metadata",
  "pattern",
  "symbol",
  "marker",
  "filter",
  "mask",
  "switch",
]);
const ATTRIBUTES = new Set([
  "viewbox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "d",
  "points",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "stroke-opacity",
  "fill-opacity",
  "fill-rule",
  "clip-rule",
  "opacity",
  "transform",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientunits",
  "gradienttransform",
  "spreadmethod",
  "font-size",
  "font-weight",
  "font-family",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "id",
  "clip-path",
  "clippathunits",
  "dx",
  "dy",
  "preserveaspectratio",
  "xmlns",
]);
const MAX_ELEMENTS = 600;

const escapeText = (s: string) =>
  s
    .replace(/&(?!(amp|lt|gt|quot|apos|#\d{1,6}|#x[0-9a-f]{1,6});)/gi, "&amp;")
    .replace(/</g, "&lt;");
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

/** A value is kept unless it reaches outside the drawing. */
function safeValue(value: string): boolean {
  const v = value.toLowerCase();
  if (/javascript:|data:|https?:|\/\/|expression\(|@import/.test(v)) return false;
  const urls = v.match(/url\(([^)]*)\)/g) ?? [];
  return urls.every((u) => /^url\(\s*['"]?#[\w-]+['"]?\s*\)$/.test(u));
}

function attributes(raw: string): string {
  const out: string[] = [];
  const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    const name = m[1]!;
    const value = m[3] ?? m[4] ?? "";
    if (!ATTRIBUTES.has(name.toLowerCase()) || !safeValue(value)) continue;
    out.push(`${name}="${escapeAttr(value)}"`);
  }
  return out.length ? ` ${out.join(" ")}` : "";
}

/** Returns the cleaned markup (one root svg), or null when nothing drawable is left. */
export function sanitizeSvg(markup: string): string | null {
  const src = markup
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  const out: string[] = [];
  const open: string[] = [];
  let dropping = 0;
  let dropName = "";
  let count = 0;
  let sawRoot = false;
  const re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m[5] !== undefined) {
      if (!dropping && open.length && /^(text|tspan|title|desc)$/.test(open.at(-1)!))
        out.push(escapeText(m[5]));
      continue;
    }
    const closing = m[1] === "/";
    const name = m[2]!.toLowerCase();
    const selfClosing = m[4] === "/" || /\/\s*$/.test(m[3] ?? "");
    if (dropping) {
      if (name === dropName && !selfClosing) dropping += closing ? -1 : 1;
      continue;
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !selfClosing) {
        dropping = 1;
        dropName = name;
      }
      continue;
    }
    if (!ELEMENTS.has(name)) continue;
    if (closing) {
      const at = open.lastIndexOf(name);
      if (at < 0) continue;
      while (open.length > at) out.push(`</${tagOf(open.pop()!)}>`);
      if (!open.length) break;
      continue;
    }
    if (!open.length && name !== "svg") continue;
    if (name === "svg" && open.length) continue;
    if (++count > MAX_ELEMENTS) break;
    if (name === "svg") sawRoot = true;
    out.push(`<${tagOf(name)}${attributes(m[3] ?? "")}${selfClosing ? "/" : ""}>`);
    if (!selfClosing) open.push(name);
  }
  while (open.length) out.push(`</${tagOf(open.pop()!)}>`);
  return sawRoot && count > 1 ? out.join("") : null;
}

const CASED: Record<string, string> = {
  lineargradient: "linearGradient",
  radialgradient: "radialGradient",
  clippath: "clipPath",
};
const tagOf = (name: string) => CASED[name] ?? name;

/** Width ÷ height of the drawing: its viewBox, else its width and height, else square. */
export function svgAspect(markup: string): number {
  const root = /<svg\b([^>]*)>/i.exec(markup)?.[1] ?? "";
  const box =
    /viewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)\s*["']/i.exec(root);
  const w = Number(box?.[1] ?? /\bwidth\s*=\s*["']([\d.]+)/i.exec(root)?.[1]);
  const h = Number(box?.[2] ?? /\bheight\s*=\s*["']([\d.]+)/i.exec(root)?.[1]);
  return w > 0 && h > 0 ? Math.min(5, Math.max(0.2, w / h)) : 1;
}
