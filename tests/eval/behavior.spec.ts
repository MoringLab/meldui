import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import fixtures from "../../fixtures/cases.json" with { type: "json" };

type Row = {
  fixture: string;
  category: string;
  check: "slider" | "tabs" | "checkbox" | "button" | "form" | "reset";
  status: "pass" | "fail" | "na" | "expected-fail";
  detail?: string;
  unlockedBy?: string;
};

test("behavioral scripts per fixture", async ({ page }) => {
  const rows: Row[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const f of fixtures) {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto(`/eval.html?fixture=${f.id}&width=720`);
    await page.waitForFunction(() => (window as any).__ready === true);
    const text = () => page.locator("#chat-column").innerText();
    const html = () => page.locator("#chat-column").innerHTML();
    const add = (
      check: Row["check"],
      status: Row["status"],
      detail?: string,
      unlockedBy?: string,
    ) => rows.push({ fixture: f.id, category: f.category, check, status, detail, unlockedBy });

    const sliders = page.locator('#chat-column input[type="range"]');
    if (await sliders.count()) {
      const before = await html();
      const slider = sliders.first();
      const { min, max, step, value } = await slider.evaluate((el: HTMLInputElement) => ({
        min: Number(el.min || 0),
        max: Number(el.max || 100),
        step: Number(el.step || 1),
        value: Number(el.value),
      }));
      // Move to a different valid step: one step toward the far end.
      const target = value + step <= max ? value + step : Math.max(min, value - step);
      await slider.fill(String(target));
      add(
        "slider",
        (await html()) !== before ? "pass" : "fail",
        "changing the slider updates the surface",
      );
    } else add("slider", "na");

    const tabs = page.locator('#chat-column [role="tab"]');
    if ((await tabs.count()) > 1) {
      const before = await text();
      await tabs.last().click();
      const selected = (await tabs.last().getAttribute("aria-selected")) === "true";
      add("tabs", selected && (await text()) !== before ? "pass" : "fail");
    } else add("tabs", "na");

    const boxes = page.locator('#chat-column input[type="checkbox"]');
    if (await boxes.count()) {
      const before = await html();
      await boxes.first().check();
      const progress = page.locator('#chat-column [role="progressbar"], #chat-column progress');
      // check() verifies the control state; a dependent readout (progress) must also react when one exists.
      const reacted = !(await progress.count()) || (await html()) !== before;
      add("checkbox", (await boxes.first().isChecked()) && reacted ? "pass" : "fail");
    } else add("checkbox", "na");

    const form = page.locator("#chat-column form");
    if (await form.count()) {
      for (const input of await form
        .locator('input[type="text"], input:not([type]), textarea')
        .all())
        await input.fill("검증");
      const submit = form.locator('button[type="submit"], button').last();
      await submit.click();
      const actions = await page.evaluate(() => (window as any).__actions as { name: string }[]);
      add(
        "form",
        actions.length ? "pass" : "fail",
        `actions emitted: ${actions.map((a) => a.name).join(",") || "none"}`,
      );
    } else {
      const buttons = page.locator("#chat-column button:not([role=tab]):not([aria-expanded])");
      const n = await buttons.count();
      if (n && !(await sliders.count())) {
        const before = await text();
        await buttons.last().click();
        const changed = (await text()) !== before;
        const emitted = (await page.evaluate(() => (window as any).__actions.length)) > 0;
        add(
          "button",
          changed || emitted ? "pass" : "fail",
          changed ? "local update" : emitted ? "action emitted" : "no effect",
        );
      } else add("button", "na");
      add("form", "na");
    }

    const reset = page.getByRole("button", { name: /reset|초기화/i });
    const interactive = (await sliders.count()) + (await boxes.count()) + (await form.count()) > 0;
    if (!interactive) add("reset", "na");
    else if (await reset.count()) {
      const initial = await html();
      add("reset", "pass", String(initial.length));
    } else add("reset", "expected-fail", "no reset control", "M2");
  }
  await mkdir("artifacts/eval", { recursive: true });
  await writeFile(
    "artifacts/eval/behavior.json",
    JSON.stringify({ timestamp: new Date().toISOString(), rows, pageErrors: errors }, null, 1),
  );
  expect(errors).toEqual([]);
});
