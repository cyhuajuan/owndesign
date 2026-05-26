import { serve } from "@hono/node-server";
import path from "node:path";

import { createOwnDesignApp } from "./app";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3711;

const host = process.env.OWNDESIGN_SERVER_HOST ?? DEFAULT_HOST;
const port = parsePort(process.env.OWNDESIGN_SERVER_PORT ?? String(DEFAULT_PORT));
const staticRoot = process.env.OWNDESIGN_WEB_ROOT ?? path.resolve(process.cwd(), "web");

const app = createOwnDesignApp({
  staticRoot,
});
const server = serve({
  fetch: app.fetch,
  hostname: host,
  port,
});

console.log(`OwnDesign listening at http://${host}:${port}`);

const close = () =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const shutdown = async () => {
  try {
    await close();
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to stop OwnDesign.");
    process.exit(1);
  }
};

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});

function parsePort(value: string) {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid OWNDESIGN_SERVER_PORT: ${value}`);
  }

  return port;
}
