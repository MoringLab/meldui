import { writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5173");
await page
  .getByRole("textbox", { name: "만들고 싶은 인터페이스" })
  .fill(
    "Create a compact calculator titled LIVE VERIFY with exactly two Sliders labeled Alpha and Beta, initialized to 10 and 20, and their sum as a local expression.",
  );
await page.getByRole("button", { name: "만들기", exact: true }).click();
await page
  .getByText("완료되었습니다. 화면에서 바로 사용해보세요.", { exact: true })
  .waitFor({ timeout: 180000 });
await expect(page.locator(".ui-surface .ui-error")).toHaveCount(0);
const before = await page.request.get("http://127.0.0.1:8787/api/health").then((r) => r.json());
const slider = page.getByRole("slider").first();
await expect(page.getByRole("slider")).toHaveCount(2);
await expect(page.getByRole("slider").nth(1)).toHaveValue("20");
await slider.fill("50");
await expect(slider).toHaveValue("50");
await expect(page.locator(".ui-surface").getByText("70", { exact: true })).toBeVisible();
await page.getByLabel("디자인 킷").selectOption("editorial");
await expect(slider).toHaveValue("50");
const after = await page.request.get("http://127.0.0.1:8787/api/health").then((r) => r.json());
if (before.generationCalls !== after.generationCalls)
  throw Error("Local interaction called a model");
await page.screenshot({ path: "artifacts/web-live.png", fullPage: true });
await writeFile(
  "artifacts/web-live.json",
  JSON.stringify(
    { status: "passed", modelCallsDuringInteraction: 0, generationCalls: after.generationCalls },
    null,
    2,
  ),
);
console.log("Live generation, local input and kit preservation PASS");
await browser.close();
