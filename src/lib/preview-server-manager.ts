import { access, readFile } from "node:fs/promises";
import path from "node:path";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import { WorkspaceStore } from "./workspace-store";

type PreviewServerManagerOptions = {
  cleanupIntervalMs?: number;
  leaseTtlMs?: number;
  now?: () => number;
  workspaceStore: WorkspaceStore;
};

type PreviewServerEntry = {
  app: FastifyInstance;
  leases: Map<string, number>;
  projectId: string;
  url: string;
};

const DEFAULT_CLEANUP_INTERVAL_MS = 30_000;
const DEFAULT_LEASE_TTL_MS = 90_000;
const PREVIEW_HOST = "127.0.0.1";

declare global {
  var __hjdesignPreviewServerManager: PreviewServerManager | undefined;
}

export class PreviewServerManager {
  private readonly cleanupIntervalMs: number;
  private readonly entries = new Map<string, PreviewServerEntry>();
  private readonly leaseTtlMs: number;
  private readonly now: () => number;
  private readonly starts = new Map<string, Promise<PreviewServerEntry>>();
  private readonly workspaceStore: WorkspaceStore;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: PreviewServerManagerOptions) {
    this.cleanupIntervalMs =
      options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    this.now = options.now ?? Date.now;
    this.workspaceStore = options.workspaceStore;
  }

  async ensure(projectId: string, clientId: string) {
    const entry = await this.getOrStartEntry(projectId);

    this.touchLease(entry, clientId);
    this.ensureCleanupTimer();

    return { url: entry.url };
  }

  async heartbeat(projectId: string, clientId: string) {
    return this.ensure(projectId, clientId);
  }

  async release(projectId: string, clientId: string) {
    const entry = this.entries.get(projectId);

    if (!entry) {
      return;
    }

    entry.leases.delete(clientId);

    if (entry.leases.size === 0) {
      await this.closeEntry(projectId, entry);
    }
  }

  async stop(projectId: string) {
    const starting = this.starts.get(projectId);

    if (starting) {
      await starting;
    }

    const entry = this.entries.get(projectId);

    if (entry) {
      await this.closeEntry(projectId, entry);
    }
  }

  async stopAll() {
    await Promise.all(
      Array.from(this.entries, ([projectId, entry]) =>
        this.closeEntry(projectId, entry),
      ),
    );
  }

  getActiveServerCount() {
    return this.entries.size;
  }

  getLeaseCount(projectId: string) {
    return this.entries.get(projectId)?.leases.size ?? 0;
  }

  async cleanupExpiredLeases() {
    const now = this.now();

    await Promise.all(
      Array.from(this.entries, async ([projectId, entry]) => {
        for (const [clientId, expiresAt] of entry.leases) {
          if (expiresAt <= now) {
            entry.leases.delete(clientId);
          }
        }

        if (entry.leases.size === 0) {
          await this.closeEntry(projectId, entry);
        }
      }),
    );
  }

  private async getOrStartEntry(projectId: string) {
    const existingEntry = this.entries.get(projectId);

    if (existingEntry) {
      return existingEntry;
    }

    const existingStart = this.starts.get(projectId);

    if (existingStart) {
      return existingStart;
    }

    const start = this.startEntry(projectId);
    this.starts.set(projectId, start);

    try {
      return await start;
    } finally {
      this.starts.delete(projectId);
    }
  }

  private async startEntry(projectId: string): Promise<PreviewServerEntry> {
    await this.workspaceStore.getProject(projectId);

    const workspaceDirectory =
      this.workspaceStore.getProjectWorkspaceDirectory(projectId);
    const app = Fastify({ logger: false });

    app.get("/", async (_request, reply) =>
      reply.type("text/html; charset=utf-8").send(
        await readIndexHtmlOrEmptyPreview(workspaceDirectory),
      ),
    );
    app.get("/index.html", async (_request, reply) =>
      reply.type("text/html; charset=utf-8").send(
        await readIndexHtmlOrEmptyPreview(workspaceDirectory),
      ),
    );
    await app.register(fastifyStatic, {
      decorateReply: false,
      root: workspaceDirectory,
    });

    const address = await app.listen({ host: PREVIEW_HOST, port: 0 });
    const entry: PreviewServerEntry = {
      app,
      leases: new Map(),
      projectId,
      url: `${address.replace(/\/$/, "")}/index.html`,
    };

    this.entries.set(projectId, entry);

    return entry;
  }

  private touchLease(entry: PreviewServerEntry, clientId: string) {
    entry.leases.set(clientId, this.now() + this.leaseTtlMs);
  }

  private async closeEntry(projectId: string, entry: PreviewServerEntry) {
    this.entries.delete(projectId);
    entry.leases.clear();
    await entry.app.close();

    if (this.entries.size === 0) {
      this.clearCleanupTimer();
    }
  }

  private ensureCleanupTimer() {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredLeases();
    }, this.cleanupIntervalMs);
    this.cleanupTimer.unref?.();
  }

  private clearCleanupTimer() {
    if (!this.cleanupTimer) {
      return;
    }

    clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
  }
}

export function getPreviewServerManager(workspaceStore: WorkspaceStore) {
  globalThis.__hjdesignPreviewServerManager ??= new PreviewServerManager({
    workspaceStore,
  });

  return globalThis.__hjdesignPreviewServerManager;
}

async function readIndexHtmlOrEmptyPreview(workspaceDirectory: string) {
  const indexPath = path.join(workspaceDirectory, "index.html");

  try {
    await access(indexPath);
    return readFile(indexPath, "utf8");
  } catch {
    return buildEmptyPreviewHtml();
  }
}

function buildEmptyPreviewHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HJDesign Preview</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #f8fafc;
      color: #475569;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      max-width: 28rem;
      padding: 2rem;
      text-align: center;
    }
    h1 {
      margin: 0 0 .75rem;
      color: #0f172a;
      font-size: 1.25rem;
    }
    p {
      margin: 0;
      line-height: 1.7;
    }
  </style>
</head>
<body>
  <main>
    <h1>等待生成 HTML</h1>
    <p>在左侧输入“设计一个 XXX 的界面”，生成结果会显示在这里。</p>
  </main>
</body>
</html>`;
}
