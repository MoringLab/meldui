import { componentSchemas, type Expr, SceneNodeSchema } from "@engine/protocol";
import { SaxesParser } from "saxes";
export type SvgPart = {
  label?: string;
  transforms?: unknown[];
  attributes?: Record<string, unknown>;
  explode?: { path: string; x?: number; y?: number };
  action?: unknown;
  keyframes?: {
    path: string;
    from: { x?: number; y?: number; angle?: number; scale?: number };
    to: { x?: number; y?: number; angle?: number; scale?: number };
  };
};
export type CompiledSvg = { scene: Record<string, any>; parts: { id: string; label: string }[] };
const numeric = new Set([
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
  "width",
  "height",
  "opacity",
  "strokeWidth",
  "strokeDashoffset",
  "fontSize",
  "fillOpacity",
  "strokeOpacity",
]);
const aliases: Record<string, string> = {
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "font-size": "fontSize",
  "text-anchor": "textAnchor",
  "fill-opacity": "fillOpacity",
  "stroke-opacity": "strokeOpacity",
  "fill-rule": "fillRule",
  "font-weight": "fontWeight",
};
const supported = new Set([
  "g",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "path",
  "text",
]);
const computed = (expr: Expr) => ({ call: "computeNumber", args: { expr }, returnType: "number" });
/** XML is compiled to the same bounded, inert scene on all targets; never inserted as HTML. */
export function compileSvg(
  source: string,
  options: { title: string; description: string; parts?: Record<string, SvgPart> },
): CompiledSvg {
  if (new TextEncoder().encode(source).length > 131072) throw Error("SVG_SOURCE_LIMIT");
  const parser = new SaxesParser({ xmlns: false });
  const nodes: any[] = [],
    stack: any[] = [],
    parts: CompiledSvg["parts"] = [],
    ids = new Set<string>();
  let viewBox: number[] | undefined,
    titleDepth = 0,
    count = 0;
  const scene: Record<string, any> = {
    title: options.title,
    description: options.description,
    nodes,
    viewBox: [0, 0, 640, 400],
  };
  parser.on("doctype", () => {
    throw Error("SVG_DOCTYPE");
  });
  parser.on("processinginstruction", () => {
    throw Error("SVG_PROCESSING_INSTRUCTION");
  });
  parser.on("opentag", (tag) => {
    if (++count > 300 || stack.length > 12) throw Error("SCENE_ELEMENT_LIMIT");
    const a = tag.attributes as Record<string, string>;
    if (tag.name === "svg" && stack.length === 0) {
      if (viewBox) throw Error("SVG_ROOT");
      viewBox = (a.viewBox ?? `0 0 ${a.width ?? 640} ${a.height ?? 400}`)
        .trim()
        .split(/[ ,]+/)
        .map(Number);
      if (
        viewBox.length !== 4 ||
        viewBox.some((v) => !Number.isFinite(v)) ||
        viewBox[2]! <= 0 ||
        viewBox[3]! <= 0
      )
        throw Error("SVG_VIEWBOX");
      for (const k of Object.keys(a))
        if (!["xmlns", "viewBox", "width", "height", "role", "aria-label"].includes(k))
          throw Error("SVG_ATTRIBUTE");
      scene.viewBox = viewBox;
      stack.push({ children: nodes });
      return;
    }
    if (!viewBox) throw Error("SVG_ROOT");
    if (tag.name === "title" || tag.name === "desc") {
      titleDepth++;
      stack.push({ ignored: true });
      return;
    }
    if (titleDepth || !supported.has(tag.name)) throw Error("SVG_ELEMENT");
    const node: any = {
      type: tag.name === "g" ? "group" : tag.name,
      attrs: {},
      ...(tag.name === "g" ? { children: [] } : {}),
    };
    const attrs = { ...a };
    if (attrs.style) {
      for (const declaration of attrs.style.split(";").filter((v) => v.trim())) {
        const at = declaration.indexOf(":");
        if (at < 0) throw Error("SVG_STYLE");
        const name = declaration.slice(0, at).trim();
        if (
          ![
            "fill",
            "stroke",
            "stroke-width",
            "stroke-linecap",
            "stroke-linejoin",
            "opacity",
            "font-size",
            "text-anchor",
            "fill-opacity",
            "stroke-opacity",
            "fill-rule",
            "font-weight",
            "stroke-dasharray",
            "stroke-dashoffset",
          ].includes(name)
        )
          throw Error("SVG_STYLE");
        if (Object.hasOwn(attrs, name)) throw Error("SVG_STYLE_CONFLICT");
        attrs[name] = declaration.slice(at + 1).trim();
      }
      delete attrs.style;
    }
    for (const [raw, v] of Object.entries(attrs)) {
      const key = aliases[raw] ?? raw;
      if (raw === "id" || raw === "data-part") {
        if (node.id && node.id !== v) throw Error("SVG_PART_ID");
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(v)) throw Error("SVG_PART_ID");
        node.id = v;
        continue;
      }
      if (raw === "aria-label") {
        node.label = v;
        continue;
      }
      if (numeric.has(key)) {
        const value = Number(v.replace(/px$/, ""));
        if (!Number.isFinite(value) || Math.abs(value) > 100000)
          throw Object.assign(Error("SVG_NUMBER"), {
            path: `/svg/attributes/${raw}`,
            expected: "Finite numeric SVG value, optionally px; no percentage or unit suffix",
          });
        node.attrs[key] = value;
      } else if (key === "strokeDasharray") node.attrs[key] = v;
      else if (key === "fontWeight") node.attrs[key] = /^\d+$/.test(v) ? Number(v) : v;
      else if (key === "fillRule") node.attrs[key] = v;
      else if (["fill", "stroke"].includes(key))
        node.attrs[key] = v.replace(
          /^var\(--ui-(accent|foreground|muted|border|surface|success|danger)\)$/,
          "$1",
        );
      else if (
        ["d", "points", "transform", "strokeLinecap", "strokeLinejoin", "textAnchor"].includes(key)
      )
        node.attrs[key] = v;
      else
        throw Object.assign(Error("SVG_ATTRIBUTE"), {
          path: `/svg/attributes/${raw}`,
          expected:
            "Geometry, fill/stroke/opacity, fill-rule, font-size/weight, text-anchor, transform, id, data-part or aria-label only; no CSS class or font-family",
        });
    }
    if (node.id) {
      if (ids.has(node.id)) throw Error("SVG_DUPLICATE_ID");
      ids.add(node.id);
      const part = options.parts?.[node.id];
      node.label = part?.label ?? node.label ?? node.id;
      parts.push({ id: node.id, label: node.label });
      if (part?.transforms) node.transforms = part.transforms;
      if (part?.keyframes) {
        const frame = part.keyframes;
        const value = (key: keyof typeof frame.from, fallback: number) =>
          computed({
            op: "lerp",
            args: [
              frame.from[key] ?? fallback,
              frame.to[key] ?? fallback,
              { op: "clamp", args: [{ ref: frame.path }, 0, 1] },
            ],
          });
        node.transforms = [
          ...(node.transforms ?? []),
          { kind: "translate", x: value("x", 0), y: value("y", 0) },
          { kind: "rotate", angle: value("angle", 0) },
          { kind: "scale", x: value("scale", 1), y: value("scale", 1) },
        ];
      }
      if (part?.attributes) node.attrs = { ...node.attrs, ...part.attributes };
      if (part?.explode) {
        const { path, x = 0, y = 0 } = part.explode;
        node.transforms = [
          ...(node.transforms ?? []),
          {
            kind: "translate",
            x: computed({ op: "mul", args: [{ ref: path }, x] }),
            y: computed({ op: "mul", args: [{ ref: path }, y] }),
          },
        ];
      }
      if (part?.action) node.action = part.action;
    }
    const parent = stack.at(-1);
    if (!parent?.children) throw Error("SVG_NESTING");
    parent.children.push(node);
    stack.push(node);
  });
  parser.on("text", (text) => {
    const node = stack.at(-1);
    if (node?.type === "text") node.text = (node.text ?? "") + text;
    else if (!titleDepth && text.trim()) throw Error("SVG_TEXT");
  });
  parser.on("closetag", () => {
    const node = stack.pop();
    if (node?.ignored) titleDepth--;
  });
  parser.write(source).close();
  if (!viewBox) throw Error("SVG_ROOT");
  for (const id of Object.keys(options.parts ?? {}))
    if (!ids.has(id)) throw Error("SVG_UNKNOWN_PART");
  for (const node of nodes) SceneNodeSchema.parse(node);
  return { scene: componentSchemas.SvgScene.parse(scene), parts };
}
