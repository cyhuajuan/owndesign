import {
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWriteStream } from "node:fs";

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

    const [zipStats, zipBuffer] = await Promise.all([
      stat(zipPath),
      readFile(zipPath),
    ]);

    await rm(tempDirectory, { force: true, recursive: true });
    tempDirectory = undefined;

    return new Response(zipBuffer, {
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
  const fallbackFilename = createAsciiFilenameFallback(filename);
  const encodedFilename = encodeRFC5987Value(filename);

  return `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`;
}

function sanitizeDownloadFilename(value: string | undefined) {
  return value
    ?.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/[.\s]+$/g, "")
    .trim();
}

function createAsciiFilenameFallback(filename: string) {
  const extension = path.extname(filename);
  const basename = extension ? filename.slice(0, -extension.length) : filename;
  const safeBasename = basename
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "-")
    .replace(/["\\]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  const safeExtension = extension.replace(/[^\x20-\x7E]/g, "");
  const combined = `${safeBasename || "download"}${safeExtension}`;

  return combined || "download";
}

function encodeRFC5987Value(value: string) {
  return encodeURIComponent(value)
    .replace(/['()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
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
