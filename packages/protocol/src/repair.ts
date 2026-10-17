/**
 * Components as models actually write them, made valid instead of rejected. A model's slip
 * (width: 120, max: "100", an action in the wrong shape, an unknown key, "space-between") must
 * never become an error card or a broken layout: each schema issue is fixed where it is
 * (coerce, clamp, map, rebuild, drop the optional prop) and, failing that, the component is
 * replaced by the closest safe one (a container for its children, or a text for its words).
 * Every change is listed so hosts can report it.
 */
import type { z } from "zod";
import { type Component, componentSchemas } from "./index.js";

export type RepairResult = { component: Component; repairs: string[] };

const NOOP_ACTION = { functionCall: { call: "setValues", args: { updates: [] } } };
/** Synonyms models use for enum values (CSS words, other UI kits). */
const ENUM_SYNONYMS: Record<string, string> = {
  "space-between": "between",
  spacebetween: "between",
  "space-around": "around",
  "space-evenly": "around",
  "flex-start": "start",
  "flex-end": "end",
  left: "start",
  right: "end",
  top: "start",
  bottom: "end",
  middle: "center",
  centre: "center",
  vertical: "column",
  horizontal: "row",
  col: "column",
  small: "sm",
  medium: "md",
  large: "lg",
  xlarge: "xl",
  "x-large": "xl",
  normal: "regular",
  semibold: "medium",
  heavy: "bold",
  ghost: "quiet",
  outline: "secondary",
  text: "quiet",
  error: "danger",
  warn: "warning",
  ok: "success",
  pill: "full",
  round: "full",
  rounded: "md",
  surface: "subtle",
  card: "raised",
  muted: "subtle",
};
const SETTERS = new Set(["setValue", "setValues", "copyText", "openUrl"]);

type Path = (string | number)[];

function at(root: unknown, path: Path): unknown {
  let value: any = root;
  for (const key of path) value = value?.[key];
  return value;
}

function put(root: any, path: Path, value: unknown): boolean {
  if (!path.length) return false;
  let parent = root;
  for (const key of path.slice(0, -1)) parent = parent?.[key];
  if (!parent || typeof parent !== "object") return false;
  const key = path[path.length - 1] as string | number;
  if (value === undefined) {
    if (Array.isArray(parent) && typeof key === "number") parent.splice(key, 1);
    else delete parent[key];
  } else parent[key] = value;
  return true;
}

/** A model's action in any of the shapes models write, as the protocol's shape (or null). */
export function normalizeAction(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return typeof value === "string" && value.trim()
      ? { event: { name: value.trim().slice(0, 128) } }
      : null;
  }
  const v = value as Record<string, any>;
  if (v.functionCall && typeof v.functionCall === "object") {
    const { call, args } = v.functionCall;
    if (typeof call === "string" && SETTERS.has(call))
      return { functionCall: { call, args: args && typeof args === "object" ? args : {} } };
    return null;
  }
  if (v.event !== undefined) {
    const event = typeof v.event === "string" ? { name: v.event } : v.event;
    if (event && typeof event.name === "string" && event.name)
      return {
        event: {
          name: event.name.slice(0, 128),
          ...(event.context && typeof event.context === "object" ? { context: event.context } : {}),
        },
      };
    return null;
  }
  // {call:"setValue",args:{…}} / {setValue:{path,value}} / {type:"setValue",path,value} / {path,value}
  const call = typeof v.call === "string" ? v.call : typeof v.type === "string" ? v.type : null;
  if (call && SETTERS.has(call)) {
    const { call: _c, type: _t, args, ...rest } = v;
    return { functionCall: { call, args: args && typeof args === "object" ? args : rest } };
  }
  for (const name of SETTERS)
    if (v[name] && typeof v[name] === "object")
      return { functionCall: { call: name, args: v[name] } };
  if (typeof v.path === "string" && ("value" in v || "expr" in v || "formula" in v)) {
    const { path, value: next, expr, formula } = v;
    return { functionCall: { call: "setValue", args: { path, value: next, expr, formula } } };
  }
  if (typeof v.name === "string" && v.name)
    return { event: { name: v.name.slice(0, 128), ...(v.context ? { context: v.context } : {}) } };
  return null;
}

