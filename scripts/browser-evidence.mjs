import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto("http://127.0.0.1:5173/?fixture=calculator");
await page.getByText("준비되었습니다. 입력값을 바꿔보세요.").waitFor();
await page.screenshot({ path: "artifacts/web-neutral.png", fullPage: true });
await page.getByLabel("디자인 킷").selectOption("editorial");
await page.screenshot({ path: "artifacts/web-editorial.png", fullPage: true });
const performance = await page.evaluate(async () => {
  const m = await import("/src/performance.tsx");
  return m.measureFirstFrame();
});
await writeFile("artifacts/web-performance.json", JSON.stringify(performance, null, 2));
console.log(JSON.stringify(performance));
await browser.close();
