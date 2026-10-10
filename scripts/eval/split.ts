import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Stable dev/held-out assignment. Existing ids are never reassigned; new ids are appended. */
const SEED = 20261010;
export type Split = Record<string, Record<string, "dev" | "heldout">>;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const sets: Record<string, { id: string; stratum: string }[]> = {
  original: read("fixtures/cases.json").map((f: any) => ({ id: f.id, stratum: f.category })),
  routing: read("eval/routing.json").map((r: any) => ({ id: r.id, stratum: r.expect })),
  media: read("eval/media.json").map((r: any) => ({ id: r.id, stratum: r.attachments })),
  multiturn: read("eval/multiturn.json").map((r: any) => ({ id: r.id, stratum: r.base })),
  showcase: read("eval/showcase.json").map((r: any) => ({ id: r.id, stratum: r.path })),
};
const path = "eval/split.json";
const split: Split = existsSync(path) ? read(path) : {};
const random = rng(SEED);
for (const [name, items] of Object.entries(sets)) {
  split[name] ??= {};
  const strata = new Map<string, { id: string; stratum: string }[]>();
  for (const item of items.filter((i) => !(i.id in split[name])))
    strata.set(item.stratum, [...(strata.get(item.stratum) ?? []), item]);
  for (const members of strata.values()) {
    const order = members.map((m) => ({ id: m.id, r: random() })).sort((a, b) => a.r - b.r);
    const held = Math.round(order.length * 0.3);
    order.forEach((m, index) => {
      split[name][m.id] = index < held ? "heldout" : "dev";
    });
  }
}
writeFileSync(path, `${JSON.stringify(split, null, 1)}\n`);
for (const [name, ids] of Object.entries(split)) {
  const v = Object.values(ids);
  console.log(
    name,
    "dev",
    v.filter((x) => x === "dev").length,
    "heldout",
    v.filter((x) => x === "heldout").length,
  );
}
