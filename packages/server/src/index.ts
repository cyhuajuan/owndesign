import { serve } from "@hono/node-server";

import { createOwnDesignApp } from "./app";
import type { OwnDesignServerOptions } from "./services";

export type StartServerOptions = OwnDesignServerOptions & {
  host?: string;
  port?: number;
};

export function startServer(options: StartServerOptions = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3711;
  const app = createOwnDesignApp(options);
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
