// What goes to a native SVG view is checked first. react-native-svg parses paths, lengths and
// enums on the UI thread: one bad string throws there, past every JS error boundary, and takes the
// whole app down. So a drawing only ever receives values of the exact shape the native side reads,
// whatever the model wrote; anything else is left out, the way a browser ignores a bad attribute.

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const NUMBERS = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const MAX_COORD = 1e6;
const MAX_PATH = 60_000;

/** A coordinate in plain decimal notation, within a range every parser takes. */
const fmt = (n: number) => Math.round(Math.max(-MAX_COORD, Math.min(MAX_COORD, n)) * 1e5) / 1e5;

const PATH_ARGS: Record<string, string> = {
  m: "nn",
  l: "nn",
  h: "n",
  v: "n",
  c: "nnnnnn",
  s: "nnnn",
  q: "nnnn",
  t: "nn",
  a: "nnnffnn",
  z: "",
};

/**
 * Path data rewritten command by command. Like a browser, it draws up to the first error: what
 * comes after it (or an unfinished command) is dropped. undefined when nothing can be drawn.
 */
export function safePath(d: unknown): string | undefined {
  if (typeof d !== "string") return undefined;
  const s = d.length > MAX_PATH ? d.slice(0, MAX_PATH) : d;
  const out: string[] = [];
  let i = 0;
  let cmd = "";
  const space = () => {
    while (
      i < s.length &&
      (s[i] === " " || s[i] === "," || s[i] === "\n" || s[i] === "\t" || s[i] === "\r")
    )
      i++;
  };
  while (true) {
    space();
    if (i >= s.length) break;
    const c = s[i] as string;
    if (/[a-zA-Z]/.test(c)) {
      const kind = c.toLowerCase();
      if (!(kind in PATH_ARGS)) break;
      // The first command has to be a move.
      if (!out.length && kind !== "m") return undefined;
      i++;
      if (kind === "z") {
        out.push(c);
        cmd = "";
        continue;
      }
      cmd = c;
    } else if (!cmd) break;
    const args: (number | string)[] = [];
    let whole = true;
    for (const kind of PATH_ARGS[cmd.toLowerCase()] as string) {
      space();
      if (kind === "f") {
        if (s[i] !== "0" && s[i] !== "1") {
          whole = false;
          break;
        }
        args.push(s[i] as string);
        i++;
      } else {
        NUMBER.lastIndex = i;
        const m = NUMBER.exec(s);
        const n = m ? Number(m[0]) : Number.NaN;
        if (!m || !Number.isFinite(n)) {
          whole = false;
          break;
        }
        args.push(fmt(n));
        i = NUMBER.lastIndex;
      }
    }
    if (!whole) break;
    out.push(`${cmd}${args.join(" ")}`);
    // More pairs after a move are lines.
    if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
  }
  return out.length ? out.join(" ") : undefined;
}

/** `points` from any form a model writes: "1,2 3,4", [[1, 2]], [{x, y}] or [1, 2, 3, 4]. */
export function safePoints(v: unknown): string | undefined {
  const nums: number[] = [];
  const add = (x: unknown, y: unknown) => {
    const a = Number(x);
    const b = Number(y);
    if (
      x !== null &&
      y !== null &&
      x !== "" &&
      y !== "" &&
      Number.isFinite(a) &&
      Number.isFinite(b)
    )
      nums.push(fmt(a), fmt(b));
  };
  if (typeof v === "string") {
    const found = v.slice(0, MAX_PATH).match(NUMBERS) ?? [];
    for (let i = 0; i + 1 < found.length; i += 2) add(found[i], found[i + 1]);
  } else if (Array.isArray(v)) {
    if (v.every((p) => typeof p === "number" || typeof p === "string")) {
      for (let i = 0; i + 1 < v.length; i += 2) add(v[i], v[i + 1]);
    } else {
      for (const p of v) {
        if (Array.isArray(p)) add(p[0], p[1]);
        else if (p && typeof p === "object") {
          const o = p as Record<string, unknown>;
          add(o.x, o.y);
        }
      }
    }
  }
  if (!nums.length) return undefined;
  const pairs: string[] = [];
  for (let i = 0; i < nums.length; i += 2) pairs.push(`${nums[i]},${nums[i + 1]}`);
  return pairs.join(" ");
}

/** A dash pattern; undefined for "none", garbage, or one that would draw nothing. */
export function safeDashes(v: unknown): number[] | undefined {
  const raw =
    typeof v === "string"
      ? (v.match(NUMBERS) ?? [])
      : Array.isArray(v)
        ? v
        : typeof v === "number"
          ? [v]
          : [];
  const nums = raw
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .map((n) => Math.min(n, MAX_COORD));
  return nums.length && nums.some((n) => n > 0) ? nums : undefined;
}

