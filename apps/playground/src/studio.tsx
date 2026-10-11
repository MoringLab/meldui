import { AnswerSession, HostBridge } from "@engine/core";
import { editorial } from "@engine/kit-editorial";
import { neutral } from "@engine/kit-neutral";
import { extendKit, referenceComponents } from "@engine/kit-spec";
import { AnswerView, createUIRuntime, UIProvider } from "@engine/renderer-react";
import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import custom from "../../../fixtures/custom/case.json";
import { loadAppResources } from "./app-resources";
import { customComponents } from "./custom-components";
import "@engine/renderer-react/styles.css";
import "./showcase.css";
function Studio() {
  const [kit, setKit] = useState("neutral"),
    [status, setStatus] = useState(""),
    [dark, setDark] = useState(false);
  const session = useMemo(() => {
    const runtime = createUIRuntime({
      catalogId: "urn:meldui:studio:1",
      customComponents: referenceComponents,
      onAction: (a) => setStatus(`${a.name}: ${JSON.stringify(a.context)}`),
    });
    const value = new AnswerSession(runtime);
    for (const message of custom.messages) value.pushMessage(message);
    value.end();
    return value;
  }, []);
  React.useEffect(() => () => session.runtime.dispose(), [session]);
  const bridge = useMemo(
    () =>
      new HostBridge({ state: { "/voltage": 12 }, readable: ["/voltage"], writable: ["/voltage"] }),
    [],
  );
  const appSession = useMemo(() => {
    const value = new AnswerSession(createUIRuntime(), { policy: { allowSandbox: true } });
    value.push(
      JSON.stringify({
        engine: "v1",
        block: "sandbox",
        mode: "app",
        artifactId: "local-counter",
        source:
          '<button id="add">Add one</button><output id="count">0</output><script>let n=meld.getState().n||0;const out=document.querySelector("output");out.textContent=n;document.querySelector("button").onclick=()=>{out.textContent=++n;meld.saveState({n})};</script>',
        fallbackText: "A local counter that persists across theme changes.",
      }) + "\n",
    );
    value.push(
      JSON.stringify({
        engine: "v1",
        block: "sandbox",
        mode: "app",
        artifactId: "three-widget",
        libraries: ["three"],
        fallbackText: "3D shape with a local rotation slider and an approved host component.",
        source: `<h3>Approved Three.js · host components</h3><label>Rotation<input aria-label="Rotation" type="range" min="0" max="360" value="30"></label><div id="scene"></div><meld-stepper></meld-stepper><output id="render-state"></output><script>
const THREE=meld.libraries.three, input=document.querySelector('input'), view=document.querySelector('#scene'), out=document.querySelector('#render-state');
input.value=meld.getState().rotation??30;try{const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,2,0.1,100);camera.position.set(0,0,5);const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});const width=Math.min(640,view.clientWidth)||640;renderer.setSize(width,width/2);view.append(renderer.domElement);const geometry=new THREE.TorusKnotGeometry(.8,.18,80,12),material=new THREE.MeshNormalMaterial(),mesh=new THREE.Mesh(geometry,material);scene.add(mesh);const render=()=>{mesh.rotation.y=+input.value*Math.PI/180;renderer.render(scene,camera);out.textContent='Rotation '+input.value+'°';meld.saveState({rotation:+input.value})};input.oninput=render;render();addEventListener('pagehide',()=>{geometry.dispose();material.dispose();renderer.dispose()},{once:true});}catch{out.textContent='WebGL unavailable; rotate the portable scene in Showcase instead.';}
</script>`,
      }) + "\n",
    );
    value.end();
    return value;
  }, []);
  React.useEffect(
    () => () => {
      appSession.runtime.dispose();
      bridge.dispose();
    },
    [appSession, bridge],
  );
  const provider = useMemo(
    () => ({
      kind: "live" as const,
      assurance: "browser" as const,
      bridge,
      loadResources: loadAppResources,
      components: [
        {
          id: "host-ui",
          version: "1.0.0",
          source: `customElements.define('meld-stepper',class extends HTMLElement{connectedCallback(){if(this.shadowRoot)return;const root=this.attachShadow({mode:'open'});root.innerHTML='<style>button{font:inherit;color:var(--ui-foreground);background:var(--ui-surface);border:1px solid var(--ui-border);min-height:44px;border-radius:8px;padding:8px 16px}</style><button>Host stepper: 0</button>';let n=0;root.querySelector('button').onclick=()=>{root.querySelector('button').textContent='Host stepper: '+ ++n}}});`,
        },
      ],
      onSnapshot: (id: string, state: Record<string, unknown>) =>
        appSession.saveArtifactState(id, state),
    }),
    [appSession, bridge],
  );
  return (
    <main className="showcase">
      <header className="showcase-header">
        <h1>Kit studio</h1>
        <a href="/showcase.html">Showcase</a>
      </header>
      <p>호스트의 컴포넌트와 코드 위젯도 같은 상태·권한 계약을 사용합니다.</p>
      <div className="showcase-settings">
        <label>
          Kit
          <select aria-label="Kit" value={kit} onChange={(e) => setKit(e.target.value)}>
            <option>neutral</option>
            <option>editorial</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
          다크 모드
        </label>
      </div>
      <UIProvider
        runtime={session.runtime}
        kit={extendKit(
          kit === "neutral" ? neutral : editorial,
          referenceComponents,
          "urn:meldui:studio:1",
        )}
        components={customComponents}
        mode={dark ? "dark" : "light"}
      >
        <AnswerView session={session} />
      </UIProvider>
      <p role="status">{status}</p>
      <h2>Live widget</h2>
      <UIProvider
        runtime={appSession.runtime}
        kit={kit === "neutral" ? neutral : editorial}
        mode={dark ? "dark" : "light"}
      >
        <AnswerView session={appSession} appRuntime={provider} />
      </UIProvider>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Studio />);
