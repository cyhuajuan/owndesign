import { serve } from "@hono/node-server";
import path from "node:path";

import { createOwnDesignApp } from "./app";
import type { OwnDesignServerOptions } from "./services";

export type StartServerOptions = OwnDesignServerOptions & {
  host?: string;
  port?: number;
};

export function startServer(options: StartServerOptions = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3711;
  const app = createOwnDesignApp({
    ...options,
    staticRoot:
      options.staticRoot ??
      process.env.OWNDESIGN_WEB_ROOT ??
      path.resolve(process.cwd(), "web"),
  });
  const server = serve({
    fetch: app.fetch,
    hostname: host,
    port,
  });

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
    host,
    port,
    server,
    url: `http://${host}:${port}`,
  };
}

export { createOwnDesignApp };
export type { OwnDesignServerOptions };
