// Trusted container code. Only Chromium receives generated source, never Node evaluation.
const { chromium } = require("playwright");
let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
  if (input.length > 200000) process.exit(2);
});
process.stdin.on("end", async () => {
  let browser;
  try {
    const request = JSON.parse(input);
    browser = await chromium.launch({
      chromiumSandbox: true,
      args: [
        "--disable-dev-shm-usage",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ],
    });
    const context = await browser.newContext({
      viewport: { width: request.width, height: request.height },
      offline: true,
    });
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    const violations = [],
      consoleErrors = [],
      actions = [];
    page.on("pageerror", (error) => consoleErrors.push(String(error.message).slice(0, 256)));
    await page.setContent(
      '<!doctype html><html><body style="margin:0"><iframe id="viewer" title="AI-generated interactive content" style="width:100vw;height:100vh;border:0"></iframe></body></html>',
    );
    await page.evaluate(
      ({ request }) => {
        const iframe = document.querySelector("iframe");
        iframe.sandbox = request.mode === "app" ? "allow-scripts" : "";
        window.__actions = [];
        window.__violations = [];
        window.__size = { width: request.width, height: request.height };
        window.addEventListener("message", (event) => {
          if (event.source !== iframe.contentWindow || event.origin !== "null") return;
          const data = event.data;
          if (
            data?.type === "resize" &&
            Number.isInteger(data.height) &&
            data.height >= 200 &&
            data.height <= 800
          ) {
            iframe.style.height = data.height + "px";
            window.__size.height = data.height;
          }
          if (
            data?.type === "csp" &&
            typeof data.directive === "string" &&
            window.__violations.length < 20
          )
            window.__violations.push(data.directive.slice(0, 128));
          if (typeof data !== "object" || !data) return;
          if (
            data.type === "action" &&
            typeof data.name === "string" &&
            request.allowedActions.includes(data.name) &&
            window.__actions.length < 20
          )
            window.__actions.push({ name: data.name });
        });
        const csp = `default-src 'none'; script-src ${request.mode === "app" ? "'unsafe-inline'" : "'none'"}; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'`;
        const variables = Object.entries(request.theme ?? {})
          .filter(
            ([key, value]) =>
              /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key) && /^#[0-9a-fA-F]{3,8}$/.test(value),
          )
          .map(([key, value]) => `--engine-${key}:${value}`)
          .join(";");
        const json = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
        const bridge =
          request.mode === "app"
            ? `<script>window.engine=Object.freeze({namespace:${json(request.namespace)},data:Object.freeze(${json(request.data)}),theme:Object.freeze(${json(request.theme)}),requestResize:height=>parent.postMessage({type:"resize",height},"*"),action:name=>parent.postMessage({type:"action",name},"*")});document.addEventListener("securitypolicyviolation",e=>parent.postMessage({type:"csp",directive:e.violatedDirective},"*"));</script>`
            : "";
        iframe.srcdoc =
          `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><style>:root{${variables}}body{margin:16px;font:16px system-ui;color:var(--engine-foreground,#17212b);background:var(--engine-background,#fff)}button{min-height:44px;min-width:44px}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}</style>` +
          bridge +
          request.source;
      },
      { request },
    );
    await page.waitForTimeout(200);
    for (const event of request.events) {
      if (event.type === "click") await page.mouse.click(event.x, event.y);
      else if (event.type === "key") await page.keyboard.press(event.key);
      await page.waitForTimeout(50);
    }
    const screenshot = (await page.screenshot({ type: "png", timeout: 2000 })).toString("base64");
    const observed = await page.evaluate(() => ({
      actions: window.__actions ?? [],
      violations: window.__violations ?? [],
    }));
    actions.push(...observed.actions);
    violations.push(...observed.violations);
    const frame = page.frames()[1];
    let text = "";
    if (frame)
      text = await frame
        .locator("body")
        .innerText({ timeout: 1000 })
        .catch(() => "");
    process.stdout.write(
      JSON.stringify({ screenshot, actions, violations, consoleErrors, text: text.slice(0, 4000) }),
    );
  } catch (error) {
    process.stderr.write(String(error.message).slice(0, 1000));
    process.exitCode = 2;
  } finally {
    if (browser) await browser.close();
  }
});
