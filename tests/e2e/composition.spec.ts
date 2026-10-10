import { expect, test } from "@playwright/test";

const declaration = {
  engine: "v1",
  block: "media",
  attachments: ["photo-a", "photo-b"],
  layout: "carousel",
  markdown: "## 설명과 이미지\n좌우로 넘기며 두 이미지를 살펴보세요.",
  placement: "left",
  mediaFraction: 0.4,
};
test("semantic media placements respond to the container and support keyboard navigation", async ({
  page,
}) => {
  for (const width of [320, 720])
    for (const placement of ["left", "right", "above", "below"]) {
      await page.goto(
        `/eval.html?width=${width}&composition=${encodeURIComponent(JSON.stringify({ ...declaration, placement }))}`,
      );
      await expect(page.getByRole("heading", { name: "설명과 이미지" })).toBeVisible();
      const text = await page.locator(".ui-composition-text").boundingBox(),
        media = await page.locator(".ui-composition-media").boundingBox();
      expect(text).not.toBeNull();
      expect(media).not.toBeNull();
      if (width >= 600 && ["left", "right"].includes(placement)) {
        expect(Math.abs(text!.y - media!.y)).toBeLessThan(2);
        expect(placement === "left" ? media!.x < text!.x : media!.x > text!.x).toBe(true);
      } else
        expect(
          ["left", "above"].includes(placement) ? media!.y < text!.y : media!.y > text!.y,
        ).toBe(true);
      await page.getByRole("button", { name: "Next image" }).click();
      await expect(page.getByRole("status")).toHaveText("2 / 2");
      await page.getByRole("button", { name: "Previous image" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("status")).toHaveText("1 / 2");
      const enlarge = page.getByRole("button", { name: /^Enlarge / }).first();
      const target = await enlarge.boundingBox();
      expect(target!.height).toBeGreaterThanOrEqual(44);
      expect(target!.width).toBeGreaterThanOrEqual(44);
      await enlarge.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).not.toBeVisible();
      expect(await page.locator("body").evaluate((el) => el.scrollWidth > window.innerWidth)).toBe(
        false,
      );
    }
});
test("allowMedia false prevents every built-in embedded-media request, including restored blocks", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/attachments/")) requests.push(r.url());
  });
  await page.goto(
    `/eval.html?fixture=media-catalog&policy=${encodeURIComponent(JSON.stringify({ allowMedia: false }))}`,
  );
  await page.waitForFunction(() => Boolean((window as any).__ready));
  expect(requests).toEqual([]);
  await page.evaluate(() => {
    const session = (window as any).__session;
    session.beginTurn();
    session.pushMarkdown("![Host photo](attachment:photo-a)");
    session.end();
  });
  await expect(page.locator(".ui-answer-text")).toBeVisible();
  await page.waitForTimeout(100);
  expect(requests).toEqual([]);
});
test("new catalog actually renders and quiz/playback remain local", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/eval.html?fixture=advanced-catalog");
  await page.waitForFunction(() => Boolean((window as any).__ready));
  await expect(page.getByText("Bounded scene", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "4", exact: true }).click();
  await expect(page.getByText("Correct. Addition gives four.")).toBeVisible();
  await page.getByRole("button", { name: "Step", exact: true }).click();
  expect(
    await page.evaluate(() => (window as any).__session.runtime.read("main", "/clock/$frame")),
  ).toBe(1);
  expect(errors).toEqual([]);
});
