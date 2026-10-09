import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { editorial } from "../packages/kits/editorial/src/index.js";
import { neutral } from "../packages/kits/neutral/src/index.js";
import { buildCatalogSchema, COMPONENT_NAMES } from "../packages/protocol/src/index.js";

await mkdir("schemas", { recursive: true });
await writeFile("schemas/catalog.json", `${JSON.stringify(buildCatalogSchema(), null, 2)}\n`);
for (const kit of [neutral, editorial]) {
  await writeFile(`schemas/kit-${kit.id}.json`, `${JSON.stringify(kit, null, 2)}\n`);
  await writeFile(`packages/kits/${kit.id}/guide.md`, `${kit.guide}\n`);
}
console.log(`Exported ${COMPONENT_NAMES.length} components and two kits.`);

await mkdir("dart/engine_flutter/assets", { recursive: true });
for (const file of ["catalog.json", "kit-neutral.json", "kit-editorial.json"])
  await copyFile(`schemas/${file}`, `dart/engine_flutter/assets/${file}`);
await mkdir("apps/flutter/assets", { recursive: true });
await copyFile("fixtures/cases.json", "apps/flutter/assets/cases.json");
