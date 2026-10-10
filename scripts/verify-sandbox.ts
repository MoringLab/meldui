import { mkdir, writeFile } from "node:fs/promises";
import { DockerSandboxRuntime } from "../packages/sandbox/src/index.js";

/** Finite adversarial corpus. No retry or benchmark loop; each container has its own watchdog. */
const provider = new DockerSandboxRuntime();
const rows: { id: string; pass: boolean; detail: string }[] = [];
const cases = [
  {
    id: "namespaced-data-csp-bridge",
    mode: "app" as const,
    source: `<output id="out"></output><script>out.textContent=engine.namespace+":"+engine.data.count;engine.requestResize(300);fetch("https://example.com").catch(()=>{});</script>`,
    data: { count: 7 },
    namespace: "test-context",
    check: (r: any) =>
      r.text.includes("test-context:7") &&
      r.violations.some((d: string) => d.startsWith("connect-src")),
  },
  {
    id: "static-html-script-off",
    mode: "html" as const,
    source: '<p>STATIC_OK</p><script>document.body.innerText="SCRIPT_RAN"</script>',
    check: (r: any) => r.text.includes("STATIC_OK") && !r.text.includes("SCRIPT_RAN"),
  },
  {
    id: "app-input",
    mode: "app" as const,
    source:
      "<button onclick=\"document.querySelector('output').textContent='CLICK_OK'\">Step</button><output>READY</output>",
    events: [{ type: "click" as const, x: 40, y: 36 }],
    check: (r: any) => r.text.includes("CLICK_OK"),
  },
  {
    id: "parent-storage-cookie",
    mode: "app" as const,
    source: `<output id="result"></output><script>let blocked=0;for(const f of [()=>parent.document.body,()=>document.cookie,()=>localStorage.getItem('x')]){try{f()}catch{blocked++}}document.querySelector('output').textContent='BLOCKED_'+blocked;</script>`,
    check: (r: any) => r.text.includes("BLOCKED_3"),
  },
  {
    id: "network-fetch",
    mode: "app" as const,
    source: `<output>WAIT</output><script>Promise.all([fetch('https://example.com'),fetch('http://127.0.0.1:8787')].map(p=>p.then(()=>0,()=>1))).then(v=>document.querySelector('output').textContent='BLOCKED_'+v.reduce((a,b)=>a+b,0))</script>`,
    check: (r: any) => r.text.includes("BLOCKED_2"),
  },
  {
    id: "action-allowlist",
    mode: "app" as const,
    source: `<p>BRIDGE</p><script>parent.postMessage({type:'action',name:'pay'},'*');parent.postMessage({type:'action',name:'inspect'},'*');</script>`,
    allowedActions: ["inspect"],
    check: (r: any) => r.actions.length === 1 && r.actions[0].name === "inspect",
  },
  {
    id: "navigation-popup-form",
    mode: "app" as const,
    source: `<p>NAVIGATION_BLOCKED</p><script>try{top.location='https://example.com'}catch{};window.open('https://example.com');</script><form action="https://example.com"><button>Send</button></form>`,
    check: (r: any) => r.text.includes("NAVIGATION_BLOCKED"),
  },
  {
    id: "webrtc-network",
    mode: "app" as const,
    source: `<p>NETWORKLESS_PEER</p><script>const p=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});p.createDataChannel('x');p.createOffer().then(o=>p.setLocalDescription(o));</script>`,
    check: (r: any) => r.text.includes("NETWORKLESS_PEER"),
  },
];
for (const c of cases) {
  try {
    const r = await provider.run({
      data: (c as any).data,
      namespace: (c as any).namespace,
      source: c.source,
      mode: c.mode,
      events: (c as any).events,
      allowedActions: (c as any).allowedActions,
      width: 640,
      height: 480,
    });
    const pass = c.check(r);
    rows.push({ id: c.id, pass, detail: r.text.slice(0, 150) });
    if (c.id === "app-input")
      await writeFile("artifacts/sandbox/interactive.png", Buffer.from(r.screenshot, "base64"));
  } catch (error) {
    rows.push({ id: c.id, pass: false, detail: String(error).slice(0, 256) });
  }
}
for (const [id, source] of [
  ["infinite-loop", "<script>while(true){}</script>"],
  ["memory-bomb", "<script>let a=[];while(true)a.push(new Uint8Array(8e6).fill(1));</script>"],
  [
    "message-flood",
    "<script>while(true)parent.postMessage({type:'action',name:'inspect'},'*')</script>",
  ],
]) {
  const started = Date.now();
  try {
    await provider.run({ source, mode: "app" });
    rows.push({ id, pass: false, detail: "unexpected completion" });
  } catch (error) {
    rows.push({
      id,
      pass:
        Date.now() - started < 12000 &&
        /WATCHDOG|PROCESS/.test(String(error)) &&
        !/sandboxing failed|launch:/.test(String(error)),
      detail: String(error).slice(0, 200),
    });
  }
}
await mkdir("artifacts/sandbox", { recursive: true });
const proof = {
  at: new Date().toISOString(),
  fingerprint: provider.fingerprint(),
  passed: rows.every((r) => r.pass),
  rows,
};
await writeFile("artifacts/sandbox/attestation.json", JSON.stringify(proof, null, 2));
process.stdout.write(JSON.stringify(proof, null, 2) + "\n");
if (!proof.passed) process.exitCode = 1;
