import { cp, mkdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const repoRoot = path.resolve(appRoot, '../..');
const serverDist = path.join(repoRoot, 'packages/server/dist');
const serverResource = path.join(appRoot, 'src-tauri/resources/server');

await rm(serverResource, { force: true, recursive: true });
await mkdir(path.dirname(serverResource), { recursive: true });
await cp(serverDist, serverResource, { recursive: true });

const serverNodeModules = path.join(serverResource, 'node_modules');
const playwrightCoreSource = await realpath(
  path.join(repoRoot, 'packages/server/node_modules/playwright-core'),
);

await mkdir(serverNodeModules, { recursive: true });
await cp(playwrightCoreSource, path.join(serverNodeModules, 'playwright-core'), {
  recursive: true,
});