/** [x, y, width, height] when the viewBox can be used. */
export function safeViewBox(v: unknown): [number, number, number, number] | null {
  if (typeof v !== "string") return null;
  const n = v
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (n.length !== 4 || !n.every(Number.isFinite)) return null;
  const [x, y, w, h] = n as [number, number, number, number];
  return w > 0 && h > 0 ? [fmt(x), fmt(y), Math.min(w, MAX_COORD), Math.min(h, MAX_COORD)] : null;
}

const lengthOf = (v: unknown, lo = -MAX_COORD, hi = MAX_COORD): number | string | undefined => {
  if (typeof v === "number")
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, fmt(v))) : undefined;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (/^-?(?:\d+\.?\d*|\.\d+)%$/.test(s)) return s;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:px)?$/.test(s)) {
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, fmt(n))) : undefined;
  }
  return undefined;
};

const LENGTHS = new Set([
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
  "dx",
  "dy",
  "fx",
  "fy",
  "strokeDashoffset",
  "letterSpacing",
  "wordSpacing",
  "startOffset",
  "markerWidth",
  "markerHeight",
  "refX",
  "refY",
  "strokeMiterlimit",
]);
const FRACTIONS = new Set(["opacity", "fillOpacity", "strokeOpacity", "stopOpacity", "offset"]);
const COLORS = new Set(["fill", "stroke", "stopColor", "color"]);
const REFS = new Set(["clipPath", "markerStart", "markerMid", "markerEnd"]);
const CHOICES: Record<string, Record<string, string>> = {
  fillRule: { evenodd: "evenodd", nonzero: "nonzero" },
  clipRule: { evenodd: "evenodd", nonzero: "nonzero" },
  strokeLinecap: { butt: "butt", round: "round", square: "square" },
  strokeLinejoin: { miter: "miter", round: "round", bevel: "bevel" },
  textAnchor: {
    start: "start",
    middle: "middle",
    end: "end",
    left: "start",
    center: "middle",
    right: "end",
  },
  fontStyle: { normal: "normal", italic: "italic", oblique: "oblique" },
  textDecoration: {
    none: "none",
    underline: "underline",
    overline: "overline",
    "line-through": "line-through",
  },
  alignmentBaseline: {
    baseline: "baseline",
    alphabetic: "alphabetic",
    middle: "middle",
    central: "central",
    hanging: "hanging",
    top: "top",
    bottom: "bottom",
    center: "center",
    "text-top": "text-top",
    "text-bottom": "text-bottom",
    "text-before-edge": "text-before-edge",
    "text-after-edge": "text-after-edge",
    "before-edge": "before-edge",
    "after-edge": "after-edge",
    ideographic: "ideographic",
    mathematical: "mathematical",
  },
  gradientUnits: { userSpaceOnUse: "userSpaceOnUse", objectBoundingBox: "objectBoundingBox" },
  markerUnits: { userSpaceOnUse: "userSpaceOnUse", strokeWidth: "strokeWidth" },
};
const TRANSFORM =
  /^\s*(?:(?:matrix|translate|translateX|translateY|scale|rotate|skewX|skewY)\(\s*[-+.\de\s,]*\)\s*,?\s*)+$/;
const ASPECT = /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/;
const WEIGHTS: Record<string, string> = {
  normal: "400",
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  bolder: "700",
  heavy: "700",
  black: "900",
  lighter: "300",
  light: "300",
};

/** The elements a drawing can hold. `use`, `symbol`, `pattern`, `mask` and filters stay out: they can recurse or allocate without limit natively. */
export const SVG_ELEMENTS = new Set([
  "g",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "path",
  "text",
  "tspan",
  "textpath",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "marker",
  "image",
]);

/**
 * An SVG element's attributes as react-native-svg props, checked one by one. `color` resolves a
 * colour as written. null when the element has nothing to draw (a path without valid data).
 */
