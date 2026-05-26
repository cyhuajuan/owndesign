import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "../..");
const repoRoot = path.resolve(packageRoot, "../..");
const distDir = path.join(packageRoot, "dist");
const serverDistDir = path.join(repoRoot, "packages/server/dist");
const webDistDir = path.join(repoRoot, "apps/web/dist");

await rm(distDir, { force: true, recursive: true });
await mkdir(distDir, { recursive: true });

await build({
  banner: {
    js: [
      "#!/usr/bin/env node",
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

await cp(webDistDir, path.join(distDir, "web"), {
  recursive: true,
});

await cp(serverDistDir, path.join(distDir, "server"), {
  recursive: true,
});
