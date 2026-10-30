import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "artifacts/packages");
await mkdir(output, { recursive: true });
const directories = (await readdir("packages", { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => `packages/${entry.name}`)
  .filter((entry) => entry !== "packages/kits");
for (const kit of ["neutral", "editorial", "brand"]) directories.push(`packages/kits/${kit}`);
const files: string[] = [];
for (const directory of directories) {
  const data = JSON.parse(await readFile(`${directory}/package.json`, "utf8"));
  if (!data.name) continue;
  await copyFile("LICENSE", `${directory}/LICENSE`);
  await copyFile("NOTICE", `${directory}/NOTICE`);
  const result = execFileSync("pnpm", ["pack", "--pack-destination", output], {
    cwd: path.join(root, directory),
    encoding: "utf8",
  });
  const name = (await readdir(output)).find(
    (name) => name === `${data.name.replace("@", "").replace("/", "-")}-${data.version}.tgz`,
  );
  if (!name) throw Error(`Missing packed ${data.name}: ${result}`);
  files.push(name);
}
const consumer = path.join(root, "artifacts/consumer");
await rm(consumer, { recursive: true, force: true });
await mkdir(consumer, { recursive: true });
const dependencies: Record<string, string> = {
  react: "19.2.3",
  "react-dom": "19.2.3",
  jsdom: "27.4.0",
};
for (const directory of directories) {
  const data = JSON.parse(await readFile(`${directory}/package.json`, "utf8"));
  dependencies[data.name] =
    `file:${output}/${data.name.replace("@", "").replace("/", "-")}-${data.version}.tgz`;
}
await writeFile(
  `${consumer}/package.json`,
  JSON.stringify(
    { name: "engine-packed-consumer", private: true, type: "module", dependencies },
    null,
    2,
  ),
);
execFileSync(
  "npm",
  ["install", "--legacy-peer-deps", "--ignore-scripts", "--no-audit", "--no-fund"],
  { cwd: consumer, stdio: "pipe" },
);
await writeFile(
  `${consumer}/smoke.mjs`,
  `
import React,{act} from 'react';
import {renderToString} from 'react-dom/server';
import {createUIRuntime, UIProvider, UISurface} from '@engine/renderer-react';
import {neutral} from '@engine/kit-neutral';
import {CATALOG_ID} from '@engine/protocol';
import {GatewayAdapter} from '@engine/adapter-gateway';
import {JSDOM} from 'jsdom';
import {createRoot} from 'react-dom/client';
import {z} from 'zod';
const runtime=createUIRuntime();
runtime.accept({version:'v0.9',createSurface:{surfaceId:'main',catalogId:CATALOG_ID}});
runtime.accept({version:'v0.9',updateComponents:{surfaceId:'main',components:[{id:'root',component:'Text',text:'Packed consumer works'}]}});
const html=renderToString(React.createElement(UIProvider,{runtime,kit:neutral},React.createElement(UISurface,{surfaceId:'main'})));
if(!html.includes('ui-skeleton') || runtime.diagnostics.length) throw Error('SSR placeholder failed');
const dom=new JSDOM('<div id="root"></div>'); globalThis.window=dom.window; globalThis.document=dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const root=createRoot(document.getElementById('root')); await act(async()=>root.render(React.createElement(UIProvider,{runtime,kit:neutral},React.createElement(UISurface,{surfaceId:'main'}))));

if(!document.body.textContent.includes('Packed consumer works')) throw Error('Packed client failed'); root.unmount();
runtime.accept({version:'v0.9',updateComponents:{surfaceId:'main',components:[{id:'root',component:'Image',asset:'__proto__',alt:'Unregistered asset'}]}});
const imageRoot=createRoot(document.getElementById('root'));imageRoot.render(React.createElement(UIProvider,{runtime,kit:neutral},React.createElement(UISurface)));
await new Promise(resolve=>setTimeout(resolve,50));
if(document.querySelector('img') || !document.querySelector('[role="img"]'))throw Error('Asset registry prototype escape');imageRoot.unmount();
runtime.dispose();
const custom=createUIRuntime({catalogId:'urn:host:custom',components:[{name:'HostText',schema:z.object({text:z.string()})}]});
custom.accept({version:'v0.9',createSurface:{surfaceId:'main',catalogId:'urn:host:custom'}});
custom.accept({version:'v0.9',updateComponents:{surfaceId:'main',components:[{id:'root',component:'HostText',text:'Host registered widget'}]}});
const customRoot=createRoot(document.getElementById('root'));
const customKit={...neutral,catalogId:'urn:host:custom',components:{HostText:{implementation:'HostView'}}};
customRoot.render(React.createElement(UIProvider,{runtime:custom,kit:customKit,components:{HostView:({node})=>{if(node.props.text==='explode')throw Error('Expected host failure');return React.createElement('p',null,node.props.text);}}},React.createElement(UISurface)));
await new Promise(resolve=>setTimeout(resolve,50));
if(!document.body.textContent.includes('Host registered widget') || custom.diagnostics.length)throw Error('Custom catalog consumer failed');
const originalError=console.error;console.error=()=>{};
custom.accept({version:'v0.9',updateComponents:{surfaceId:'main',components:[{id:'root',component:'HostText',text:'explode'}]}});
await new Promise(resolve=>setTimeout(resolve,50));
// A failed host widget is reported, never drawn as an error card; the surface stays up.
if(!document.querySelector('.ui-surface') || document.querySelector('[role="alert"]') || !custom.diagnostics.some(d=>d.code==='RENDER_ERROR'))throw Error('Host error isolation failed');
custom.accept({version:'v0.9',updateComponents:{surfaceId:'main',components:[{id:'root',component:'HostText',text:'Recovered host widget'}]}});
await new Promise(resolve=>setTimeout(resolve,50));console.error=originalError;
if(!document.body.textContent.includes('Recovered host widget'))throw Error('Host renderer recovery failed');
customRoot.unmount();custom.dispose();console.log('Packed React and custom catalog consumer PASS; server adapter',typeof GatewayAdapter);
`,
);
const outputText = execFileSync("node", ["smoke.mjs"], { cwd: consumer, encoding: "utf8" });
const dryRuns: string[] = [];
for (const archive of files) {
  const directory = path.join(root, "artifacts/publish-dry", archive.replace(".tgz", ""));
  await mkdir(directory, { recursive: true });
  execFileSync("tar", ["-xzf", path.join(output, archive), "-C", directory]);
  const target = path.join(directory, "package");
  const manifest = JSON.parse(await readFile(path.join(target, "package.json"), "utf8"));
  delete manifest.private;
  await writeFile(path.join(target, "package.json"), JSON.stringify(manifest, null, 2));
  execFileSync("npm", ["publish", "--dry-run", "--ignore-scripts", "--json"], {
    cwd: target,
    stdio: "pipe",
  });
  dryRuns.push(manifest.name);
}
await writeFile(
  "artifacts/package-check.json",
  JSON.stringify({ files, consumer: outputText, dryRuns, private: true }, null, 2),
);
console.log(outputText);
