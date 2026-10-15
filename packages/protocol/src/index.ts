import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export * from "./answer.js";
export * from "./attachments.js";
export * from "./support.js";

/** Stable wire profile shared by every Engine renderer. */
export const PROTOCOL_VERSION = "v0.9" as const;
export const CATALOG_ID = "urn:engine:catalog:core:1";
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Expr =
  | null
  | boolean
  | number
  | string
  | { ref: string }
  | { op: string; args: Expr[] };
export const EXPRESSION_OPS = [
  "add",
  "sub",
  "mul",
  "div",
  "mod",
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "and",
  "or",
  "not",
  "if",
  "format",
  "sum",
  "count",
  "min",
  "max",
  "array",
  "round",
  "sin",
  "cos",
  "exp",
  "log",
  "pow",
  "sqrt",
  "clamp",
  "lerp",
  "floor",
  "range",
  "map",
  "filter",
  "sort",
  "reduce",
  "scan",
  "series",
  "rng",
  "get",
  "numberFormat",
  // State building: lists and records that UI actions update locally (todos, scores, decks).
  "concat",
  "set",
  "object",
  "slice",
  "join",
  "includes",
  "abs",
] as const;
const ops = EXPRESSION_OPS;
export const ExprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.object({ ref: z.string().max(1024) }).strict(),
    z.object({ op: z.enum(ops), args: z.array(ExprSchema).max(1000) }).strict(),
  ]),
);
export const BindingSchema = z
  .object({ path: z.string().max(1024) })
  .strict()
  .describe("REF:#/$defs/DataBinding");
/**
 * A formula string compiles to the same expression tree (no eval): "/price * /qty * (1 - /rate / 100)".
 * Far shorter and less error-prone for a model than a nested AST.
 */
export const FormulaSchema = z.string().min(1).max(2000);
const ComputedArgs = z.union([
  z.object({ expr: ExprSchema }).strict(),
  z.object({ formula: FormulaSchema }).strict(),
]);
const ComputedSchema = z
  .object({
    call: z.enum(["computeNumber", "computeString", "computeBoolean", "computeArray"]),
    args: ComputedArgs,
    // Implied by `call`; optional so a missing one is not an error.
    returnType: z.enum(["number", "string", "boolean", "array"]).optional(),
  })
  .strict();
export type Binding = z.infer<typeof BindingSchema>;
export type Value<T = Json> = T | Binding | z.infer<typeof ComputedSchema>;
const text = z
  .union([z.string().max(32768), BindingSchema, ComputedSchema])
  .describe("REF:#/$defs/DynamicString");
const number = z
  .union([z.number().finite(), BindingSchema, ComputedSchema])
  .describe("REF:#/$defs/DynamicNumber");
const boolean = z
  .union([z.boolean(), BindingSchema, ComputedSchema])
  .describe("REF:#/$defs/DynamicBoolean");
const array = z
  .union([z.array(z.unknown()).max(1000), BindingSchema, ComputedSchema])
  .describe("REF:#/$defs/DynamicValue");
const child = z.string().min(1).max(128).describe("REF:#/$defs/ComponentId");
const childListValue = z
  .union([
    z.array(child).max(2000),
    z.object({ componentId: child, path: z.string().max(1024) }).strict(),
  ])
  .describe("REF:#/$defs/ChildList");
/** A template wrapped in a list ([{componentId, path}]) — a common model slip — is the template. */
export const ChildListSchema = z.preprocess(
  (value) =>
    Array.isArray(value) &&
    value.length === 1 &&
    value[0] &&
    typeof value[0] === "object" &&
    "componentId" in value[0]
      ? value[0]
      : value,
  childListValue,
);
export type ChildList = z.infer<typeof ChildListSchema>;
export const ActionSchema = z
  .union([
    z
      .object({
        event: z
          .object({ name: z.string().min(1).max(128), context: z.record(z.unknown()).optional() })
          .strict(),
      })
      .strict(),
    z
      .object({
        functionCall: z
          .object({
            call: z.enum(["setValue", "setValues", "copyText", "openUrl"]),
            args: z.record(z.unknown()),
            returnType: z.literal("void").optional(),
          })
          .strict(),
      })
      .strict(),
  ])
  .describe("REF:#/$defs/Action");