export function safeSvgProps(
  tag: string,
  attrs: Record<string, unknown>,
  color: (v: unknown) => string | undefined,
): Record<string, unknown> | null {
  const props: Record<string, unknown> = {};
  for (const [raw, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    const k =
      raw === "xlink:href" || raw === "src"
        ? "href"
        : raw === "dominantBaseline" || raw === "dominant-baseline"
          ? "alignmentBaseline"
          : raw.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    if (COLORS.has(k)) {
      const c = color(v);
      if (c) props[k] = c;
    } else if (LENGTHS.has(k)) {
      const n = lengthOf(v);
      if (n !== undefined) props[k] = n;
    } else if (FRACTIONS.has(k)) {
      const n = lengthOf(v, 0, 1);
      if (n !== undefined) props[k] = n;
    } else if (k === "strokeWidth") {
      const n = lengthOf(v, 0, 1000);
      if (n !== undefined) props[k] = n;
    } else if (k === "fontSize") {
      const n = lengthOf(v, 1, 400);
      if (typeof n === "number") props[k] = n;
    } else if (k === "fontWeight") {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n) && n >= 1 && n <= 1000) props[k] = String(Math.round(n));
      else if (typeof v === "string" && WEIGHTS[v]) props[k] = WEIGHTS[v];
    } else if (k === "fontFamily") {
      if (typeof v === "string" && /mono|courier|consolas|menlo/i.test(v)) props[k] = "monospace";
    } else if (CHOICES[k]) {
      const choice = typeof v === "string" ? CHOICES[k]?.[v] : undefined;
      if (choice) props[k] = choice;
    } else if (REFS.has(k)) {
      if (typeof v === "string" && /^url\(#[\w-]+\)$/.test(v.trim())) props[k] = v.trim();
    } else if (k === "id") {
      if (typeof v === "string" && /^[\w-]+$/.test(v)) props.id = v;
    } else if (k === "transform" || k === "gradientTransform") {
      if (typeof v === "string" && TRANSFORM.test(v)) props[k] = v;
    } else if (k === "preserveAspectRatio") {
      if (typeof v === "string" && ASPECT.test(v.trim())) props[k] = v.trim();
    } else if (k === "orient") {
      const n = lengthOf(v);
      props.orient = typeof n === "number" ? String(n) : "auto";
    } else if (k === "viewBox") {
      const box = safeViewBox(v);
      if (box) props.viewBox = box.join(" ");
    } else if (k === "strokeDasharray") {
      const dashes = safeDashes(v);
      if (dashes) props.strokeDasharray = dashes;
    } else if (k === "d") {
      const path = safePath(v);
      if (path) props.d = path;
    } else if (k === "points") {
      const points = safePoints(v);
      if (points) props.points = points;
    } else if (k === "href") {
      if (typeof v !== "string") continue;
      if (tag === "image" ? /^https:\/\//.test(v) : /^#[\w-]+$/.test(v)) props.href = v;
    }
  }
  if (tag === "path" && !props.d) return null;
  if ((tag === "polyline" || tag === "polygon") && !props.points) return null;
  if ((tag === "image" || tag === "textpath") && !props.href) return null;
  return props;
}

// ── coordinates ─────────────────────────────────────────────────────────────────────────────────

/** A 2D transform as SVG writes it: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = readonly [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m applied after n: a point goes through n first. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const transformPoint = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

const FUNCTION = /(matrix|translateX|translateY|translate|scale|rotate|skewX|skewY)\(([^)]*)\)/g;

/** A transform attribute as a matrix; null when it can't be read. */
export function parseTransform(v: unknown): Matrix | null {
  if (typeof v !== "string" || !TRANSFORM.test(v)) return null;
  let out: Matrix = IDENTITY;
  for (const [, name, args] of v.matchAll(FUNCTION)) {
    const n = (args?.match(NUMBERS) ?? []).map(Number);
    const a = n[0] ?? 0;
    const b = n[1];
    let t: Matrix = IDENTITY;
    if (name === "matrix" && n.length === 6) t = n as unknown as Matrix;
    else if (name === "translate") t = [1, 0, 0, 1, a, b ?? 0];
    else if (name === "translateX") t = [1, 0, 0, 1, a, 0];
    else if (name === "translateY") t = [1, 0, 0, 1, 0, a];
    else if (name === "scale") t = [a, 0, 0, b ?? a, 0, 0];
    else if (name === "rotate") {
      const r = (a * Math.PI) / 180;
      const c = Math.cos(r);
      const s = Math.sin(r);
      t = [c, s, -s, c, 0, 0];
      if (b !== undefined && n[2] !== undefined)
        t = multiply(multiply([1, 0, 0, 1, b, n[2]], t), [1, 0, 0, 1, -b, -n[2]]);
    } else if (name === "skewX") t = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
    else if (name === "skewY") t = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0];
    out = multiply(out, t);
  }
  return out.every(Number.isFinite) ? out : null;
}

/** The viewBox onto a view of this size, as `preserveAspectRatio` places it (default: centred, whole). */
export function viewBoxMatrix(
  box: readonly [number, number, number, number],
  width: number,
  height: number,
  aspect?: unknown,
): Matrix {
  const [x, y, w, h] = box;
  const rule = typeof aspect === "string" ? aspect.trim() : "xMidYMid meet";
  if (rule === "none") {
    const sx = width / w;
    const sy = height / h;
    return [sx, 0, 0, sy, -x * sx, -y * sy];
  }
  const s = rule.endsWith("slice")
    ? Math.max(width / w, height / h)
    : Math.min(width / w, height / h);
  const ax = rule.includes("xMin") ? 0 : rule.includes("xMax") ? 1 : 0.5;
  const ay = rule.includes("YMin") ? 0 : rule.includes("YMax") ? 1 : 0.5;
  return [s, 0, 0, s, (width - w * s) * ax - x * s, (height - h * s) * ay - y * s];
}
