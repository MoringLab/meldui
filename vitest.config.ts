import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
const names = ['protocol', 'core', 'kit-spec', 'adapter-gateway', 'adapter-replay', 'transport-agui'];
export default defineConfig({
  resolve: { alias: Object.fromEntries([...names.map((name) => [`@engine/${name}`, fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))]), ...['neutral', 'editorial'].map((name) => [`@engine/kit-${name}`, fileURLToPath(new URL(`./packages/kits/${name}/src/index.ts`, import.meta.url))])]) },
  test: { include: ['packages/*/src/**/*.test.ts', 'tests/*.test.ts'], exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'] },
});
