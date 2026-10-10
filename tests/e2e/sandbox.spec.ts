import { expect, test } from "@playwright/test";

test("attested sandbox viewer replays keyboard input and stops without trapping host focus", async ({
  page,
}) => {
  test.skip(
    process.env.ENGINE_TEST_SANDBOX !== "1",
    "Explicit local Docker provider check; disabled in ordinary CI.",
  );
  test.setTimeout(45000);
  await page.goto("/showcase.html?id=H-08");
  await expect(page.getByRole("note")).toContainText("Interactive content is not available here");
  await page.getByLabel("검증된 웹 샌드박스 요청").check();
  await expect(page.locator("figure p").filter({ hasText: "Frame 0" })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Interact with isolated content" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Focus next sandbox control" })).toBeFocused();
  const focused = page.waitForResponse(
    (r) => r.url().includes("/api/sandbox/render") && r.status() === 200,
  );
  await page.getByRole("button", { name: "Focus next sandbox control" }).click();
  await focused;
  await page.getByRole("button", { name: "Activate sandbox control" }).click();
  await expect(page.locator("figure p").filter({ hasText: "Frame 1" })).toBeVisible({
    timeout: 15000,
  });
  await page.screenshot({ path: "artifacts/sandbox/viewer.png" });
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Stopped by host");
});
