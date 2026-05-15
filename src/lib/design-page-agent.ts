import { readFileSync } from "node:fs";
import path from "node:path";

import { deepseek } from "@ai-sdk/deepseek";
import { jsonSchema, stepCountIs, tool, ToolLoopAgent } from "ai";

import type { ProjectOutputType } from "./workspace-store";
import { WorkspaceStore } from "./workspace-store";

export type DesignPageAgentInput = {
  content: string;
  projectId: string;
  outputType: ProjectOutputType;
};

export type DesignPageAgentResult = {
  content: string;
};

export type DesignPageAgent = {
  generateProjectOutput(
    input: DesignPageAgentInput,
  ): Promise<DesignPageAgentResult>;
};

type CreateDesignPageAgentInput = {
  outputType: ProjectOutputType;
  projectId: string;
  workspaceStore: WorkspaceStore;
};

type WorkspacePathInput = {
  path: string;
};

type SearchFilesInput = {
  path?: string;
  query: string;
};

type WriteFileInput = {
  content: string;
  path: string;
};

type EditFileInput = {
  newText: string;
  oldText: string;
  path: string;
};

type AddCdnResourceInput = {
  crossorigin?: string;
  integrity?: string;
  resourceType: "script" | "stylesheet";
  url: string;
};

export class AiSdkDesignPageAgent implements DesignPageAgent {
  constructor(private readonly workspaceStore: WorkspaceStore) {}

  async generateProjectOutput(input: DesignPageAgentInput) {
    if (input.outputType !== "html") {
      throw new Error(`Unsupported Project Output Type: ${input.outputType}`);
    }

    const agent = createDesignPageAgent({
      outputType: input.outputType,
      projectId: input.projectId,
      workspaceStore: this.workspaceStore,
    });

    const result = await agent.generate({
      prompt: input.content,
    });

    return {
      content: result.text || "已处理请求。",
    };
  }
}

export function createDesignPageAgent({
  outputType,
  projectId,
  workspaceStore,
}: CreateDesignPageAgentInput) {
  return new ToolLoopAgent({
    model: deepseek("deepseek-v4-flash"),
    instructions: buildDesignPageAgentInstructions(outputType),
    stopWhen: stepCountIs(50),
    tools: {
      addCdnResource: tool({
        description:
          "Add an approved external HTTPS CDN script or stylesheet tag to index.html in the current Project Workspace.",
        needsApproval: true,
        inputSchema: jsonSchema<AddCdnResourceInput>({
          type: "object",
          properties: {
            crossorigin: {
              type: "string",
              description:
                "Optional crossorigin attribute for the CDN tag, such as anonymous.",
            },
            integrity: {
              type: "string",
              description: "Optional subresource integrity hash for the CDN tag.",
            },
            resourceType: {
              type: "string",
              enum: ["script", "stylesheet"],
              description:
                "Whether to add a stylesheet link in head or a script tag before body close.",
            },
            url: {
              type: "string",
              description: "HTTPS CDN URL to add to index.html.",
            },
          },
          required: ["url", "resourceType"],
          additionalProperties: false,
        }),
        execute: async (input) =>
          addCdnResourceToIndexHtml(workspaceStore, projectId, input),
      }),
      deletePath: tool({
        description:
          "Recursively delete a file or directory from the current Project Workspace.",
        inputSchema: jsonSchema<WorkspacePathInput>({
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Relative file or directory path inside the Project Workspace.",
            },
          },
          required: ["path"],
          additionalProperties: false,
        }),
        execute: async ({ path }) =>
          workspaceStore.deleteProjectWorkspacePath(projectId, path),
      }),
      editFile: tool({
        description:
          "Edit one UTF-8 text file by replacing exactly one occurrence of oldText with newText.",
        inputSchema: jsonSchema<EditFileInput>({
          type: "object",
          properties: {
            newText: {
              type: "string",
              description: "Replacement text.",
            },
            oldText: {
              type: "string",
              description:
                "Exact text to replace. It must occur exactly once in the file.",
            },
            path: {
              type: "string",
              description: "Relative file path inside the Project Workspace.",
            },
          },
          required: ["path", "oldText", "newText"],
          additionalProperties: false,
        }),
        execute: async ({ newText, oldText, path }) =>
          editProjectWorkspaceFileWithCdnGuard(
            workspaceStore,
            projectId,
            path,
            oldText,
            newText,
          ),
      }),
      listFiles: tool({
        description:
          "Recursively list files and directories in the current Project Workspace.",
        inputSchema: jsonSchema<Record<string, never>>({
          type: "object",
          properties: {},
          additionalProperties: false,
        }),
        execute: async () => ({
          entries: await workspaceStore.listProjectWorkspace(projectId),
        }),
      }),
      readFile: tool({
        description:
          "Read one UTF-8 text file from the current Project Workspace.",
        inputSchema: jsonSchema<WorkspacePathInput>({
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative file path inside the Project Workspace.",
            },
          },
          required: ["path"],
          additionalProperties: false,
        }),
        execute: async ({ path }) => ({
          content: await workspaceStore.readProjectWorkspaceFile(
            projectId,
            path,
          ),
          path,
        }),
      }),
      searchFiles: tool({
        description:
          "Search UTF-8 text files in the current Project Workspace by plain substring.",
        inputSchema: jsonSchema<SearchFilesInput>({
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Optional relative file or directory path to limit the search.",
            },
            query: {
              type: "string",
              description:
                "Plain substring to search for. Regex is not supported.",
            },
          },
          required: ["query"],
          additionalProperties: false,
        }),
        execute: async ({ path, query }) => ({
          matches: await workspaceStore.searchProjectWorkspace(
            projectId,
            query,
            path,
          ),
        }),
      }),
      writeFile: tool({
        description:
          "Create or overwrite one UTF-8 text file in the current Project Workspace.",
        inputSchema: jsonSchema<WriteFileInput>({
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "Complete UTF-8 text file content.",
            },
            path: {
              type: "string",
              description: "Relative file path inside the Project Workspace.",
            },
          },
          required: ["path", "content"],
          additionalProperties: false,
        }),
        execute: async ({ content, path }) =>
          writeProjectWorkspaceFileWithCdnGuard(
            workspaceStore,
            projectId,
            path,
            content,
          ),
      }),
    },
  });
}

