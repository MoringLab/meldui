import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import xss from "../../eval/safety/xss.json" with { type: "json" };

const harness = (text: string, width = 480) =>
  `/eval.html?width=${width}&markdown=${encodeURIComponent(text)}`;
test("Markdown XSS and partial streams have no script, HTML or remote image side effect", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const remote: string[] = [];
  page.on("request", (req) => {
    if (!new URL(req.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) remote.push(req.url());
  });
  for (const item of xss) {
    await page.goto(harness(item.payload));
    await page.waitForFunction(() => Boolean((window as any).__ready));
    await expect(
      page.locator(
        ".ui-markdown script,.ui-markdown iframe,.ui-markdown form,.ui-markdown style,.ui-markdown img[src]",
      ),
    ).toHaveCount(0);
    expect(await page.evaluate(() => Object.hasOwn(window, "xssExecuted"))).toBe(false);
  }
  expect(remote).toEqual([]);
  const parts = [
    "```js\nconst x=",
    "| a | b |\n| --- | --- |\n| 1",
    "[open](attachment:",
    "$\\sqrt{x",
  ];
  for (const part of parts) {
    await page.goto(harness(part));
    await expect(page.locator(".ui-markdown")).toBeVisible();
  }
});
for (const width of [320, 480, 720, 960])
  test(`GFM, code and math fit ${width}px`, async ({ page }) => {
    await page.goto(
      harness(
        "## Clear content\n\n**Bold** and ~~removed~~ with $x^2$.\n\n| Key | Value |\n| --- | --- |\n| Owner | Host |\n\n- [x] Read only\n\n```js\nconst x = 2;\n```",
        width,
      ),
    );
    await expect(page.locator(".ui-markdown h2")).toHaveText("Clear content");
    await expect(page.locator(".ui-markdown table")).toHaveCount(1);
    await expect(page.locator(".ui-markdown .katex")).toHaveCount(1);
    await expect(page.locator(".ui-markdown pre code")).toContainText("const x = 2;");
    expect(
      await page.locator("#chat-column").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).include(".engine-ui").analyze()).violations).toEqual([]);
  });
test("host media IDs resolve; FileCard actions are local; fabricated IDs and origins are blocked", async ({
  page,
}) => {
  await page.goto("/eval.html?media=photo-a,photo-b&width=480");
  await expect(page.getByRole("img", { name: "Coast illustration" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Mountain illustration" })).toBeVisible();
  await expect(page.locator(".ui-media-compare")).toHaveCount(1);
  await page.goto("/eval.html?media=file-a&width=320");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__actions.map((a: any) => a.name))).toEqual([
    "open:file-a",
  ]);
  await page.goto("/eval.html?media=unknown&width=320");
  await expect(page.getByText("Attachment unavailable", { exact: true })).toBeVisible();
  await page.goto(harness("![bad](https://evil.example/photo.png) [report](attachment:file-a)"));
  await expect(page.locator(".ui-markdown img")).toHaveCount(0);
  await page.getByRole("button", { name: "report", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__actions.map((a: any) => a.name))).toEqual([
    "open:file-a",
  ]);
});
test("media catalog renders safe images, host captions and an explicitly paused video", async ({
  page,
}) => {
  await page.goto("/eval.html?fixture=media-catalog&width=480");
  await expect(page.getByRole("img", { name: "Host coast illustration" })).toBeVisible();
  const video = page.locator("video");
  await expect(video).toHaveCount(1);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(page.locator("video track")).toHaveAttribute("src", /^blob:/);
  const annotated = page
    .locator(".ui-image-stage")
    .filter({ has: page.locator(".ui-image-region") });
  const imageBox = await annotated.locator("img").boundingBox();
  const regionBox = await annotated.locator(".ui-image-region").boundingBox();
  expect(imageBox).toBeTruthy();
  expect(regionBox).toBeTruthy();
  expect(Math.abs(regionBox!.x - imageBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(regionBox!.height - imageBox!.height * 0.3)).toBeLessThanOrEqual(1);
  expect(
    await page.locator("#chat-column").evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
});
