import { neutral } from "@engine/kit-neutral";
import { CATALOG_ID } from "@engine/protocol";
import { createUIRuntime, UIProvider, UISurface } from "@engine/renderer-react";
import React from "react";
import { createRoot } from "react-dom/client";
export async function measureFirstFrame() {
  const element = document.createElement("div");
  element.style.width = "390px";
  document.body.append(element);
  const root = createRoot(element);
  const timings: number[] = [];
  for (let iteration = 0; iteration < 35; iteration++) {
    const runtime = createUIRuntime();
    runtime.accept({
      version: "v0.9",
      createSurface: { surfaceId: "main", catalogId: CATALOG_ID },
    });
    root.render(
      <UIProvider runtime={runtime} kit={neutral}>
        <UISurface surfaceId="main" />
      </UIProvider>,
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const start = performance.now();
    runtime.accept({
      version: "v0.9",
      updateComponents: {
        surfaceId: "main",
        components: [
          {
            id: "root",
            component: "Column",
            children: Array.from({ length: 99 }, (_, i) => `n${i}`),
          },
          ...Array.from({ length: 99 }, (_, i) => ({
            id: `n${i}`,
            component: "Text",
            text: `측정 ${i}`,
          })),
        ],
      },
    });
    // Wait until the committed content is observable, then the next paint opportunity.
    while (!element.textContent?.includes("측정 98"))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (iteration >= 5) timings.push(performance.now() - start);
    root.render(<div />);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    runtime.dispose();
  }
  root.unmount();
  element.remove();
  timings.sort((a, b) => a - b);
  return {
    platform: "web",
    nodes: 100,
    samples: timings.length,
    p95Ms: timings[Math.ceil(timings.length * 0.95) - 1],
    timingsMs: timings,
  };
}