export function buildDesignPageAgentInstructions(
  outputType: ProjectOutputType,
) {
  return [
    loadDesignPageAgentCorePrompt(),
    buildProjectOutputPrompt(outputType),
  ].join("\n\n");
}

export function loadDesignPageAgentCorePrompt() {
  return readFileSync(
    path.join(process.cwd(), "src", "lib", "agents", "design-page.agent.md"),
    "utf8",
  ).trim();
}

export function buildProjectOutputPrompt(outputType: ProjectOutputType) {
  if (outputType !== "html") {
    throw new Error(`Unsupported Project Output Type: ${outputType}`);
  }

  return [
    "## Project Output",
    "Project Output Type: html.",
    "Use the Project Workspace file tools to inspect, create, edit, search, and delete UTF-8 files.",
    "Only add external CDNs through `addCdnResource`, and never by raw file edits.",
    "`writeFile` and `editFile` reject unapproved external CDN tags in `index.html`; request CDN approval through `addCdnResource` first.",
    "When writing `index.html`, preserve any existing `data-hjdesign-approved-cdn=\"true\"` CDN tags.",
    "If the user denies a CDN approval request, do not retry the same CDN. Use a local or inline fallback, or explain the limitation.",
    "When the user expects a previewable page, write or update `index.html` in the Project Workspace.",
  ].join("\n");
}

async function addCdnResourceToIndexHtml(
  workspaceStore: WorkspaceStore,
  projectId: string,
  input: AddCdnResourceInput,
) {
  const url = parseHttpsCdnUrl(input.url);
  const existingHtml = await readProjectWorkspaceFileIfExists(
    workspaceStore,
    projectId,
    "index.html",
  );
  const createdIndexHtml = existingHtml === undefined;
  const html = existingHtml ?? buildEmptyIndexHtml();

  if (html.includes(input.url) || html.includes(url.href)) {
    return {
      added: false,
      createdIndexHtml: false,
      path: "index.html",
      reason: "already-exists",
      url: url.href,
    };
  }

  const tag = buildCdnTag({ ...input, url: url.href });
  const updatedHtml =
    input.resourceType === "stylesheet"
      ? insertBeforeClosingTag(html, "</head>", tag, "prepend")
      : insertBeforeClosingTag(html, "</body>", tag, "append");

  await workspaceStore.writeProjectWorkspaceFile(
    projectId,
    "index.html",
    updatedHtml,
  );

  return {
    added: true,
    createdIndexHtml,
    path: "index.html",
    resourceType: input.resourceType,
    url: url.href,
  };
}

function parseHttpsCdnUrl(rawUrl: string) {
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

function buildCdnTag(input: AddCdnResourceInput) {
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

async function writeProjectWorkspaceFileWithCdnGuard(
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

async function editProjectWorkspaceFileWithCdnGuard(
  workspaceStore: WorkspaceStore,
  projectId: string,
  relativePath: string,
  oldText: string,
  newText: string,
) {
  if (!isIndexHtmlPath(relativePath)) {
    return workspaceStore.editProjectWorkspaceFile(
      projectId,
      relativePath,
      oldText,
      newText,
    );
  }

  if (!oldText) {
    throw new Error("oldText must not be empty.");
  }

  const content = await workspaceStore.readProjectWorkspaceFile(
    projectId,
    relativePath,
  );
  const firstIndex = content.indexOf(oldText);

  if (firstIndex === -1) {
    throw new Error(`oldText was not found in Project Workspace file: ${relativePath}`);
  }

  if (content.indexOf(oldText, firstIndex + oldText.length) !== -1) {
    throw new Error(
      `oldText appears more than once in Project Workspace file: ${relativePath}`,
    );
  }

  const updatedContent =
    content.slice(0, firstIndex) + newText + content.slice(firstIndex + oldText.length);

  await writeProjectWorkspaceFileWithCdnGuard(
    workspaceStore,
    projectId,
    relativePath,
    updatedContent,
  );

  return {
    path: normalizeToolPath(relativePath),
    replacements: 1,
  };
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

async function readProjectWorkspaceFileIfExists(
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

function buildEmptyIndexHtml() {
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

function insertBeforeClosingTag(
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

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
