import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const approved = {
  three: { package: "three", version: "0.180.0" },
  d3: { package: "d3", version: "7.9.0" },
  chart: { package: "chart.js/auto", version: "4.5.1" },
  gsap: { package: "gsap", version: "3.13.0" },
  katex: { package: "katex", version: "0.18.2" },
};
const cache = new Map<
  string,
  Promise<{ id: string; version: string; source: string; css?: string }>
>();
/** Host-approved packages become inert source bundles; generated code never names a module path. */
export function resourceBundle(id: string) {
  if (!Object.hasOwn(approved, id)) throw Error("RESOURCE_DENIED");
  const resource = approved[id as keyof typeof approved];
  if (!cache.has(id))
    cache.set(
      id,
      (async () => {
        const output = await build({
          stdin: {
            contents: `import * as library from ${JSON.stringify(resource.package)};globalThis.__meldLibraries=globalThis.__meldLibraries??{};globalThis.__meldLibraries[${JSON.stringify(id)}]=library;${id === "katex" ? "import 'katex/dist/katex.min.css';" : ""}`,
            resolveDir: fileURLToPath(new URL("..", import.meta.url)),
          },
          outfile: "bundle.js",
          bundle: true,
          write: false,
          format: "iife",
          platform: "browser",
          minify: true,
          loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
        });
        return {
          id,
          version: resource.version,
          source: output.outputFiles.find((f) => f.path.endsWith(".js"))!.text,
          css: output.outputFiles.find((f) => f.path.endsWith(".css"))?.text,
        };
      })(),
    );
  return cache.get(id)!;
}
