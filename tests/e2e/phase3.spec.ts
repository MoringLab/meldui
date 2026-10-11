import { expect, test } from "@playwright/test";

test("part groups translate, select, reset and zoom without calling a model", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ui")) calls.push(r.url());
  });
  await page.goto("/showcase.html?id=01");
  const part = page.locator('[data-part="frontWheel"]');
  const before = await part.getAttribute("transform");
  await page.getByRole("slider", { name: "분해" }).fill("80");
  await expect(part).not.toHaveAttribute("transform", before!);
  await part.click();
  await expect(part).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  expect(calls).toEqual([]);
});
test("registered host components keep bound input across kit switches", async ({ page }) => {
  await page.goto("/studio.html");
  await page.getByRole("slider", { name: "전압 · V" }).fill("18");
  await page.getByLabel("Kit", { exact: true }).selectOption("editorial");
  await expect(page.getByRole("slider", { name: "전압 · V" })).toHaveValue("18");
  await page.getByRole("button", { name: "호스트에 확인 요청" }).click();
  await expect(page.getByRole("status").filter({ hasText: "confirmReservation" })).toContainText(
    "18",
  );
});
test("live state survives theme changes, snapshots, and stop disposes its iframe", async ({
  page,
}) => {
  await page.goto("/studio.html");
  const iframe = page.frameLocator("iframe").first();
  await iframe.getByRole("button", { name: "Add one" }).click();
  await expect(iframe.locator("output")).toHaveText("1");
  await page.getByLabel("다크 모드").check();
  await expect(iframe.locator("output")).toHaveText("1");
  expect(
    await iframe.locator("body").evaluate(() => {
      try {
        return Boolean(parent.document.body);
      } catch {
        return false;
      }
    }),
  ).toBe(false);
  expect(
    await iframe.locator("body").evaluate(async () => {
      try {
        await fetch("https://unapproved.invalid");
        return true;
      } catch {
        return false;
      }
    }),
  ).toBe(false);
  await page.getByRole("button", { name: "Stop", exact: true }).first().click();
  await expect(page.locator("iframe")).toHaveCount(1);
});
test("service purchase filters and sorts locally; conditional settings retain values", async ({
  page,
}) => {
  await page.goto("/service.html");
  await page.getByRole("slider", { name: "구매 예산 · 원" }).fill("100000");
  await expect(page.getByRole("table")).toContainText("후드티 D");
  await expect(page.getByRole("table")).not.toContainText("후드티 B");
  await page.getByRole("button", { name: "설정과 권한", exact: true }).click();
  await page.getByRole("checkbox", { name: "알림 허용" }).uncheck();
  await expect(page.getByRole("checkbox", { name: "스마트 알림" })).toHaveCount(0);
});
test("multi-question answers score the selected choices without model calls", async ({ page }) => {
  await page.goto("/service.html");
  await page.getByRole("button", { name: "학습 퀴즈", exact: true }).click();
  for (const label of ["의미를 수치로 표현", "클라이언트의 로컬 상태", "호스트"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByRole("button", { name: "다음 문제", exact: true }).click();
  }
  await expect(page.getByText("정답 3 / 3", { exact: true })).toBeVisible();
});

test("approved 3D resources and host components work inside the live provider", async ({
  page,
}) => {
  await page.goto("/studio.html");
  const frame = page.frameLocator("iframe").nth(1);
  await expect(frame.locator("#render-state")).not.toHaveText("", { timeout: 30000 });
  await frame.getByRole("button", { name: "Host stepper: 0" }).click();
  await expect(frame.getByRole("button", { name: "Host stepper: 1" })).toBeVisible();
  if (await frame.locator("canvas").count()) {
    await frame.getByRole("slider", { name: "Rotation", exact: true }).fill("110");
    await expect(frame.locator("#render-state")).toHaveText("Rotation 110°");
  }
});

test("live widgets follow the selected kit without restarting local state", async ({ page }) => {
  await page.goto("/studio.html");
  const frame = page.frameLocator("iframe").first();
  await frame.getByRole("button", { name: "Add one" }).click();
  await page.getByLabel("Kit", { exact: true }).selectOption("editorial");
  await expect(frame.locator("output")).toHaveText("1");
  expect(
    await frame
      .locator("body")
      .evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--ui-accent").trim(),
      ),
  ).toBe("#285d48");
});
