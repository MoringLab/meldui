import { describe, expect, it } from "vitest";
import { sandboxDocument } from "./sandbox.js";

const base = {
  theme: { foreground: "#111", accent: "#00856A" },
  token: "t-1",
  transport: "react-native" as const,
};
const csp = (doc: string) => doc.match(/Content-Security-Policy" content="([^"]+)"/)![1]!;

describe("sandboxDocument", () => {
  it("lets app mode run the model's scripts but nothing reaches the network", () => {
    const doc = sandboxDocument({
      ...base,
      mode: "app",
      source: "<canvas></canvas><script>draw()</script>",
    });
    expect(csp(doc)).toContain("script-src 'unsafe-inline'");
    expect(csp(doc)).not.toContain("nonce-");
    for (const rule of [
      "connect-src 'none'",
      "frame-src 'none'",
      "img-src data: blob:",
      "form-action 'none'",
    ])
      expect(csp(doc)).toContain(rule);
    expect(doc).toContain("--ui-accent:#00856A");
    expect(doc).toContain("ReactNativeWebView.postMessage");
  });

  it("runs only its own bridge in html mode, and nothing while previewing", () => {
    const html = sandboxDocument({
      ...base,
      mode: "html",
      source: "<p>hi</p><script>evil()</script>",
    });
    expect(csp(html)).toMatch(/script-src 'nonce-t1'$|script-src 'nonce-t1';/);
    expect(html).toContain('<script nonce="t1">');
    const preview = sandboxDocument({ ...base, mode: "app", phase: "preview", source: "<p>…</p>" });
    expect(csp(preview)).toContain("script-src 'none'");
    expect(preview).not.toContain("<script");
  });

  it("keeps markup in the source from closing the theme or bridge", () => {
    const doc = sandboxDocument({
      ...base,
      mode: "app",
      source: "x",
      theme: { "bad;key": "1", ok: "red}</style>" },
      state: { a: "</script>" },
    });
    expect(doc).not.toContain("bad;key");
    expect(doc).not.toContain("red}</style>");
    expect(doc).not.toContain('"</script>"');
    expect(() => sandboxDocument({ ...base, mode: "app", source: "x".repeat(131073) })).toThrow(
      "SANDBOX_SOURCE_LIMIT",
    );
  });
});
