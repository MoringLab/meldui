import { evaluateExpression, resolvePath } from "./expression.js";
import type { UIRuntime } from "./index.js";
export type SceneShape = {
  type: string;
  id?: string;
  label?: string;
  attrs: Record<string, unknown>;
  text?: string;
  action?: unknown;
  onHover?: unknown;
  dragPath?: string;
};
/** Flatten trusted tags after resolving bindings; repeat shares the 300-element budget. */
export function sceneShapes(
  nodes: any[],
  runtime: UIRuntime,
  surfaceId: string,
  scope = "/",
): SceneShape[] {
  const shapes: SceneShape[] = [];
  let visited = 0;
  const visit = (
    items: any[],
    depth: number,
    local: any = {},
    inheritedAction?: unknown,
    inheritedLabel?: string,
  ) => {
    if (depth > 12) throw new Error("SCENE_DEPTH");
    for (const node of items) {
      if (++visited > 300) throw new Error("SCENE_ELEMENT_LIMIT");
      const value = (v: any) =>
        v?.call?.startsWith("compute")
          ? evaluateExpression(v.args.expr, (path) =>
              Object.hasOwn(local, path)
                ? local[path]
                : runtime.read(surfaceId, resolvePath(path, scope)),
            )
          : v?.ref && Object.hasOwn(local, v.ref)
            ? local[v.ref]
            : runtime.resolve(surfaceId, v, scope);
      if (node.type === "repeat") {
        const values = value(node.items);
        if (!Array.isArray(values) || values.length > 300) throw new Error("SCENE_REPEAT_LIMIT");
        values.forEach((item: any, i: number) => {
          visit(
            node.children ?? [],
            depth + 1,
            { ...local, $item: item, $index: i },
            inheritedAction,
            inheritedLabel,
          );
        });
        continue;
      }
      const attrs: Record<string, unknown> = Object.fromEntries(
        Object.entries(node.attrs ?? {}).map(([k, v]) => [k, value(v)]),
      );
      if (node.transforms?.length) {
        const finite = (v: any, fallback: number) => {
          const n = v === undefined ? fallback : Number(value(v));
          if (!Number.isFinite(n) || Math.abs(n) > 100000) throw Error("SCENE_TRANSFORM");
          return n;
        };
        attrs.transform = [
          attrs.transform ?? "",
          ...node.transforms.map((t: any) =>
            t.kind === "translate"
              ? `translate(${finite(t.x, 0)},${finite(t.y, 0)})`
              : t.kind === "rotate"
                ? `rotate(${finite(t.angle, 0)},${finite(t.cx, 0)},${finite(t.cy, 0)})`
                : `scale(${finite(t.x, 1)},${finite(t.y, 1)})`,
          ),
        ]
          .join(" ")
          .trim();
      }
      if (node.type === "group") {
        shapes.push({ type: "group", attrs, id: node.id, label: node.label, action: node.action });
        visit(
          node.children ?? [],
          depth + 1,
          local,
          node.action ?? inheritedAction,
          node.label ?? inheritedLabel,
        );
        shapes.push({ type: "group-end", attrs: {}, id: node.id, label: node.label });
      } else
        shapes.push({
          type: node.type,
          attrs,
          text: node.text === undefined ? undefined : String(value(node.text)),
          id: node.id,
          label: node.label ?? inheritedLabel,
          action: node.action,
          onHover: node.onHover,
          dragPath: node.dragPath ? resolvePath(node.dragPath, scope) : undefined,
        });
    }
  };
  visit(nodes, 0);
  return shapes;
}
/** Projection for tile-free routes. Coordinates are explicitly approximate. */
export function routePoints(points: { x: number; y: number; label: string }[]) {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const x = Math.min(...xs),
    y = Math.min(...ys),
    w = Math.max(...xs) - x || 1,
    h = Math.max(...ys) - y || 1;
  return points.map((p) => ({
    ...p,
    x: 30 + ((p.x - x) / w) * 440,
    y: 30 + (1 - (p.y - y) / h) * 220,
  }));
}

export function formatStat(value: unknown, precision = 2): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(evaluateExpression({ op: "numberFormat", args: [value, precision, true] }, () => null))
    : String(value ?? "");
}
