import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdtemp,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { ZipFile } from "yazl";

import { createWorkspaceStore } from "@/lib/hjdesign";

export const runtime = "nodejs";

type DownloadRouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(request: Request, context: DownloadRouteContext) {
  const { projectId } = await context.params;
  const workspaceStore = createWorkspaceStore();
  const searchParams = new URL(request.url).searchParams;
  const kind = searchParams.get("kind");

  if (kind === "current-html") {
    return downloadCurrentHtml(
      workspaceStore,
      projectId,
      searchParams.get("previewPath"),
    );
  }

  if (kind === "workspace-zip") {
    return downloadWorkspaceZip(workspaceStore, projectId);
  }

  return new Response("Invalid download request.", { status: 400 });
}

async function downloadCurrentHtml(
  workspaceStore: ReturnType<typeof createWorkspaceStore>,
  projectId: string,
  previewPath: string | null,
) {
  if (!previewPath?.trim() || !previewPath.toLowerCase().endsWith(".html")) {
    return new Response("Invalid download request.", { status: 400 });
  }

  try {
    const content = await workspaceStore.readProjectWorkspaceFileBuffer(
      projectId,
      previewPath,
    );

    return new Response(content, {
      headers: {
        "Content-Disposition": createAttachmentDisposition(
          path.basename(previewPath),
        ),
        "Content-Type": "text/html; charset=utf-8",
      },
      status: 200,
    });
  } catch (error) {
    return mapWorkspaceErrorToResponse(error);
  }
}

async function downloadWorkspaceZip(
  workspaceStore: ReturnType<typeof createWorkspaceStore>,
  projectId: string,
) {
  let tempDirectory: string | undefined;

  try {
    const project = await workspaceStore.getProject(projectId);
    tempDirectory = await mkdtemp(
      path.join(os.tmpdir(), "hjdesign-project-download-"),
    );
    const zipPath = path.join(tempDirectory, "workspace.zip");

    await writeWorkspaceZip(workspaceStore, projectId, zipPath);

    const zipStats = await stat(zipPath);
    const stream = createReadStream(zipPath);
    const cleanup = once(async () => {
      if (tempDirectory) {
        await rm(tempDirectory, { force: true, recursive: true });
      }
    });

    stream.on("close", () => {
      void cleanup();
    });
    stream.on("error", () => {
      void cleanup();
    });

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Disposition": createAttachmentDisposition(
          `${sanitizeDownloadFilename(project.name) || projectId}-workspace.zip`,
        ),
        "Content-Length": String(zipStats.size),
        "Content-Type": "application/zip",
      },
      status: 200,
    });
  } catch (error) {
    if (tempDirectory) {
      await rm(tempDirectory, { force: true, recursive: true }).catch(() => {});
    }

    return mapWorkspaceErrorToResponse(error);
  }
}

async function writeWorkspaceZip(
  workspaceStore: ReturnType<typeof createWorkspaceStore>,
  projectId: string,
  zipPath: string,
) {
  const zipFile = new ZipFile();
  const output = createWriteStream(zipPath);
  const entries = await workspaceStore.listProjectWorkspace(projectId);

  const done = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    zipFile.outputStream.on("error", reject);
  });

  zipFile.outputStream.pipe(output);

  for (const entry of entries) {
    if (entry.type !== "file") {
      continue;
    }

    const content = await workspaceStore.readProjectWorkspaceFileBuffer(
      projectId,
      entry.path,
    );
    zipFile.addBuffer(content, entry.path);
  }

  zipFile.end();
  await done;
}

function createAttachmentDisposition(filename: string) {
  return `attachment; filename="${filename.replace(/"/g, "")}"`;
}

function sanitizeDownloadFilename(value: string | undefined) {
  return value
    ?.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/[.\s]+$/g, "")
    .trim();
}

function mapWorkspaceErrorToResponse(error: unknown) {
  if (isMissingPathError(error)) {
    return new Response("Project file not found.", { status: 404 });
  }

  if (
    error instanceof Error &&
    (error.message.includes("must be relative") ||
      error.message.includes("escapes workspace") ||
      error.message.includes("symlinks are not supported") ||
      error.message.includes("is not a file"))
  ) {
    return new Response("Invalid download request.", { status: 400 });
  }

  throw error;
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function once<T extends unknown[]>(callback: (...args: T) => Promise<void>) {
  let called = false;

  return async (...args: T) => {
    if (called) {
      return;
    }

    called = true;
    await callback(...args);
  };
}
