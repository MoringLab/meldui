import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolveTypography } from "../packages/kit-spec/src/index.js";
import { brand } from "../packages/kits/brand/src/index.js";
import { editorial } from "../packages/kits/editorial/src/index.js";
import { neutral } from "../packages/kits/neutral/src/index.js";
import { buildCatalogSchema, COMPONENT_NAMES } from "../packages/protocol/src/index.js";

await mkdir("schemas", { recursive: true });
await writeFile("schemas/catalog.json", `${JSON.stringify(buildCatalogSchema(), null, 2)}\n`);
for (const kit of [neutral, editorial, brand]) {
  await writeFile(`schemas/kit-${kit.id}.json`, `${JSON.stringify(kit, null, 2)}\n`);
  await writeFile(`packages/kits/${kit.id}/guide.md`, `${kit.guide}\n`);
}
console.log(`Exported ${COMPONENT_NAMES.length} components and three kits.`);

await mkdir("dart/engine_flutter/assets", { recursive: true });
for (const file of ["catalog.json", "kit-neutral.json", "kit-editorial.json", "kit-brand.json"])
  await copyFile(`schemas/${file}`, `dart/engine_flutter/assets/${file}`);
await mkdir("apps/flutter/assets", { recursive: true });
await copyFile("fixtures/cases.json", "apps/flutter/assets/cases.json");
await mkdir("dart/engine_flutter/test/fixtures", { recursive: true });
await copyFile("fixtures/cases.json", "dart/engine_flutter/test/fixtures/cases.json");
await copyFile("fixtures/hybrid/cases.json", "apps/flutter/assets/hybrid.json");
await copyFile("fixtures/hybrid/cases.json", "dart/engine_flutter/test/fixtures/hybrid.json");
await copyFile("fixtures/hybrid/vectors.json", "dart/engine_flutter/test/fixtures/vectors.json");
// Typography parity vectors: the Dart UIKit.typography() must match resolveTypography() exactly.
await mkdir("fixtures/kits", { recursive: true });
const typography = Object.fromEntries(
  [neutral, editorial, brand].map((kit) => [
    kit.id,
    { ios: resolveTypography(kit, "ios"), android: resolveTypography(kit, "android") },
  ]),
);
await writeFile("fixtures/kits/typography.json", `${JSON.stringify(typography, null, 1)}\n`);
await copyFile(
  "fixtures/kits/typography.json",
  "dart/engine_flutter/test/fixtures/typography.json",
);

await copyFile("fixtures/media/cases.json", "dart/engine_flutter/test/fixtures/media.json");
await copyFile("eval/safety/xss.json", "dart/engine_flutter/test/fixtures/xss.json");
await copyFile("fixtures/media/cases.json", "apps/flutter/assets/media.json");