export type Action = z.infer<typeof ActionSchema>;
const updateValue = z
  .object({
    path: z.string().max(1024),
    value: z.unknown().optional(),
    expr: ExprSchema.optional(),
    formula: FormulaSchema.optional(),
  })
  .strict();
export const functionDefinitions = [
  ...(["Number", "String", "Boolean", "Array"] as const).map((type) => ({
    name: `compute${type}`,
    returnType: type.toLowerCase(),
    schema: ComputedArgs,
    pure: true,
  })),
  { name: "setValue", returnType: "void", schema: updateValue, pure: false },
  {
    name: "setValues",
    returnType: "void",
    schema: z.object({ updates: z.array(updateValue).max(20) }).strict(),
    pure: false,
  },
  { name: "copyText", returnType: "void", schema: z.object({ text }).strict(), pure: false },
  { name: "openUrl", returnType: "void", schema: z.object({ url: text }).strict(), pure: false },
];
const gap = z.enum(["xs", "sm", "md", "lg", "xl"]).optional();
/** Icon names are open: the kit lists the names its hosts draw (kit.icons); unknown names fall back. */
export const iconName = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
/** Built-in icons every renderer draws without a host icon set. */
export const BUILTIN_ICONS = ["check", "info", "arrow", "plus", "star", "close"] as const;
const common = { visible: boolean.optional(), accessibilityLabel: z.string().max(256).optional() };
const layout = {
  children: ChildListSchema,
  gap,
  align: z.enum(["start", "center", "end", "stretch"]).optional(),
  // The sizing a Box has: models reach for it on rows and columns too.
  justify: z.enum(["start", "center", "end", "between", "around"]).optional(),
  wrap: z.boolean().optional(),
  padding: z.enum(["none", "xs", "sm", "md", "lg", "xl"]).optional(),
  width: z.union([z.enum(["fill", "hug"]), z.number().min(0.1).max(1)]).optional(),
  flex: z.number().min(0).max(12).optional(),
};
const input = {
  label: text,
  value: z.union([text, number, boolean]),
  disabled: boolean.optional(),
  error: text.optional(),
};
const item = z.object({ id: z.string().min(1), label: text, child }).strict();