function coerce(value: unknown, expected: string): unknown {
  if (expected === "number" && typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/[,_%px]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  if (expected === "string" && (typeof value === "number" || typeof value === "boolean"))
    return String(value);
  if (expected === "boolean") {
    if (value === "true" || value === 1) return true;
    if (value === "false" || value === 0) return false;
  }
  if (expected === "array" && value !== undefined && value !== null && !Array.isArray(value))
    return [value];
  return undefined;
}

/** The value a required prop gets when its own is unusable. */
function placeholder(expected: string | undefined): unknown {
  if (expected === "string") return "";
  if (expected === "number") return 0;
  if (expected === "boolean") return false;
  if (expected === "array") return [];
  return undefined;
}

function fixIssue(props: Record<string, any>, issue: z.ZodIssue, repairs: string[]): boolean {
  const path = issue.path as Path;
  const value = at(props, path);
  const where = path.join(".") || "props";
  const note = (what: string) => repairs.push(`${where}: ${what}`);
  switch (issue.code) {
    case "unrecognized_keys": {
      const target = path.length ? at(props, path) : props;
      if (!target || typeof target !== "object") return false;
      for (const key of issue.keys) delete (target as Record<string, unknown>)[key];
      note(`dropped ${issue.keys.join(", ")}`);
      return true;
    }
    case "too_big":
    case "too_small": {
      const limit = Number(issue.code === "too_big" ? issue.maximum : issue.minimum);
      if (typeof value === "number" && Number.isFinite(limit)) {
        // A fraction written as a percentage (width: 50) or as pixels (width: 320).
        let next = value;
        if (issue.code === "too_big" && limit <= 1 && value > 1)
          next = value <= 100 ? value / 100 : 1;
        next = issue.code === "too_big" ? Math.min(next, limit) : Math.max(next, limit);
        if (issue.type === "number" && issue.message.includes("integer")) next = Math.round(next);
        note(`${value} → ${next}`);
        return put(props, path, next);
      }
      if (Array.isArray(value) && issue.code === "too_big") {
        note(`kept the first ${limit}`);
        return put(props, path, value.slice(0, limit));
      }
      if (typeof value === "string" && issue.code === "too_big") {
        note("shortened");
        return put(props, path, value.slice(0, limit));
      }
      return false;
    }
    case "invalid_type": {
      if (issue.received === "undefined") {
        const next = placeholder(issue.expected);
        if (next === undefined) return false;
        note(`filled with ${JSON.stringify(next)}`);
        return put(props, path, next);
      }
      const next = coerce(value, issue.expected);
      if (next !== undefined) {
        note(`${typeof value} → ${issue.expected}`);
        return put(props, path, next);
      }
      return false;
    }
    case "invalid_enum_value": {
      if (typeof value === "string") {
        const lower = value.toLowerCase().trim();
        const options = issue.options.map(String);
        const match =
          options.find((o) => o.toLowerCase() === lower) ??
          (ENUM_SYNONYMS[lower] && options.includes(ENUM_SYNONYMS[lower])
            ? ENUM_SYNONYMS[lower]
            : undefined);
        if (match) {
          note(`"${value}" → "${match}"`);
          return put(props, path, match);
        }
      }
      return false;
    }
    case "invalid_union": {
      const key = path[path.length - 1];
      if (
        key === "action" ||
        key === "onSubmit" ||
        (typeof key === "string" && /action/i.test(key))
      ) {
        const next = normalizeAction(value);
        if (next && JSON.stringify(next) !== JSON.stringify(value)) {
          note("action rebuilt");
          return put(props, path, next);
        }
        return false;
      }
      for (const expected of ["number", "string", "boolean"]) {
        const next = coerce(value, expected);
        if (
          next !== undefined &&
          next !== value &&
          JSON.stringify(next) !== JSON.stringify(value)
        ) {
          note(`${typeof value} → ${expected}`);
          return put(props, path, next);
        }
      }
      return false;
    }
    default:
      return false;
  }
}

function isRequired(schema: z.AnyZodObject, key: string): boolean {
  const field = schema.shape[key] as z.ZodTypeAny | undefined;
  return !!field && !field.isOptional();
}

/** Words a component carries, for a text stand-in. */
function wordsOf(props: Record<string, any>): string {
  for (const key of ["text", "label", "title", "prompt", "caption", "fallbackText"])
    if (typeof props[key] === "string" && props[key].trim()) return props[key];
  return "";
}

/** Container names other UI kits use. */
const CONTAINERS = new Set([
  "View",
  "Container",
  "Stack",
  "VStack",
  "HStack",
  "Section",
  "Group",
  "Div",
  "Panel",
  "Frame",
]);

/** A valid component from what the model wrote: repaired, or replaced by a safe stand-in. */
export function repairComponent(
  value: unknown,
  schemas: Record<string, z.AnyZodObject> = componentSchemas,
): RepairResult {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, any>;
  const id = typeof raw.id === "string" && raw.id ? raw.id.slice(0, 128) : null;
  if (!id) throw new Error("COMPONENT_ID_REQUIRED");
  const repairs: string[] = [];
  let name = typeof raw.component === "string" ? raw.component : "";
  const { id: _id, component: _c, props: nested, ...rest } = raw;
  // Props nested under "props" (another kit's habit) are the component's own.
  const props: Record<string, any> = structuredClone({
    ...(nested && typeof nested === "object" ? nested : {}),
    ...rest,
  });
  if (nested) repairs.push("props unwrapped");
  if (!Object.hasOwn(schemas, name)) {
    const replacement =
      CONTAINERS.has(name) && schemas.Box ? "Box" : props.children ? "Box" : "Text";
    repairs.push(`unknown component ${name || "(none)"} → ${replacement}`);
    if (name === "HStack") props.direction = "row";
    name = replacement;
  }
  const standIn = (): RepairResult => {
    const children = props.children;
    const validChildren =
      Array.isArray(children) && children.every((c) => typeof c === "string")
        ? children
        : children && typeof children === "object" && typeof children.componentId === "string"
          ? children
          : undefined;
    const box = schemas.Box ? "Box" : "Column";
    if (validChildren && schemas[box]) {
      repairs.push(`${name} → ${box} (its children kept)`);
      return { component: { id, component: box, children: validChildren } as Component, repairs };
    }
    const words = wordsOf(props);
    repairs.push(`${name} → ${words ? "Text" : "empty Box"}`);
    return words || !schemas.Box
      ? { component: { id, component: "Text", text: words } as Component, repairs }
      : { component: { id, component: "Box" } as Component, repairs };
  };
  const schema = schemas[name] as z.AnyZodObject;
  const removedFields = new Set<string>();
  for (let attempt = 0; attempt < 24; attempt++) {
    const result = schema.strict().safeParse(props);
    if (result.success)
      return { component: { id, component: name, ...result.data } as Component, repairs };
    let changed = false;
    for (const issue of result.error.issues) if (fixIssue(props, issue, repairs)) changed = true;
    if (changed) continue;
    // Nothing to fix in place: give up on the first offending value — a list entry is dropped,
    // an optional prop removed, a required one replaced by a neutral value or a no-op action.
    const issue = result.error.issues[0] as z.ZodIssue;
    const path = issue.path as Path;
    const key = String(path[0] ?? "");
    if (!key) return standIn();
    const inList = path.findLastIndex((p) => typeof p === "number");
    // A bad field inside a list entry (an edge's arrow: "dashed") goes on its own first; the
    // entry is dropped only if it still does not fit.
    const fieldKey = path[inList + 1];
    const entry = at(props, path.slice(0, inList + 1));
    const fieldWhere = path.slice(0, inList + 2).join(".");
    if (
      inList > 0 &&
      typeof fieldKey === "string" &&
      entry &&
      typeof entry === "object" &&
      Object.hasOwn(entry, fieldKey) &&
      !removedFields.has(fieldWhere)
    ) {
      removedFields.add(fieldWhere);
      delete (entry as Record<string, unknown>)[fieldKey];
      repairs.push(`${fieldWhere}: dropped`);
      continue;
    }
    if (inList > 0 && Array.isArray(at(props, path.slice(0, inList)))) {
      const list = at(props, path.slice(0, inList)) as unknown[];
      list.splice(path[inList] as number, 1);
      repairs.push(`${path.slice(0, inList + 1).join(".")}: dropped`);
      continue;
    }
    if (!isRequired(schema, key)) {
      delete props[key];
      repairs.push(`${key}: dropped (${issue.code})`);
      continue;
    }
    if (/action|onSubmit/i.test(key)) {
      props[key] = NOOP_ACTION;
      repairs.push(`${key}: no-op`);
      continue;
    }
    const field = schema.shape[key] as z.ZodTypeAny;
    const parsed = (["", 0, false, []] as unknown[]).find((v) => field.safeParse(v).success);
    if (parsed === undefined || JSON.stringify(props[key]) === JSON.stringify(parsed))
      return standIn();
    props[key] = parsed;
    repairs.push(`${key}: neutral value`);
  }
  return standIn();
}
