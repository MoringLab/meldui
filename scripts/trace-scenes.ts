import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage();
await mkdir("artifacts/phase3", { recursive: true });
await page.context().tracing.start({ screenshots: true, snapshots: true });
const rows = [];
for (const id of ["01", "03", "06", "08", "09"]) {
  await page.goto(`http://127.0.0.1:5173/showcase.html?id=${id}`);
  const slider = page.locator("input[type=range]").first();
  if (await slider.count()) {
    for (const value of ["20", "40", "60"]) {
      const max = Number((await slider.getAttribute("max")) ?? 100),
        min = Number((await slider.getAttribute("min")) ?? 0);
      const start = performance.now();
      await slider.fill(String(Math.min(max, Math.max(min, Number(value)))));
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      rows.push({ id, driverToTwoFramesMs: performance.now() - start });
    }
  }
}
await page.context().tracing.stop({ path: "artifacts/phase3/scene-short-trace.zip" });
await writeFile(
  "artifacts/phase3/scene-short-trace.json",
  JSON.stringify(
    {
      scope:
        "One bounded interaction trace, includes automation and two animation frames. Not a render-latency benchmark or M4 replacement.",
      rows,
    },
    null,
    2,
  ),
);
await browser.close();
