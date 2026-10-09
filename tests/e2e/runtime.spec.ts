import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import fixtures from "../../fixtures/cases.json" with { type: "json" };

test("calculator, kit swap and offline interaction", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?fixture=calculator");
  await expect(page.getByText("준비되었습니다. 입력값을 바꿔보세요.")).toBeVisible();
  await expect(page.locator('[data-node="_result"]')).toHaveText("21000");
  await page.getByLabel("인원", { exact: true }).fill("7");
  await expect(page.locator('[data-node="_result"]')).toHaveText("12000");
  await page.getByLabel("디자인 킷").selectOption("editorial");
  await expect(page.getByLabel("인원", { exact: true })).toHaveValue("7");
  await expect(page.locator('[data-node="_result"]')).toHaveText("12000");
  expect(errors).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("form, tabs and chart work on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?fixture=form");
  await page.getByLabel("이름", { exact: true }).fill("루이");
  await page.getByLabel("디자인 킷").selectOption("editorial");
  await expect(page.getByLabel("이름", { exact: true })).toHaveValue("루이");
  await page.getByRole("button", { name: "하루를 가볍게 계획하기", exact: true }).click();
  await page.getByRole("tab", { name: "다음", exact: true }).click();
  await expect(
    page.getByText("다음 단계를 위한 여유를 남겨두세요.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "한 주의 흐름", exact: true }).click();
  await page.getByLabel("수요일 값", { exact: true }).fill("80");
  await expect(page.locator("output")).toHaveText("80");
  await page.getByText("데이터 표 보기", { exact: true }).click();
  await expect(page.getByRole("cell", { name: "80", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
for (const kit of ["neutral", "editorial"])
  test(`all fixtures render in ${kit}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.getByLabel("디자인 킷").selectOption(kit);
    for (const fixture of fixtures) {
      await page.getByRole("button", { name: fixture.title, exact: true }).click();
      await expect(page.getByText("준비되었습니다. 입력값을 바꿔보세요.")).toBeVisible();
      await expect(page.locator(".ui-surface .ui-error")).toHaveCount(0);
      await expect(page.locator(".ui-surface .ui-heading").first()).toHaveText(fixture.title);
    }
    expect(errors).toEqual([]);
  });
