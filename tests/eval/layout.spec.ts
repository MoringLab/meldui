import { mkdir, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import fixtures from "../../fixtures/cases.json" with { type: "json" };

const WIDTHS = [320, 480, 720, 960];
const KITS = ["neutral", "editorial"];
const MODES = ["light", "dark"];
const FIXTURES = (process.env.EVAL_FIXTURES?.split(",") ?? fixtures.map((f) => f.id)).filter(
  Boolean,
);

type Row = {
  fixture: string;
  width: number;
  kit: string;
  mode: string;
  overflow: string[];
  smallTargets: string[];
  contrast: number;
  firstPaintEmpty: boolean;
  errors: string[];
};

test("layout matrix across container widths", async ({ page }) => {
  const rows: Row[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  for (const id of FIXTURES)
    for (const width of WIDTHS)
      for (const kit of KITS)
        for (const mode of MODES) {
          // Viewport stays wide so only the container (not the window) constrains layout.
          await page.setViewportSize({ width: 1280, height: 900 });
          await page.goto(`/eval.html?fixture=${id}&width=${width}&kit=${kit}&mode=${mode}`);
          await page.waitForFunction(() => (window as any).__ready === true);
          const m = await page.evaluate(() => {
            const column = document.getElementById("chat-column") as HTMLElement;
            const box = column.getBoundingClientRect();
            const scrollsX = (el: Element) => {
              for (
                let n: Element | null = el.parentElement;
                n && n !== column;
                n = n.parentElement
              ) {
                const o = getComputedStyle(n).overflowX;
                if (o === "auto" || o === "scroll" || o === "hidden") return true;
              }
              return false;
            };
            const overflow: string[] = [];
            for (const el of column.querySelectorAll("*")) {
              const r = el.getBoundingClientRect();
              if (!r.width || !r.height) continue;
              if ((r.right > box.right + 1 || r.left < box.left - 1) && !scrollsX(el))
                overflow.push(
                  `${el.tagName.toLowerCase()}.${(el as HTMLElement).className}`.slice(0, 60),
                );
            }
            const small: string[] = [];
            const interactive =
              "button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=button], summary";
            for (const el of column.querySelectorAll(interactive)) {
              const style = getComputedStyle(el);
              if (style.visibility === "hidden" || style.display === "none") continue;
              let r = el.getBoundingClientRect();
              const label = el.closest("label");
              if ((r.width < 44 || r.height < 44) && label) r = label.getBoundingClientRect();
              if (r.width < 44 || r.height < 44)
                small.push(
                  `${el.tagName.toLowerCase()}${(el as HTMLInputElement).type ? `[${(el as HTMLInputElement).type}]` : ""} ${Math.round(r.width)}x${Math.round(r.height)}`,
                );
            }
            return {
              overflow: [...new Set(overflow)].slice(0, 6),
              small: [...new Set(small)].slice(0, 8),
              empty: !(column.innerText || "").trim() || box.height < 20,
            };
          });
          const axe = await new AxeBuilder({ page })
            .include("#chat-column")
            .withRules(["color-contrast"])
            .analyze();
          rows.push({
            fixture: id,
            width,
            kit,
            mode,
            overflow: m.overflow,
            smallTargets: m.small,
            contrast: axe.violations.reduce((n, v) => n + v.nodes.length, 0),
            firstPaintEmpty: m.empty,
            errors: pageErrors.splice(0),
          });
        }
  await mkdir("artifacts/eval", { recursive: true });
  await writeFile(
    "artifacts/eval/layout.json",
    JSON.stringify({ timestamp: new Date().toISOString(), widths: WIDTHS, rows }, null, 1),
  );
  expect(rows.length).toBe(FIXTURES.length * WIDTHS.length * KITS.length * MODES.length);
});
