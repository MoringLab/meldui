/**
 * The document a host loads into an isolated view (iframe, native web view) for a sandbox
 * block: the model's HTML under a strict Content-Security-Policy (no network, no frames, no
 * forms, no external anything), the kit's theme as `--ui-*` CSS variables, and a small bridge.
 *
 * The bridge reports the content height (`resize`) and keeps local artifact state
 * (`meld.saveState/getState`). Tool and shared-state calls go to the host, which may refuse
 * them. In `html` mode the model's scripts are blocked; only the bridge runs (by nonce).
 */
export type SandboxLibrary = { id: string; source: string; css?: string };

export type SandboxDocumentOptions = {
  source: string;
  mode: "html" | "app";
  /** `preview` (still streaming): nothing runs yet. */
  phase?: "preview" | "complete";
  /** The kit's colour tokens for the current mode, exposed as --ui-<name>. */
  theme: Record<string, string>;
  /** Host-approved bundles, inlined (the document itself can fetch nothing). */
  libraries?: SandboxLibrary[];
  /** Pairs the document with its host view; messages without it are ignored. */
  token: string;
  state?: Record<string, unknown>;
  /** How messages reach the host: an iframe's parent, or react-native-webview. */
  transport: "parent" | "react-native";
  /** CSS font stack for body text (the host's own fonts cannot be loaded). */
  font?: string;
};

export const SANDBOX_SOURCE_LIMIT = 131072;

const safeScript = (text: string) => text.replace(/<\/script/gi, "<\\/script");
const safeStyle = (text: string) => text.replace(/<\/style/gi, "<\\/style");
const attribute = (text: string) => text.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);

function bridge(
  token: string,
  initial: Record<string, unknown>,
  transport: SandboxDocumentOptions["transport"],
) {
  const send =
    transport === "react-native"
      ? "m=>window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m))"
      : "m=>parent.postMessage(m,'*')";
  return `(()=>{const token=${JSON.stringify(token)};const send=${send};let next=0;const pending=new Map();let saved=${JSON.stringify(initial).replaceAll("<", "\\u003c")};
const request=(method,args)=>new Promise((resolve,reject)=>{if(pending.size>=8)return reject(Error('Too many requests'));const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Host timed out'));},10000);pending.set(id,{resolve,reject,timer});send({token,id,method,args});});
window.meld=Object.freeze({libraries:Object.freeze(globalThis.__meldLibraries??{}),callTool:(name,args)=>request('tool',{name,args}),readState:path=>request('read',{path}),writeState:(path,value)=>request('write',{path,value}),saveState:value=>{if(!value||typeof value!=='object'||JSON.stringify(value).length>65536)throw Error('State limit');saved=value;send({token,method:'snapshot',args:value});},getState:()=>structuredClone(saved)});
const receive=e=>{let d=e.data;if(typeof d==='string'){try{d=JSON.parse(d);}catch{return;}}if(d?.token!==token)return;const p=pending.get(d.id);if(p){clearTimeout(p.timer);pending.delete(d.id);d.error?p.reject(Error(d.error)):p.resolve(d.value);}if(d.method==='theme')for(const [k,v]of Object.entries(d.value??{}))document.documentElement.style.setProperty('--ui-'+k,v);};
addEventListener('message',receive);document.addEventListener('message',receive);
let last=0;const report=()=>{const h=Math.ceil(document.documentElement.getBoundingClientRect().height);if(h!==last){last=h;send({token,method:'resize',args:{height:h}});}};
new ResizeObserver(report).observe(document.body);addEventListener('load',report);report();
})();`;
}

/** A complete HTML document for one sandbox block. Throws SANDBOX_SOURCE_LIMIT when too large. */
export function sandboxDocument(options: SandboxDocumentOptions): string {
  const {
    source,
    mode,
    phase = "complete",
    theme,
    libraries = [],
    token,
    state = {},
    transport,
  } = options;
  if (source.length > SANDBOX_SOURCE_LIMIT) throw Error("SANDBOX_SOURCE_LIMIT");
  const nonce = token.replace(/[^A-Za-z0-9]/g, "").slice(0, 32) || "meld";
  const running = phase === "complete";
  // A nonce disables 'unsafe-inline' (CSP3), so app mode (the model's scripts run) uses
  // 'unsafe-inline' alone and html mode (only the bridge runs) the nonce alone.
  const scripts = !running ? "'none'" : mode === "app" ? "'unsafe-inline'" : `'nonce-${nonce}'`;
  const csp = [
    "default-src 'none'",
    `script-src ${scripts}`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "media-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join(";");
  const vars = Object.entries(theme)
    .filter(([k, v]) => /^[a-zA-Z0-9-]+$/.test(k) && !/[;{}<>]/.test(v))
    .map(([k, v]) => `--ui-${k}:${v}`)
    .join(";");
  const font = (options.font ?? "system-ui,-apple-system,sans-serif").replace(/[;{}<>]/g, "");
  const css = safeStyle(libraries.map((l) => l.css ?? "").join("\n"));
  const js =
    running && mode === "app"
      ? libraries.map((l) => `<script nonce="${nonce}">${safeScript(l.source)}</script>`).join("")
      : "";
  const base =
    `:root{${vars};color-scheme:light dark}*{box-sizing:border-box}html,body{margin:0;background:transparent}` +
    `body{color:var(--ui-foreground);font:16px/1.6 ${font};-webkit-text-size-adjust:100%;overflow-wrap:anywhere}` +
    "button,input,select,textarea{font:inherit;color:inherit}button,input,select{min-height:44px}button{cursor:pointer}" +
    "canvas,svg,img,video{max-width:100%;height:auto}" +
    "@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}";
  const bridgeTag = running
    ? `<script nonce="${nonce}">${safeScript(bridge(token, state, transport))}</script>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${attribute(csp)}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>${base}</style><style>${css}</style>${js}</head><body>${bridgeTag}${source}</body></html>`;
}
