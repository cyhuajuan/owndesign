import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "../..");
const distDir = path.join(packageRoot, "dist");

await rm(distDir, { force: true, recursive: true });
await mkdir(distDir, { recursive: true });

await build({
  banner: {
    js: [
      "import { createRequire as __owndesignCreateRequire } from 'node:module';",
      "const require = __owndesignCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  bundle: true,
  entryPoints: [path.join(packageRoot, "src/index.ts")],
  format: "esm",
  outfile: path.join(distDir, "index.js"),
  platform: "node",
  target: "node22",
});