const sceneColor = z
  .string()
  .regex(
    /^(#[0-9a-fA-F]{3,8}|none|currentColor|black|white|transparent|red|blue|green|gray|orange|purple|yellow|pink|cyan|magenta|teal|navy|accent|foreground|muted|border|surface|background|success|danger|gradient:[A-Za-z0-9_-]{1,64})$/,
  );
function sceneNodeSchema(depth: number): z.ZodType<any> {
  return z
    .object({
      id: z.string().max(128).optional(),
      type: z.enum([
        "group",
        "rect",
        "circle",
        "ellipse",
        "line",
        "polyline",
        "polygon",
        "path",
        "text",
        "repeat",
      ]),
      attrs: z
        .object({
          x: number.optional(),
          y: number.optional(),
          x1: number.optional(),
          x2: number.optional(),
          y1: number.optional(),
          y2: number.optional(),
          cx: number.optional(),
          cy: number.optional(),
          r: number.optional(),
          rx: number.optional(),
          ry: number.optional(),
          width: number.optional(),
          height: number.optional(),
          opacity: number.optional(),
          strokeWidth: number.optional(),
          strokeDasharray: z
            .union([
              number,
              z
                .string()
                .max(256)
                .regex(/^[0-9., eE+-]+$/),
            ])
            .optional(),
          fillOpacity: number.optional(),
          strokeOpacity: number.optional(),
          fillRule: z.enum(["nonzero", "evenodd"]).optional(),
          fontWeight: z
            .union([z.number().int().min(100).max(900), z.enum(["normal", "bold"])])
            .optional(),
          strokeDashoffset: number.optional(),
          strokeLinecap: z.enum(["round", "butt", "square"]).optional(),
          strokeLinejoin: z.enum(["round", "miter", "bevel"]).optional(),
          fontSize: number.optional(),
          textAnchor: z.enum(["start", "middle", "end"]).optional(),
          clipId: z
            .string()
            .regex(/^[A-Za-z0-9_-]{1,64}$/)
            .optional(),
          fill: sceneColor.optional(),
          stroke: sceneColor.optional(),
          d: z
            .string()
            .max(8192)
            .regex(/^[MmLlHhVvCcSsQqTtAaZz0-9., eE+-]*$/)
            .optional(),
          points: z
            .string()
            .max(8192)
            .regex(/^[0-9., eE+-]*$/)
            .optional(),
          transform: z
            .string()
            .max(256)
            .regex(/^(?:(?:translate|rotate|scale|matrix|skewX|skewY)\([0-9., eE+-]+\)\s*)*$/)
            .optional(),
        })
        .strict()
        .optional(),
      text: text.optional(),
      label: z.string().max(256).optional(),
      transforms: z
        .array(
          z
            .object({
              kind: z.enum(["translate", "rotate", "scale"]),
              x: number.optional(),
              y: number.optional(),
              angle: number.optional(),
              cx: number.optional(),
              cy: number.optional(),
            })
            .strict(),
        )
        .max(8)
        .optional(),
      children:
        depth === 0
          ? z.array(z.never()).max(0).optional()
          : z
              .array(sceneNodeSchema(depth - 1))
              .max(300)
              .optional(),
      items: array.optional(),
      action: ActionSchema.optional(),
      onHover: ActionSchema.optional(),
      dragPath: z.string().max(1024).optional(),
    })
    .strict();
}
// Finite nesting also keeps upstream schema introspection bounded.
export const SceneNodeSchema = sceneNodeSchema(12);
const seriesSchema = z
  .object({ key: z.string().max(128), label: z.string().max(256), color: sceneColor.optional() })
  .strict();
/** Semantic component props: no HTML, CSS, executable code, or remote URLs. */
export const componentSchemas = {
  Confirmation: z.object({
    ...common,
    title: text,
    detail: text,
    label: text,
    action: ActionSchema,
  }),
  ControlPanel: z.object({ ...common, ...layout, title: text.optional() }),
  Stat: z.object({
    ...common,
    label: text,
    icon: iconName.optional(),
    value: z.union([text, number]),
    unit: text.optional(),
    precision: z.number().int().min(0).max(8).optional(),
  }),
  StatGroup: z.object({ ...common, ...layout }),
  Legend: z.object({
    ...common,
    items: z.array(z.object({ label: text, color: sceneColor.optional() }).strict()).max(30),
  }),
  Formula: z.object({ ...common, latex: text, meaning: text.optional() }),
  Annotation: z.object({ ...common, text }),
  Walkthrough: z.object({
    ...common,
    steps: z
      .array(z.object({ title: text, text }).strict())
      .min(1)
      .max(30),
    value: number,
  }),
  Quiz: z.object({
    ...common,
    prompt: text,
    choices: z.union([z.array(text).min(2).max(10), array]),
    correctIndex: number,
    explanation: text,
    value: number,
  }),
  Timeline: z.object({
    ...common,
    items: z
      .array(
        z
          .object({ label: text, detail: text.optional(), action: ActionSchema.optional() })
          .strict(),
      )
      .min(1)
      .max(100),
  }),
  Playback: z.object({
    ...common,
    path: z.string().max(1024).default("/clock"),
    label: text.optional(),
  }),
  SvgScene: z.object({
    ...common,
    title: text,
    description: text,
    viewBox: z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]),
    gradients: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
            stops: z
              .array(
                z
                  .object({
                    offset: z.number().min(0).max(1),
                    color: z
                      .string()
                      .regex(/^(#[0-9a-fA-F]{3,8}|accent|foreground|muted|surface)$/),
                  })
                  .strict(),
              )
              .min(2)
              .max(10),
          })
          .strict(),
      )
      .max(10)
      .optional(),
    clips: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
            x: z.number(),
            y: z.number(),
            width: z.number().nonnegative(),
            height: z.number().nonnegative(),
          })
          .strict(),
      )
      .max(10)
      .optional(),
    nodes: z.array(SceneNodeSchema).max(300).describe("REF:#/$defs/DynamicValue"),
  }),
  Plot: z.object({
    domain: z.tuple([number, number]).optional(),
    highlight: z.object({ from: number, to: number }).strict().optional(),
    ...common,
    title: text,
    kind: z.enum(["line", "scatter", "histogram", "area", "parametric"]).default("line"),
    values: array,
    xKey: z.string().default("x"),
    yKey: z.string().default("y"),
    xUnit: text.optional(),
    yUnit: text.optional(),
    references: z.array(z.number()).max(20).optional(),
  }),
  RouteMap: z.object({
    ...common,
    title: text,
    points: z
      .array(
        z
          .object({ label: text, x: z.number().min(-180).max(180), y: z.number().min(-90).max(90) })
          .strict(),
      )
      .min(1)
      .max(100),
    verifyAction: ActionSchema.optional(),
    approximate: z.literal(true).default(true),
  }),
  Simulation: z.object({
    ...common,
    module: z.enum(["nBody", "cellular", "agents"]),
    seed: z.number().int(),
    params: z
      .object({
        count: z.number().int().min(2).max(64).optional(),
        gravity: z.number().min(0).max(10).optional(),
        size: z.number().int().min(8).max(64).optional(),
      })
      .strict()
      .default({}),
    title: text,
  }),
  Form: z.object({ ...common, label: text, children: ChildListSchema, onSubmit: ActionSchema }),
  Row: z.object({ ...common, ...layout }),
  Column: z.object({ ...common, ...layout }),
  Grid: z.object({ ...common, ...layout, columns: z.number().int().min(1).max(6).default(2) }),
  Card: z.object({ ...common, children: ChildListSchema, title: text.optional() }),
  Divider: z.object(common),
  Tabs: z.object({ ...common, tabs: z.array(item).min(1).max(20), value: text }),
  Accordion: z.object({ ...common, items: z.array(item).min(1).max(30), value: text }),
  Heading: z.object({ ...common, text, level: z.number().int().min(1).max(6).default(2) }),
  Text: z.object({
    ...common,
    text,
    tone: z.enum(["default", "muted", "accent", "success", "danger"]).optional(),
    size: z.enum(["sm", "md", "lg", "xl", "display"]).optional(),
    weight: z.enum(["regular", "medium", "bold"]).optional(),
    align: z.enum(["start", "center", "end"]).optional(),
  }),
  Image: z.object({
    ...common,
    asset: z.string().min(1).max(128).optional(),
    attachmentId: z
      .string()
      .regex(/^[A-Za-z0-9._:-]{1,128}$/)
      .optional(),
    caption: text.optional(),
    fit: z.enum(["contain", "cover"]).default("contain"),
    zoom: z.boolean().default(false),
    alt: z.string().max(1024),
    aspectRatio: z.number().positive().max(10).optional(),
  }),
  Markdown: z.object({ ...common, text }),
  Gallery: z.object({
    ...common,
    attachmentIds: z
      .array(z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/))
      .min(1)
      .max(40),
    layout: z.enum(["auto", "grid", "carousel", "mosaic"]).default("auto"),
    caption: text.optional(),
  }),
  Carousel: z.object({
    ...common,
    attachmentIds: z
      .array(z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/))
      .min(1)
      .max(40),
    caption: text.optional(),
  }),
  MediaGrid: z.object({
    ...common,
    attachmentIds: z
      .array(z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/))
      .min(1)
      .max(40),
    caption: text.optional(),
  }),
  ImageCompare: z.object({
    ...common,
    attachmentIds: z.array(z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/)).length(2),
    caption: text.optional(),
  }),
  ImageAnnotations: z.object({
    ...common,
    attachmentId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
    regionIds: z.array(z.string().max(128)).max(50),
    caption: text.optional(),
  }),
  Video: z.object({
    ...common,
    attachmentId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
    caption: text.optional(),
    seek: number.optional(),
    muted: z.boolean().default(true),
    autoplay: z.boolean().default(false),
  }),
  Audio: z.object({
    ...common,
    attachmentId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
    caption: text.optional(),
  }),
  FileCard: z.object({
    ...common,
    attachmentId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
    caption: text.optional(),
  }),
  DocumentPreview: z.object({
    ...common,
    attachmentId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
    caption: text.optional(),
  }),
  Icon: z.object({
    ...common,
    name: iconName,
    label: z.string().optional(),
    tone: z.enum(["default", "muted", "accent", "success", "danger"]).optional(),
  }),
  Badge: z.object({
    ...common,
    text,
    tone: z.enum(["default", "success", "warning"]).optional(),
    icon: iconName.optional(),
  }),
  Callout: z.object({
    ...common,
    icon: iconName.optional(),
    title: text.optional(),
    text,
    tone: z
      .enum([
        "info",
        "warning",
        "success",
        "danger",
        "tip",
        "observe",
        "misconception",
        "model-note",
      ])
      .default("info"),
  }),
  CodeBlock: z.object({ ...common, code: text, language: z.string().max(32).optional() }),
  List: z.object({ ...common, children: ChildListSchema, ordered: z.boolean().optional() }),
  Table: z.object({
    ...common,
    caption: text,
    columns: z
      .array(z.object({ key: z.string().min(1), label: z.string().min(1) }).strict())
      .min(1)
      .max(20),
    rows: array,
  }),
  Progress: z.object({
    ...common,
    label: text,
    value: number,
    max: z.number().positive().default(100),
    variant: z.enum(["bar", "ring"]).optional(),
  }),
  Button: z.object({
    ...common,
    label: text,
    action: ActionSchema,
    variant: z.enum(["primary", "secondary", "quiet"]).default("primary"),
    disabled: boolean.optional(),
    icon: iconName.optional(),
    /** Only the icon shows (the label stays the accessible name). */
    iconOnly: z.boolean().optional(),
    size: z.enum(["sm", "md"]).optional(),
    fill: z.boolean().optional(),
  }),
  TextField: z.object({
    ...common,
    ...input,
    value: text,
    placeholder: z.string().optional(),
    multiline: z.boolean().optional(),
  }),
  Select: z.object({
    ...common,
    ...input,
    value: text,
    options: z
      .array(z.object({ label: z.string(), value: z.string() }).strict())
      .min(1)
      .max(100),
    variant: z.enum(["dropdown", "segmented", "chips"]).optional(),
  }),
  Checkbox: z.object({
    ...common,
    ...input,
    value: boolean,
    variant: z.enum(["checkbox", "switch"]).optional(),
  }),
  Slider: z.object({
    ...common,
    ...input,
    value: number,
    min: z.number().default(0),
    max: z.number().default(100),
    step: z.number().positive().default(1),
    unit: text.optional(),
  }),
  DatePicker: z.object({
    ...common,
    ...input,
    value: text,
    min: z.string().optional(),
    max: z.string().optional(),
  }),
  /**
   * The general container: any layout (direction, alignment, wrap), a semantic surface (tone,
   * radius, border, padding), a size (width fraction, flex, height, aspect ratio) and an optional
   * tap action. Cards, list rows, chips, toolbars, phone screens and grids are all Boxes.
   */
  Box: z.object({
    ...common,
    // Optional: an empty Box is a spacer, a swatch or a placeholder.
    children: ChildListSchema.optional(),
    direction: z.enum(["column", "row"]).optional(),
    gap: z.enum(["none", "xs", "sm", "md", "lg", "xl"]).optional(),
    align: z.enum(["start", "center", "end", "stretch"]).optional(),
    justify: z.enum(["start", "center", "end", "between", "around"]).optional(),
    wrap: z.boolean().optional(),
    padding: z.enum(["none", "xs", "sm", "md", "lg", "xl"]).optional(),
    tone: z
      .enum([
        "plain",
        "subtle",
        "raised",
        "accent",
        "accentSoft",
        "inverse",
        "success",
        "warning",
        "danger",
      ])
      .optional(),
    radius: z.enum(["none", "sm", "md", "lg", "full"]).optional(),
    border: z.boolean().optional(),
    width: z.union([z.enum(["fill", "hug"]), z.number().min(0.1).max(1)]).optional(),
    flex: z.number().min(0).max(12).optional(),
    height: z.number().int().min(8).max(800).optional(),
    aspectRatio: z.number().positive().max(10).optional(),
    scroll: z.enum(["horizontal"]).optional(),
    action: ActionSchema.optional(),
    selected: boolean.optional(),
  }),
  /** One child at a time (value = index), with round ← → buttons and dots, and swipe. */
  Pager: z.object({
    ...common,
    children: ChildListSchema,
    value: number,
    controls: z.enum(["arrows", "dots", "both", "none"]).optional(),
    loop: z.boolean().optional(),
  }),
  /** A card with two faces; tapping turns it (value = showing the back). */
  Flip: z.object({
    ...common,
    front: child,
    back: child,
    value: boolean,
    height: z.number().int().min(80).max(600).optional(),
  }),
  /** A button (⋯ by default) that opens a list of actions. */
  Menu: z.object({
    ...common,
    label: text.optional(),
    icon: iconName.optional(),
    items: z
      .array(
        z
          .object({
            label: text,
            icon: iconName.optional(),
            action: ActionSchema,
            tone: z.enum(["default", "danger"]).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  }),
  /** A device frame for interface mockups: its children are the screen. */
  Device: z.object({
    ...common,
    children: ChildListSchema,
    kind: z.enum(["phone", "tablet", "browser"]).optional(),
    title: text.optional(),
  }),
  /**
   * Several multiple-choice questions answered in place: one question at a time, ← → between
   * them, each graded when chosen, a score at the end and a retry. value = chosen indexes.
   */
  QuizSet: z.object({
    ...common,
    title: text.optional(),
    questions: z
      .array(
        z
          .object({
            prompt: text,
            choices: z.array(text).min(2).max(8),
            correctIndex: z.number().int().min(0).max(7),
            explanation: text.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    value: array.optional(),
  }),
  Chart: z.object({
    ...common,
    title: text,
    kind: z.enum(["line", "bar", "scatter", "histogram", "area", "stacked", "pie"]),
    series: z.array(seriesSchema).max(10).optional(),
    window: z.number().int().min(2).max(1000).optional(),
    xUnit: text.optional(),
    yUnit: text.optional(),
    scale: z.enum(["linear", "log"]).default("linear"),
    references: z.array(z.number()).max(20).optional(),
    bands: z
      .array(z.object({ from: z.number(), to: z.number(), label: text.optional() }).strict())
      .max(20)
      .optional(),
    values: array,
    xKey: z.string().default("x"),
    yKey: z.string().default("y"),
  }),
} as const;
export type ComponentName = keyof typeof componentSchemas;
export const COMPONENT_NAMES = Object.keys(componentSchemas) as ComponentName[];
export type Component = { id: string; component: string; [key: string]: unknown };
const version = z.literal(PROTOCOL_VERSION);
const sid = z.string().min(1).max(128);
const envelopeComponent = z
  .object({ id: sid, component: z.string().min(1).max(128) })
  .passthrough();
export const MessageSchema = z.union([
  z
    .object({
      version,
      createSurface: z
        .object({
          surfaceId: sid,
          catalogId: z.string().min(1).max(256),
          sendDataModel: z.literal(false).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      version,
      updateComponents: z
        .object({ surfaceId: sid, components: z.array(envelopeComponent).min(1).max(2000) })
        .strict(),
    })
    .strict(),
  z
    .object({
      version,
      updateDataModel: z
        .object({
          surfaceId: sid,
          path: z.string().max(1024).optional(),
          value: z.unknown().optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ version, deleteSurface: z.object({ surfaceId: sid }).strict() }).strict(),
]);
export type UIMessage = z.infer<typeof MessageSchema>;
export type Diagnostic = {
  code: string;
  message: string;
  surfaceId?: string;
  componentId?: string;
  path?: string;
  expected?: string;
  severity: "error" | "warning";
};
export type UserAction = {
  timestamp: string;
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  context: Record<string, unknown>;
};
export type Capabilities = {
  catalogIds: string[];
  platform: "web" | "react-native" | "flutter";
  clientActions: string[];
  /** Components this renderer implements natively; others must use a declared fallback. */
  components?: string[];
  /** Declared substitutions for components the renderer lacks, e.g. {Video: "FileCard"}. */
  fallbacks?: Record<string, string>;
  /** Expression operators the runtime evaluates. */
  expressionOps?: string[];
  /** Hybrid answer wire versions the host understands. */
  answerWire?: string[];
  features?: {
    continuousPlayback: boolean;
    directSceneDrag: boolean;
    sceneHover?: boolean;
    isolatedSandbox: boolean;
    advancedCharts: boolean;
    /** Formula strings in computed values and setValue (compiled to the expression tree). */
    formulas?: boolean;
  };
};

/** Validate a component independently so malformed siblings can be quarantined. */
export function parseComponent(
  value: unknown,
  schemas: Record<string, z.AnyZodObject> = componentSchemas,
): Component {
  const base = envelopeComponent.parse(value);
  const schema = Object.hasOwn(schemas, base.component) ? schemas[base.component] : undefined;
  if (!schema) throw new Error(`Unknown component: ${base.component}`);
  const { id, component, ...props } = base;
  return { id, component: component as ComponentName, ...schema.strict().parse(props) };
}

/** Generate a portable, self-contained catalog from the authored Zod schemas. */
export function buildCatalogSchema(
  schemas: Record<string, z.AnyZodObject> = componentSchemas,
  catalogId: string = CATALOG_ID,
) {
  const components: Record<string, unknown> = {};
  const functions: Record<string, unknown> = {};
  let definitions: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(schemas)) {
    const generated = zodToJsonSchema(schema.extend({ component: z.literal(name) }), {
      definitions: { Expr: ExprSchema },
      definitionPath: "$defs",
      $refStrategy: "root",
    }) as Record<string, any>;
    const { $defs, $schema, ...props } = generated;
    const rewrite = (value: any) => {
      if (!value || typeof value !== "object") return;
      if (typeof value.$ref === "string" && value.$ref.startsWith("#/properties/"))
        value.$ref = value.$ref.replace("#/properties/", `#/components/${name}/properties/`);
      if (typeof value.$ref === "string")
        value.$ref = value.$ref.replace(/\/items\/(\d+)(?=\/|$)/g, "/prefixItems/$1");
      // zod-to-json-schema emits draft-7 tuples; the portable catalog declares 2020-12.
      if (Array.isArray(value.items)) {
        value.prefixItems = value.items;
        value.items = false;
      }
      for (const child of Object.values(value)) rewrite(child);
    };
    rewrite(props);
    definitions = { ...definitions, ...$defs };
    delete props.additionalProperties;
    components[name] = props;
  }
  for (const fn of functionDefinitions) {
    const generated = zodToJsonSchema(fn.schema, {
      definitions: { Expr: ExprSchema },
      definitionPath: "$defs",
      $refStrategy: "root",
    }) as Record<string, any>;
    const { $defs, $schema, ...args } = generated;
    const rewrite = (value: any) => {
      if (!value || typeof value !== "object") return;
      if (typeof value.$ref === "string" && value.$ref.startsWith("#/properties/"))
        value.$ref = value.$ref.replace(
          "#/properties/",
          `#/functions/${fn.name}/properties/args/properties/`,
        );
      // zod-to-json-schema emits draft-7 tuples; the portable catalog declares 2020-12.
      if (Array.isArray(value.items)) {
        value.prefixItems = value.items;
        value.items = false;
      }
      for (const child of Object.values(value)) rewrite(child);
    };
    rewrite(args);
    functions[fn.name] = {
      type: "object",
      properties: { call: { const: fn.name }, args, returnType: { const: fn.returnType } },
      required: ["call", "args"],
      returnType: fn.returnType,
    };
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: catalogId,
    catalogId,
    protocolVersion: PROTOCOL_VERSION,
    $defs: definitions,
    components,
    functions,
    instructions: "Use only this catalog. Prefer local bindings for interactive state.",
  };
}

/** Portable authoring helpers retain A2UI binding and child-reference semantics. */
export const componentProps = {
  text,
  number,
  boolean,
  array,
  child,
  children: ChildListSchema,
  action: ActionSchema,
};
export const ComponentDefinitionSchema = z.object({
  name: z.string().regex(/^[A-Z][A-Za-z0-9]{0,63}$/),
  description: z.string().min(10).max(2000),
  inputSchema: z.record(z.unknown()),
  platforms: z.array(z.enum(["web", "react-native", "flutter"])).min(1),
  fallback: z.string().min(1).optional(),
  examples: z.array(z.record(z.unknown())).max(8).default([]),
  actions: z
    .array(z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/))
    .max(20)
    .default([]),
  slots: z
    .array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/))
    .max(16)
    .default([]),
});
export type ComponentDefinition = z.infer<typeof ComponentDefinitionSchema>;
/** Implementation functions stay in the host registry; only this definition reaches a model. */
export function defineComponent(input: {
  name: string;
  description: string;
  schema: z.AnyZodObject;
  platforms?: ComponentDefinition["platforms"];
  fallback?: string;
  examples?: Record<string, unknown>[];
  actions?: string[];
  slots?: string[];
}) {
  const schema = input.schema.strict();
  for (const slot of input.slots ?? [])
    if (!Object.hasOwn(schema.shape, slot)) throw Error("COMPONENT_SLOT_SCHEMA");
  const inputSchema = zodToJsonSchema(schema, {
    definitions: { Expr: ExprSchema },
    definitionPath: "$defs",
    $refStrategy: "root",
  }) as Record<string, any>;
  const normalize = (value: any) => {
    if (!value || typeof value !== "object") return;
    if (typeof value.$ref === "string")
      value.$ref = value.$ref.replace(/\/items\/(\d+)(?=\/|$)/g, "/prefixItems/$1");
    if (Array.isArray(value.items)) {
      value.prefixItems = value.items;
      value.items = false;
    }
    for (const child of Object.values(value)) normalize(child);
  };
  normalize(inputSchema);
  const definition = ComponentDefinitionSchema.parse({
    ...input,
    inputSchema,
    platforms: input.platforms ?? ["web", "react-native", "flutter"],
  });
  for (const example of definition.examples) schema.parse(example);
  return { name: definition.name, schema, definition };
}
