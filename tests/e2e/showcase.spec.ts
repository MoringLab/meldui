import { expect, test } from "@playwright/test";
import cases from "../../fixtures/showcase/cases.json" with { type: "json" };

for (const fixture of cases) {
  test(`Showcase ${fixture.id} renders in a narrow container`, async ({ page }) => {
    const errors: string[] = [];
    await page.setViewportSize({ width: 320, height: 900 });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/showcase.html?id=${fixture.id}`);
    await expect(page.getByRole("heading", { name: "MeldUI Showcase" })).toBeVisible();
    await expect(page.locator(".ui-answer")).toBeVisible();
    if (fixture.path === "C")
      await expect(
        page.getByRole("note").filter({ hasText: "Interactive content is not available here" }),
      ).toBeVisible();
    else await expect(page.locator(".ui-frame-body,.ui-media,.ui-markdown").first()).toBeVisible();
    expect(errors, fixture.id).toEqual([]);
    expect(
      await page.locator("body").evaluate((el) => el.scrollWidth <= window.innerWidth),
      fixture.id,
    ).toBe(true);
  });
}
test("simulation steps, reset and population chart stay local", async ({ page }) => {
  await page.goto("/showcase.html?id=04");
  await page.getByRole("button", { name: "Step simulation", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Step 1;" })).toBeVisible();
  await expect(page.getByText("Population history", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Reset simulation", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Step 0;" })).toBeVisible();
});
test("DNA scene dragging and keyboard rotation update the visual", async ({ page }) => {
  await page.goto("/showcase.html?id=03");
  const svg = page.locator(".ui-frame-body svg").first();
  const before = await svg.innerHTML();
  const rect = await svg.boundingBox();
  expect(rect).not.toBeNull();
  await page.mouse.move(rect!.x + rect!.width * 0.2, rect!.y + 100);
  await page.mouse.down();
  await page.mouse.move(rect!.x + rect!.width * 0.8, rect!.y + 110, { steps: 5 });
  await page.mouse.up();
  expect(await svg.innerHTML()).not.toBe(before);
  await svg.getByRole("slider").focus();
  await page.keyboard.press("ArrowLeft");
  expect(await svg.innerHTML()).not.toBe(before);
});

test("trusted simulations survive StrictMode effect replay", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/showcase.html?id=04&strict=1");
  await page.getByRole("button", { name: "Step simulation", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Step 1;" })).toBeVisible();
  expect(errors).toEqual([]);
});
