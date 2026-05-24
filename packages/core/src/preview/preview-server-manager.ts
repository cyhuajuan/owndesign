import { access, readFile } from "node:fs/promises";
import path from "node:path";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import { WorkspaceStore } from "@owndesign/core/workspace-store";

type PreviewServerManagerOptions = {
  cleanupIntervalMs?: number;
  leaseTtlMs?: number;
  now?: () => number;
  workspaceStore: WorkspaceStore;
};

type PreviewServerEntry = {
  activePath: string;
  app: FastifyInstance;
  baseUrl: string;
  expiresAt: number;
  key: string;
  projectId: string;
};

const DEFAULT_CLEANUP_INTERVAL_MS = 30_000;
const DEFAULT_LEASE_TTL_MS = 90_000;
const PREVIEW_HOST = "127.0.0.1";

declare global {
  var __owndesignPreviewServerManager: PreviewServerManager | undefined;
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
    const entry = await this.getOrStartEntry(projectId, clientId);
    const files = await this.workspaceStore.listProjectHtmlFiles(projectId);
    const activePath = resolveActivePreviewPath(
      files,
      previewPath ?? entry.activePath,
    );

    entry.activePath = activePath;
    this.touchLease(entry);
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
    const entry = this.entries.get(buildEntryKey(projectId, clientId));

    if (!entry) {
      return;
    }

    await this.closeEntry(entry);
  }

  async stop(projectId: string) {
    await Promise.all(
      Array.from(this.starts, async ([key, starting]) => {
        if (key.startsWith(`${projectId}:`)) {
          await starting;
        }
      }),
    );
    await Promise.all(
      Array.from(this.entries.values())
        .filter((entry) => entry.projectId === projectId)
        .map((entry) => this.closeEntry(entry)),
    );
  }

  async stopAll() {
    await Promise.all(Array.from(this.starts.values()));
    await Promise.all(Array.from(this.entries.values(), (entry) => this.closeEntry(entry)));
  }

  getActiveServerCount() {
    return this.entries.size;
  }

  getLeaseCount(projectId: string) {
    return Array.from(this.entries.values()).filter(
      (entry) => entry.projectId === projectId,
    ).length;
  }

  async cleanupExpiredLeases() {
    const now = this.now();

    await Promise.all(
      Array.from(this.entries.values(), async (entry) => {
        if (entry.expiresAt <= now) {
          await this.closeEntry(entry);
        }
      }),
    );
  }

  private async getOrStartEntry(projectId: string, clientId: string) {
    const key = buildEntryKey(projectId, clientId);
    const existingEntry = this.entries.get(key);

    if (existingEntry) {
      return existingEntry;
    }

    const existingStart = this.starts.get(key);

    if (existingStart) {
      return existingStart;
    }

    const start = this.startEntry(projectId, key);
    this.starts.set(key, start);

    try {
      return await start;
    } finally {
      this.starts.delete(key);
    }
  }

  private async startEntry(
    projectId: string,
    key: string,
  ): Promise<PreviewServerEntry> {
    await this.workspaceStore.getProject(projectId);

    const workspaceDirectory =
      this.workspaceStore.getProjectWorkspaceDirectory(projectId);
    const app = Fastify({ logger: false });
    const entry: PreviewServerEntry = {
      activePath: "index.html",
      app,
      baseUrl: "",
      expiresAt: this.now() + this.leaseTtlMs,
      key,
      projectId,
    };

    app.get("/", async (_request, reply) =>
      reply.type("text/html; charset=utf-8").send(
        await readIndexHtmlOrEmptyPreview(workspaceDirectory, entry),
      ),
    );
    app.get("/index.html", async (_request, reply) =>
      reply.type("text/html; charset=utf-8").send(
        await readIndexHtmlOrEmptyPreview(workspaceDirectory, entry),
      ),
    );
    await app.register(fastifyStatic, {
      decorateReply: false,
      root: workspaceDirectory,
      setHeaders: (_response, filePath) => {
        recordServedHtmlPath(entry, workspaceDirectory, filePath);
      },
    });

    const address = await app.listen({ host: PREVIEW_HOST, port: 0 });
    entry.baseUrl = address.replace(/\/$/, "");

    this.entries.set(key, entry);

    return entry;
  }

  private touchLease(entry: PreviewServerEntry) {
    entry.expiresAt = this.now() + this.leaseTtlMs;
  }

  private async closeEntry(entry: PreviewServerEntry) {
    this.entries.delete(entry.key);
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
  globalThis.__owndesignPreviewServerManager ??= new PreviewServerManager({
    workspaceStore,
  });

  return globalThis.__owndesignPreviewServerManager;
}

async function readIndexHtmlOrEmptyPreview(
  workspaceDirectory: string,
  entry: PreviewServerEntry,
) {
  const indexPath = path.join(workspaceDirectory, "index.html");

  try {
    await access(indexPath);
    entry.activePath = "index.html";
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
  <title>OwnDesign Preview</title>
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

function buildEntryKey(projectId: string, clientId: string) {
  return `${projectId}:${clientId}`;
}

function recordServedHtmlPath(
  entry: PreviewServerEntry,
  workspaceDirectory: string,
  filePath: string,
) {
  if (!filePath.toLowerCase().endsWith(".html")) {
    return;
  }

  const relativePath = path
    .relative(workspaceDirectory, filePath)
    .split(path.sep)
    .join("/");

  if (!relativePath || relativePath.startsWith("..")) {
    return;
  }

  entry.activePath = relativePath;
}
