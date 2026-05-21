import path from "node:path";

import type { WorkspacePatchChange, WorkspaceStore } from "@/lib/workspace-store";

type CdnResourceInput = {
  crossorigin?: string;
  integrity?: string;
  resourceType: "script" | "style-import" | "stylesheet";
  url: string;
};

export async function writeProjectWorkspaceFileWithCdnGuard(
  workspaceStore: WorkspaceStore,
  projectId: string,
  relativePath: string,
  content: string,
  approvedCdnUrls: string[] = [],
) {
  const guardedContent = await guardIndexHtmlCdnChanges(
    workspaceStore,
    projectId,
    relativePath,
    content,
    approvedCdnUrls,
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
  approvedCdnUrls: string[] = [],
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

  const writeResult = await writeProjectWorkspaceFileWithCdnGuard(
    workspaceStore,
    projectId,
    relativePath,
    updatedContent,
    approvedCdnUrls,
  );

  return {
    diff: writeResult.diff,
    path: normalizeToolPath(relativePath),
    replacements: replaceAll
      ? countOccurrences(content, normalizeEditNeedle(content, oldString))
      : 1,
  };
}

export async function applyProjectWorkspacePatchWithCdnGuard(
  workspaceStore: WorkspaceStore,
  projectId: string,
  changes: WorkspacePatchChange[],
  approvedCdnUrls: string[] = [],
) {
  return workspaceStore.applyProjectWorkspacePatch(projectId, changes, {
    transformContent: async (relativePath, content) =>
      guardIndexHtmlCdnChanges(
        workspaceStore,
        projectId,
        relativePath,
        content,
        approvedCdnUrls,
      ),
  });
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

export function buildCdnTag(input: CdnResourceInput) {
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

  if (input.resourceType === "style-import") {
    return `<style${suffix}>\n@import url('${url}');\n</style>`;
  }

  return `<script src="${url}"${suffix}></script>`;
}

async function guardIndexHtmlCdnChanges(
  workspaceStore: WorkspaceStore,
  projectId: string,
  relativePath: string,
  content: string,
  approvedCdnUrls: string[],
) {
  if (!isHtmlPath(relativePath)) {
    return content;
  }

  const normalizedContent = normalizeConfiguredResourceCdnRefs(
    content,
    approvedCdnUrls,
  );
  const approvedUrls = new Set(
    approvedCdnUrls.map(normalizeHttpsUrl).filter(Boolean),
  );
  const unapprovedRefs = extractExternalCdnRefs(normalizedContent).filter(
    ({ url }) => !approvedUrls.has(url),
  );

  if (unapprovedRefs.length > 0) {
    throw new Error(
      `HTML files can only use CDN resources configured in settings: ${unapprovedRefs
        .map(({ url }) => url)
        .join(", ")}`,
    );
  }

  return normalizedContent;
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

function extractExternalCdnRefs(html: string) {
  return extractCdnTags(html).map(({ resourceType, url }) => ({
    resourceType,
    url,
  }));
}

function extractCdnTags(html: string) {
  const refs: Array<{
    rawUrl: string;
    resourceType: CdnResourceInput["resourceType"];
    tag: string;
    url: string;
  }> = [];

  for (const match of html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)) {
    const tag = match[0];
    const src = getHtmlAttribute(tag, "src");

    if (src && isHttpsUrl(src)) {
      refs.push({
        rawUrl: src,
        resourceType: "script",
        tag,
        url: normalizeUrl(src),
      });
    }
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const href = getHtmlAttribute(tag, "href");
    const rel = getHtmlAttribute(tag, "rel");

    if (href && isHttpsUrl(href) && rel?.toLowerCase().split(/\s+/).includes("stylesheet")) {
      refs.push({
        rawUrl: href,
        resourceType: "stylesheet",
        tag,
        url: normalizeUrl(href),
      });
    }
  }

  for (const match of html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)) {
    const tag = match[0];

    for (const importMatch of tag.matchAll(
      /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^"')\s;]+))\s*\)?/gi,
    )) {
      const url = importMatch[1] ?? importMatch[2] ?? importMatch[3];

      if (url && isHttpsUrl(url)) {
        refs.push({
          rawUrl: url,
          resourceType: "style-import",
          tag,
          url: normalizeUrl(url),
        });
      }
    }
  }

  return refs;
}

function normalizeConfiguredResourceCdnRefs(
  html: string,
  approvedCdnUrls: string[],
) {
  const approvedUrls = approvedCdnUrls
    .map(normalizeHttpsUrl)
    .filter((url): url is string => Boolean(url));
  const configuredFontCdn = approvedUrls.find(isGoogleFontsCss2Url);
  let updatedHtml = html;

  for (const ref of extractCdnTags(html)) {
    const replacementUrl = getConfiguredReplacementUrl(ref.url, {
      configuredFontCdn,
    });

    if (!replacementUrl || ref.url === replacementUrl) {
      continue;
    }

    if (
      ref.resourceType === "stylesheet" &&
      configuredFontCdn &&
      ref.url !== configuredFontCdn &&
      isGoogleFontsCss2Url(ref.url)
    ) {
      updatedHtml = updatedHtml.replace(
        ref.tag,
        buildCdnTag({ resourceType: "style-import", url: configuredFontCdn }),
      );
      continue;
    }

    updatedHtml = updatedHtml.split(ref.rawUrl).join(replacementUrl);
  }

  return updatedHtml;
}

function getConfiguredReplacementUrl(
  url: string,
  replacements: {
    configuredFontCdn?: string;
  },
) {
  if (replacements.configuredFontCdn && isGoogleFontsCss2Url(url)) {
    return replacements.configuredFontCdn;
  }

  return undefined;
}

function isGoogleFontsCss2Url(value: string) {
  try {
    const url = new URL(value);

    return url.hostname === "fonts.googleapis.com" && url.pathname === "/css2";
  } catch {
    return false;
  }
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

export function isHtmlPath(relativePath: string) {
  return normalizeToolPath(relativePath).toLowerCase().endsWith(".html");
}

export function normalizeToolPath(relativePath: string) {
  return path.posix.normalize(relativePath.replaceAll("\\", "/"));
}

function normalizeHttpsUrl(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
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
