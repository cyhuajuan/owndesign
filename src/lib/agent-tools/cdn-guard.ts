import path from "node:path";

import type { WorkspaceStore } from "@/lib/workspace-store";

import type { AddCdnResourceInput } from "./types";

export async function writeProjectWorkspaceFileWithCdnGuard(
  workspaceStore: WorkspaceStore,
  projectId: string,
  relativePath: string,
  content: string,
) {
  const guardedContent = await guardIndexHtmlCdnChanges(
    workspaceStore,
    projectId,
    relativePath,
    content,
  );

  return workspaceStore.writeProjectWorkspaceFile(
    projectId,
    relativePath,
    guardedContent,
  );
}

export async function editProjectWorkspaceFileWithCdnGuard(
  workspaceStore: WorkspaceStore,
  projectId: string,
  relativePath: string,
  oldString: string,
  newString: string,
  replaceAll = false,
) {
  const content = await workspaceStore.readProjectWorkspaceFile(
    projectId,
    relativePath,
  );
  const updatedContent = replaceInContent(
    content,
    oldString,
    newString,
    replaceAll,
    relativePath,
  );

  await writeProjectWorkspaceFileWithCdnGuard(
    workspaceStore,
    projectId,
    relativePath,
    updatedContent,
  );

  return {
    path: normalizeToolPath(relativePath),
    replacements: replaceAll
      ? countOccurrences(content, normalizeEditNeedle(content, oldString))
      : 1,
  };
}

export async function readProjectWorkspaceFileIfExists(
  workspaceStore: WorkspaceStore,
  projectId: string,
  relativePath: string,
) {
  try {
    return await workspaceStore.readProjectWorkspaceFile(projectId, relativePath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }

    throw error;
  }
}

export function buildCdnTag(input: AddCdnResourceInput) {
  const attributes = [
    'data-hjdesign-approved-cdn="true"',
    input.integrity ? `integrity="${escapeHtmlAttribute(input.integrity)}"` : "",
    input.crossorigin
      ? `crossorigin="${escapeHtmlAttribute(input.crossorigin)}"`
      : "",
  ].filter(Boolean);
  const suffix = attributes.length ? ` ${attributes.join(" ")}` : "";
  const url = escapeHtmlAttribute(input.url);

  if (input.resourceType === "stylesheet") {
    return `<link rel="stylesheet" href="${url}"${suffix}>`;
  }

  return `<script src="${url}"${suffix}></script>`;
}

export function buildEmptyIndexHtml() {
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    "  <title>HJDesign Preview</title>",
    "</head>",
    "<body>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

export function insertBeforeClosingTag(
  html: string,
  closingTag: string,
  tag: string,
  fallback: "append" | "prepend",
) {
  const index = html.toLowerCase().lastIndexOf(closingTag);
  const insertion = `  ${tag}\n`;

  if (index === -1) {
    return fallback === "prepend"
      ? `${insertion}${html}`
      : `${html}${html.endsWith("\n") ? "" : "\n"}${tag}\n`;
  }

  return `${html.slice(0, index)}${insertion}${html.slice(index)}`;
}

export function parseHttpsCdnUrl(rawUrl: string) {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`CDN URL must be a valid HTTPS URL: ${rawUrl}`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`CDN URL must use HTTPS: ${rawUrl}`);
  }

  return url;
}

async function guardIndexHtmlCdnChanges(
  workspaceStore: WorkspaceStore,
  projectId: string,
  relativePath: string,
  content: string,
) {
  if (!isIndexHtmlPath(relativePath)) {
    return content;
  }

  const existingHtml =
    (await readProjectWorkspaceFileIfExists(
      workspaceStore,
      projectId,
      relativePath,
    )) ?? "";
  const approvedCdnTags = extractApprovedCdnTags(existingHtml);
  const approvedUrls = new Set(approvedCdnTags.map(({ url }) => url));
  const unapprovedRefs = extractExternalCdnRefs(content).filter(
    ({ url }) => !approvedUrls.has(url),
  );

  if (unapprovedRefs.length > 0) {
    throw new Error(
      `External CDN resources in index.html must be approved with addCdnResource first: ${unapprovedRefs
        .map(({ url }) => url)
        .join(", ")}`,
    );
  }

  return mergeMissingApprovedCdnTags(content, approvedCdnTags);
}

