import { evaluateExpression, resolvePath } from "./expression.js";
import type { UIRuntime } from "./index.js";
export type SceneShape = {
  type: string;
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
  const visit = (items: any[], depth: number, local: any = {}) => {
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
          visit(node.children ?? [], depth + 1, { $item: item, $index: i });
        });
        continue;
      }
      const attrs = Object.fromEntries(
        Object.entries(node.attrs ?? {}).map(([k, v]) => [k, value(v)]),
      );
      if (node.type === "group") {
        shapes.push({ type: "group", attrs });
        visit(node.children ?? [], depth + 1, local);
        shapes.push({ type: "group-end", attrs: {} });
      } else
        shapes.push({
          type: node.type,
          attrs,
          text: node.text === undefined ? undefined : String(value(node.text)),
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
