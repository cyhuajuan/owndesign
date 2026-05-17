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
  baseUrl: string;
  leases: Map<string, number>;
  projectId: string;
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

  async ensure(projectId: string, clientId: string, previewPath?: string) {
    const entry = await this.getOrStartEntry(projectId);
    const files = await this.workspaceStore.listProjectHtmlFiles(projectId);
    const activePath = resolveActivePreviewPath(files, previewPath);

    this.touchLease(entry, clientId);
    this.ensureCleanupTimer();

    return {
      activePath,
      files,
      url: buildPreviewUrl(entry.baseUrl, activePath),
    };
  }

  async heartbeat(projectId: string, clientId: string, previewPath?: string) {
    return this.ensure(projectId, clientId, previewPath);
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
      baseUrl: address.replace(/\/$/, ""),
      leases: new Map(),
      projectId,
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
    :root {
      color-scheme: dark;
      --bg-base: #0a0a0b;
      --bg-surface: #141416;
      --bg-elevated: #1c1c1f;
      --border-color: #2a2a2e;
      --border-light: #38383d;
      --text-primary: #f0f0f2;
      --text-secondary: #a0a0ab;
      --text-tertiary: #6b6b76;
      --shadow-lg: 0 18px 48px rgba(0, 0, 0, 0.45);
    }
    * {
      box-sizing: border-box;
    }
    html {
      height: 100%;
      background: var(--bg-base);
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background:
        radial-gradient(circle at top, rgba(255,255,255,0.04), transparent 34%),
        var(--bg-base);
      color: var(--text-primary);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", sans-serif;
    }
    main {
      width: min(100%, 28rem);
      padding: 2rem;
      border: 1px solid var(--border-color);
      border-radius: 24px;
      background: var(--bg-surface);
      text-align: center;
      box-shadow: var(--shadow-lg);
    }
    .icon {
      width: 56px;
      height: 56px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 18px;
      border: 1px solid var(--border-light);
      background: var(--bg-elevated);
      color: var(--text-secondary);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
    }
    .badge {
      margin-top: 20px;
      color: var(--text-tertiary);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.24em;
      text-transform: uppercase;
    }
    h1 {
      margin: 8px 0 0;
      color: var(--text-primary);
      font-size: 1.125rem;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    p {
      margin: 10px auto 0;
      max-width: 22rem;
      color: var(--text-secondary);
      font-size: 14px;
      line-height: 1.7;
    }
  </style>
</head>
<body>
  <main>
    <div class="icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
      </svg>
    </div>
    <div class="badge">Preview</div>
    <h1>等待生成 HTML</h1>
    <p>在左侧输入“设计一个 XXX 的界面”，生成结果会显示在这里。</p>
  </main>
</body>
</html>`;
}

function resolveActivePreviewPath(files: string[], previewPath?: string) {
  if (previewPath && files.includes(previewPath)) {
    return previewPath;
  }

  if (files.includes("index.html")) {
    return "index.html";
  }

  return files[0] ?? "index.html";
}

function buildPreviewUrl(baseUrl: string, previewPath: string) {
  return `${baseUrl}/${previewPath.split("/").map(encodeURIComponent).join("/")}`;
}
