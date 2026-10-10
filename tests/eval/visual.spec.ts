import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const KITS = ["neutral", "editorial", "brand"];
const CASES = [
  { fixture: "calculator", width: 480 },
  { fixture: "counting-game", width: 480 },
  { fixture: "dashboard", width: 960 },
  { fixture: "h-calc", width: 720 },
];

test("kits are visibly different from each other (pixel diff) at the same size", async ({
  page,
}) => {
  await mkdir("artifacts/eval/screenshots", { recursive: true });
  const rows: Record<string, unknown>[] = [];
  for (const mode of ["light", "dark"])
    for (const { fixture, width } of CASES) {
      const shots: Record<string, PNG> = {};
      for (const kit of KITS) {
        await page.setViewportSize({ width: 1100, height: 1300 });
        await page.goto(`/eval.html?fixture=${fixture}&width=${width}&kit=${kit}&mode=${mode}`);
        await page.waitForFunction(() => (window as unknown as { __ready: boolean }).__ready);
        const buffer = await page.locator("#chat-column").screenshot({
          path: `artifacts/eval/screenshots/${fixture}-${width}-${kit}-${mode}.png`,
        });
        shots[kit] = PNG.sync.read(buffer);
      }
      const diff = (a: PNG, b: PNG) => {
        const w = Math.min(a.width, b.width);
        const h = Math.min(a.height, b.height);
        const crop = (p: PNG) => {
          const out = new PNG({ width: w, height: h });
          PNG.bitblt(p, out, 0, 0, w, h, 0, 0);
          return out;
        };
        return (
          pixelmatch(crop(a).data, crop(b).data, undefined, w, h, { threshold: 0.1 }) / (w * h)
        );
      };
      rows.push({
        fixture,
        width,
        mode,
        neutralVsEditorial: diff(shots.neutral, shots.editorial),
        neutralVsBrand: diff(shots.neutral, shots.brand),
        editorialVsBrand: diff(shots.editorial, shots.brand),
      });
    }
  await writeFile(
    "artifacts/eval/visual.json",
    JSON.stringify({ timestamp: new Date().toISOString(), rows }, null, 1),
  );
  // Brand must differ from neutral by a visible margin and by more than the editorial kit does
  // (editorial only restyles three components; brand replaces implementations and typography).
  for (const r of rows) {
    const label = `${r.fixture}@${r.width} ${r.mode}`;
    expect(r.neutralVsBrand as number, label).toBeGreaterThan(0.03);
    expect(r.neutralVsBrand as number, label).toBeGreaterThan(r.neutralVsEditorial as number);
  }
});