function replaceInContent(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
  relativePath: string,
) {
  if (!oldString) {
    throw new Error("oldString must not be empty.");
  }

  if (oldString === newString) {
    throw new Error("No changes to apply: oldString and newString are identical.");
  }

  const needle = normalizeEditNeedle(content, oldString);
  const replacement = convertToLineEnding(newString, detectLineEnding(content));
  const firstIndex = content.indexOf(needle);

  if (firstIndex === -1) {
    throw new Error(`oldString was not found in Project Workspace file: ${relativePath}`);
  }

  if (replaceAll) {
    return content.split(needle).join(replacement);
  }

  if (content.indexOf(needle, firstIndex + needle.length) !== -1) {
    throw new Error(
      `oldString appears more than once in Project Workspace file: ${relativePath}`,
    );
  }

  return (
    content.slice(0, firstIndex) +
    replacement +
    content.slice(firstIndex + needle.length)
  );
}

function normalizeEditNeedle(content: string, oldString: string) {
  return convertToLineEnding(oldString, detectLineEnding(content));
}

function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function convertToLineEnding(text: string, ending: "\n" | "\r\n") {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

  return ending === "\n" ? normalized : normalized.replaceAll("\n", "\r\n");
}

function countOccurrences(content: string, needle: string) {
  if (!needle) {
    return 0;
  }

  return content.split(needle).length - 1;
}

function extractApprovedCdnTags(html: string) {
  return extractCdnTags(html).filter(({ tag }) =>
    /data-hjdesign-approved-cdn\s*=\s*["']?true["']?/i.test(tag),
  );
}

function extractExternalCdnRefs(html: string) {
  return extractCdnTags(html).map(({ resourceType, url }) => ({
    resourceType,
    url,
  }));
}

function extractCdnTags(html: string) {
  const refs: Array<{
    resourceType: AddCdnResourceInput["resourceType"];
    tag: string;
    url: string;
  }> = [];

  for (const match of html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)) {
    const tag = match[0];
    const src = getHtmlAttribute(tag, "src");

    if (src && isHttpsUrl(src)) {
      refs.push({ resourceType: "script", tag, url: normalizeUrl(src) });
    }
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const href = getHtmlAttribute(tag, "href");
    const rel = getHtmlAttribute(tag, "rel");

    if (href && isHttpsUrl(href) && rel?.toLowerCase().split(/\s+/).includes("stylesheet")) {
      refs.push({ resourceType: "stylesheet", tag, url: normalizeUrl(href) });
    }
  }

  return refs;
}

function mergeMissingApprovedCdnTags(
  html: string,
  approvedCdnTags: Array<{
    resourceType: AddCdnResourceInput["resourceType"];
    tag: string;
    url: string;
  }>,
) {
  let updatedHtml = html;

  for (const approvedCdnTag of approvedCdnTags) {
    const existingTag = extractCdnTags(updatedHtml).find(
      ({ url }) => url === approvedCdnTag.url,
    );

    if (existingTag?.tag.includes('data-hjdesign-approved-cdn="true"')) {
      continue;
    }

    if (existingTag) {
      updatedHtml = updatedHtml.replace(existingTag.tag, approvedCdnTag.tag);
      continue;
    }

    updatedHtml = approvedCdnTag.resourceType === "stylesheet"
      ? insertBeforeClosingTag(
          updatedHtml,
          "</head>",
          approvedCdnTag.tag,
          "prepend",
        )
      : insertBeforeClosingTag(
          updatedHtml,
          "</body>",
          approvedCdnTag.tag,
          "append",
        );
  }

  return updatedHtml;
}

function getHtmlAttribute(tag: string, name: string) {
  const pattern = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const match = tag.match(pattern);

  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeUrl(value: string) {
  return new URL(value).href;
}

function isIndexHtmlPath(relativePath: string) {
  return normalizeToolPath(relativePath) === "index.html";
}

function normalizeToolPath(relativePath: string) {
  return path.posix.normalize(relativePath.replaceAll("\\", "/"));
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
