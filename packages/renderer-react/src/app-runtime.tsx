import { assertSafeJson, type HostBridge } from "@engine/core";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useUI } from "./renderer.js";
export type AppResource = { id: string; version: string; source: string; css?: string };
export type AppRuntimeProvider = {
  maxHeight?: number;
  kind: "live";
  assurance: "browser";
  resources?: AppResource[];
  components?: AppResource[];
  loadResources?: (ids: string[], signal: AbortSignal) => Promise<AppResource[]>;
  bridge?: HostBridge;
  onSnapshot?: (id: string, state: Record<string, unknown>) => void;
};
const safeScript = (text: string) => text.replace(/<\/script/gi, "<\\/script");
const bridgeSource = (token: string, initial: Record<string, unknown>) => `
(()=>{const token=${JSON.stringify(token)};let next=0;const pending=new Map();let saved=${JSON.stringify(initial).replaceAll("<", "\\u003c")};
const request=(method,args)=>new Promise((resolve,reject)=>{if(pending.size>=8)return reject(Error('Too many requests'));const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Host timed out'));},10000);pending.set(id,{resolve,reject,timer});parent.postMessage({token,id,method,args},'*');});
window.meld=Object.freeze({libraries:Object.freeze(globalThis.__meldLibraries??{}),callTool:(name,args)=>request('tool',{name,args}),readState:path=>request('read',{path}),writeState:(path,value)=>request('write',{path,value}),saveState:value=>{if(!value||typeof value!=='object'||JSON.stringify(value).length>65536)throw Error('State limit');saved=value;parent.postMessage({token,method:'snapshot',args:value},'*');},getState:()=>structuredClone(saved)});
addEventListener('message',e=>{if(e.source!==parent||e.data?.token!==token)return;const p=pending.get(e.data.id);if(p){clearTimeout(p.timer);pending.delete(e.data.id);e.data.error?p.reject(Error(e.data.error)):p.resolve(e.data.value);}if(e.data.method==='theme')for(const [k,v]of Object.entries(e.data.value??{}))document.documentElement.style.setProperty('--ui-'+k,v);});
new ResizeObserver(()=>parent.postMessage({token,method:'resize',args:{height:Math.ceil(document.body.getBoundingClientRect().height)}},'*')).observe(document.body);
})();`;
/** Persistent live iframe. Browser isolation is intentionally not a hard CPU/memory guarantee. */
export function LiveAppView({
  id,
  source,
  fallbackText,
  provider,
  initialState = {},
  phase = "complete",
  libraries = [],
  mode: executionMode = "app",
}: {
  id: string;
  source: string;
  fallbackText: string;
  provider: AppRuntimeProvider;
  initialState?: Record<string, unknown>;
  phase?: "preview" | "complete";
  libraries?: string[];
  mode?: "html" | "app";
}) {
  const { kit, mode } = useUI();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200),
    [error, setError] = useState(""),
    [stopped, setStopped] = useState(false);
  const token = useMemo(
    () => `${id}:${source.length}:${phase}:${crypto.randomUUID()}`,
    [id, source, phase],
  );
  const state = useRef(initialState);
  const controller = useRef<AbortController | undefined>(undefined);
  const theme = useRef(kit.tokens[mode]);
  theme.current = kit.tokens[mode];
  const [loaded, setLoaded] = useState<AppResource[]>([]);
  const required = libraries.join(",");
  useEffect(() => {
    const abort = new AbortController();
    setLoaded([]);
    if (required && provider.loadResources)
      provider
        .loadResources(required.split(","), abort.signal)
        .then((value) => {
          if (!abort.signal.aborted) setLoaded(value);
        })
        .catch(() => {
          if (!abort.signal.aborted) setError("An approved resource is unavailable.");
        });
    return () => abort.abort();
  }, [required, provider.loadResources]);
  const assets = useMemo(
    () => [...(provider.resources ?? []), ...(provider.components ?? []), ...loaded],
    [provider.resources, provider.components, loaded],
  );
  const ready =
    phase === "preview" || libraries.every((id) => assets.some((asset) => asset.id === id));
  const assetCss = useMemo(
    () =>
      assets
        .map((r) => r.css ?? "")
        .join("\n")
        .replace(/<\/style/gi, "<\\/style"),
    [assets],
  );
  const assetJs = useMemo(
    () => assets.map((r) => `<script>${safeScript(r.source)}</script>`).join(""),
    [assets],
  );
  const documentSource = useMemo(() => {
    if (source.length > 131072) throw Error("APP_SOURCE_LIMIT");
    const css = Object.entries(theme.current)
      .map(([k, v]) => `--ui-${k}:${v}`)
      .join(";");
    const csp = `default-src 'none';script-src ${phase === "complete" && executionMode === "app" ? "'unsafe-inline'" : "'none'"};style-src 'unsafe-inline';img-src data: blob:;media-src blob:;connect-src 'none';font-src data:;frame-src 'none';form-action 'none';base-uri 'none';object-src 'none'`;
    const libraryCss = assetCss;
    const libraries = phase === "complete" ? assetJs : "";
    return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><style>:root{${css}}*{box-sizing:border-box}body{margin:0;padding:20px;background:var(--ui-background);color:var(--ui-foreground);font:16px/1.55 system-ui}button,input,select{font:inherit}button,input,select{min-height:44px}button{cursor:pointer}canvas,svg{max-width:100%}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}</style><style>${libraryCss}</style>${libraries}</head><body>${phase === "complete" ? `<script>${safeScript(bridgeSource(token, state.current))}</script>` : ""}${source}</body></html>`;
    // Theme is delivered without reinitializing a completed program or losing local input.
  }, [source, token, phase, assetJs, assetCss, executionMode]);
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    setError("");
    setStopped(false);
    const receive = async (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        event.data?.token !== token
      )
        return;
      const data = event.data;
      try {
        if (JSON.stringify(data).length > 65536) return;
        if (data.method === "resize") {
          if (Number.isFinite(data.args?.height))
            setHeight(Math.min(provider.maxHeight ?? 4096, Math.max(100, data.args.height)));
          return;
        }
        if (data.method === "snapshot") {
          assertSafeJson(data.args);
          state.current = structuredClone(data.args);
          provider.onSnapshot?.(id, state.current);
          return;
        }
        if (!Number.isInteger(data.id)) return;
        let value: unknown;
        if (data.method === "tool")
          value = await provider.bridge?.call(data.args.name, data.args.args, abort.signal);
        else if (data.method === "read") value = provider.bridge?.read(data.args.path);
        else if (data.method === "write")
          value = provider.bridge?.write(data.args.path, data.args.value);
        else throw Error("HOST_METHOD_DENIED");
        if (!provider.bridge) throw Error("HOST_BRIDGE_UNAVAILABLE");
        if (!abort.signal.aborted)
          frame.current?.contentWindow?.postMessage({ token, id: data.id, value }, "*");
      } catch {
        if (!abort.signal.aborted)
          frame.current?.contentWindow?.postMessage(
            { token, id: data.id, error: "Host operation unavailable" },
            "*",
          );
      }
    };
    addEventListener("message", receive);
    return () => {
      abort.abort();
      removeEventListener("message", receive);
    };
  }, [provider.bridge, provider.onSnapshot, provider.maxHeight, token, id]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { token, method: "theme", value: kit.tokens[mode] },
      "*",
    );
  }, [kit, mode, token]);
  return (
    <section className="ui-live-app" aria-label={fallbackText}>
      <div className="ui-live-toolbar">
        <span>{phase === "preview" ? "Building…" : "Interactive"}</span>
        <button
          type="button"
          onClick={() => {
            controller.current?.abort();
            setStopped(true);
          }}
        >
          Stop
        </button>
      </div>
      {stopped || !ready ? (
        <p role="note">{fallbackText}</p>
      ) : (
        <iframe
          ref={frame}
          title={fallbackText}
          sandbox={phase === "complete" && executionMode === "app" ? "allow-scripts" : ""}
          allow="camera 'none'; microphone 'none'; geolocation 'none'; fullscreen 'none'"
          referrerPolicy="no-referrer"
          srcDoc={documentSource}
          style={{ width: "100%", height, border: 0 }}
          onLoad={() =>
            frame.current?.contentWindow?.postMessage(
              { token, method: "theme", value: theme.current },
              "*",
            )
          }
          onError={() => setError("The interactive content could not load.")}
        />
      )}
      {error && (
        <p role="alert">
          {error} {fallbackText}
        </p>
      )}
    </section>
  );
}
