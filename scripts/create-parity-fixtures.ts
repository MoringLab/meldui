import { copyFileSync, writeFileSync } from "node:fs";
import { evaluateExpression } from "../packages/core/src/expression.js";

const op = (op: string, ...args: any[]) => ({ op, args }),
  ref = (ref: string) => ({ ref });
const expressions: any[] = [
  op("add", 2, 3, 4),
  op("mul", 2, 3, 4),
  op("sin", 0.7),
  op("cos", 0.7),
  op("exp", 1),
  op("log", 2),
  op("pow", 2, 10),
  op("sqrt", 9),
  op("clamp", 12, 0, 10),
  op("lerp", 2, 10, 0.25),
  op("floor", 3.9),
  op("rng", 42, 0),
  op("rng", 42, 1),
  op("rng", -7, 100),
  op("range", 5),
  op("map", op("array", 1, 2, 3), op("mul", ref("$item"), 2)),
  op("filter", op("array", 1, 2, 3), op("gt", ref("$item"), 1)),
  op("reduce", op("array", 1, 2, 3), op("add", ref("$acc"), ref("$item")), 0),
  op("scan", 1000, op("mul", ref("$acc"), 1.05), 20),
  op("series", 5, op("pow", ref("$index"), 2)),
  op("get", op("array", 2, 3, 5), 1),
  op("numberFormat", 1.2345, 2),
  op("range", 1001),
  op("series", 1000, op("range", 2)),
];
const vectors = expressions.map((expr, id) => {
  try {
    return { id, expr, expected: evaluateExpression(expr, () => undefined) };
  } catch (e) {
    return { id, expr, error: (e as Error).message };
  }
});
writeFileSync("fixtures/advanced/vectors.json", JSON.stringify(vectors, null, 2) + "\n");
copyFileSync(
  "fixtures/advanced/vectors.json",
  "dart/engine_flutter/test/fixtures/advanced-vectors.json",
);
