import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

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
const ops = [
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
] as const;
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
const ComputedSchema = z
  .object({
    call: z.enum(["computeNumber", "computeString", "computeBoolean", "computeArray"]),
    args: z.object({ expr: ExprSchema }).strict(),
    returnType: z.enum(["number", "string", "boolean", "array"]),
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
export const ChildListSchema = z
  .union([
    z.array(child).max(2000),
    z.object({ componentId: child, path: z.string().max(1024) }).strict(),
  ])
  .describe("REF:#/$defs/ChildList");
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
  })
  .strict();
export const functionDefinitions = [
  ...(["Number", "String", "Boolean", "Array"] as const).map((type) => ({
    name: `compute${type}`,
    returnType: type.toLowerCase(),
    schema: z.object({ expr: ExprSchema }).strict(),
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
const common = { visible: boolean.optional(), accessibilityLabel: z.string().max(256).optional() };
const layout = {
  children: ChildListSchema,
  gap,
  align: z.enum(["start", "center", "end", "stretch"]).optional(),
};
const input = {
  label: text,
  value: z.union([text, number, boolean]),
  disabled: boolean.optional(),
  error: text.optional(),
};
const item = z.object({ id: z.string().min(1), label: text, child }).strict();

/** Semantic component props: no HTML, CSS, executable code, or remote URLs. */
export const componentSchemas = {
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
    tone: z.enum(["default", "muted", "success", "danger"]).optional(),
  }),
  Image: z.object({
    ...common,
    asset: z.string().min(1).max(128),
    alt: z.string().max(1024),
    aspectRatio: z.number().positive().max(10).optional(),
  }),
  Icon: z.object({
    ...common,
    name: z.enum(["check", "info", "arrow", "plus", "star", "close"]),
    label: z.string().optional(),
  }),
  Badge: z.object({ ...common, text, tone: z.enum(["default", "success", "warning"]).optional() }),
  Callout: z.object({
    ...common,
    title: text,
    text,
    tone: z.enum(["info", "warning", "success", "danger"]).default("info"),
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
  }),
  Button: z.object({
    ...common,
    label: text,
    action: ActionSchema,
    variant: z.enum(["primary", "secondary", "quiet"]).default("primary"),
    disabled: boolean.optional(),
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
  }),
  Checkbox: z.object({ ...common, ...input, value: boolean }),
  Slider: z.object({
    ...common,
    ...input,
    value: number,
    min: z.number().default(0),
    max: z.number().default(100),
    step: z.number().positive().default(1),
  }),
  DatePicker: z.object({
    ...common,
    ...input,
    value: text,
    min: z.string().optional(),
    max: z.string().optional(),
  }),
  Chart: z.object({
    ...common,
    title: text,
    kind: z.enum(["line", "bar", "scatter"]),
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
export function buildCatalogSchema() {
  const components: Record<string, unknown> = {};
  const functions: Record<string, unknown> = {};
  let definitions: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(componentSchemas)) {
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
    $id: CATALOG_ID,
    catalogId: CATALOG_ID,
    protocolVersion: PROTOCOL_VERSION,
    $defs: definitions,
    components,
    functions,
    instructions: "Use only this catalog. Prefer local bindings for interactive state.",
  };
}
