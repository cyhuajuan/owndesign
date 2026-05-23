import type { ResourceLibrary } from "@/server/settings/settings-service";

import {
  buildCdnTag,
  isHtmlPath,
  normalizeToolPath,
  readProjectWorkspaceFileIfExists,
} from "./cdn-guard";
import type { WorkspaceToolDefinition } from "./core";
import type { CreateHtmlInput } from "./types";

const DEFAULT_TITLE = "OwnDesign Preview";

export function createCreateHtmlToolDefinition(): WorkspaceToolDefinition<
  CreateHtmlInput,
  {
    fontLibrary?: { cdn: string; name: string };
    iconLibrary?: { cdn: string; name: string };
    path: string;
    title: string;
  }
> {
  return {
    description:
      "Create a new previewable HTML file from the configured resource template before designing a missing target HTML page. Never overwrites existing files.",
    inputSchema: {
      type: "object",
      properties: {
        fontLibraryName: {
          type: "string",
          description:
            "Optional configured font library name. Omit to use the default font library. Pass an empty string to disable font resources.",
        },
        iconLibraryName: {
          type: "string",
          description:
            "Optional configured icon library name. Omit to use the default icon library. Pass an empty string to disable icon resources.",
        },
        path: {
          type: "string",
          description:
            "Relative HTML file path inside the Project Workspace, such as index.html or pages/detail.html.",
        },
        title: {
          type: "string",
          description: "Optional document title. Defaults to OwnDesign Preview.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    name: "createHtml",
    parallelSafe: false,
    execute: async (input, { projectId, resources, workspaceStore }) => {
      const targetPath = normalizeToolPath(input.path);

      if (!isHtmlPath(targetPath)) {
        throw new Error(`HTML initialization target must end with .html: ${targetPath}`);
      }

      const existingHtml = await readProjectWorkspaceFileIfExists(
        workspaceStore,
        projectId,
        targetPath,
      );

      if (existingHtml !== undefined) {
        throw new Error(`Project Workspace HTML file already exists: ${targetPath}`);
      }

      const fontLibrary = selectLibrary(
        resources.fontLibraries,
        input.fontLibraryName,
        "font",
      );
      const iconLibrary = selectLibrary(
        resources.iconLibraries,
        input.iconLibraryName,
        "icon",
      );
      const html = buildHtmlTemplate({
        fontLibrary,
        iconLibrary,
        title: input.title?.trim() || DEFAULT_TITLE,
      });

      await workspaceStore.writeProjectWorkspaceFile(projectId, targetPath, html);

      return {
        fontLibrary: formatSelectedLibrary(fontLibrary),
        iconLibrary: formatSelectedLibrary(iconLibrary),
        path: targetPath,
        title: input.title?.trim() || DEFAULT_TITLE,
      };
    },
  };
}

function selectLibrary(
  libraries: ResourceLibrary[],
  name: string | undefined,
  kind: "font" | "icon",
) {
  if (name === "") {
    return undefined;
  }

  if (name !== undefined) {
    const library = libraries.find((item) => item.name === name);

    if (!library) {
      throw new Error(`Configured ${kind} library was not found: ${name}`);
    }

    return library;
  }

  return libraries.find((library) => library.isDefault) ?? libraries[0];
}

function buildHtmlTemplate({
  fontLibrary,
  iconLibrary,
  title,
}: {
  fontLibrary?: ResourceLibrary;
  iconLibrary?: ResourceLibrary;
  title: string;
}) {
  const headTags = [
    fontLibrary?.cdn
      ? buildCdnTag({ resourceType: "style-import", url: fontLibrary.cdn })
      : "",
    iconLibrary?.cdn && inferIconLibraryResourceType(iconLibrary.cdn) === "stylesheet"
      ? buildCdnTag({ resourceType: "stylesheet", url: iconLibrary.cdn })
      : "",
  ].filter(Boolean);
  const bodyScripts = [
    iconLibrary?.cdn && inferIconLibraryResourceType(iconLibrary.cdn) === "script"
      ? buildCdnTag({ resourceType: "script", url: iconLibrary.cdn })
      : "",
    isLucideLibrary(iconLibrary) ? "  <script>window.lucide?.createIcons?.();</script>" : "",
  ].filter(Boolean);

  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${escapeHtmlText(title)}</title>`,
    ...headTags.map((tag) => indentMultiline(tag, "  ")),
    "</head>",
    "<body>",
    '  <main id="app"></main>',
    ...bodyScripts.map((tag) => indentMultiline(tag, "  ")),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function inferIconLibraryResourceType(cdn: string): "script" | "stylesheet" {
  const normalized = cdn.toLowerCase();

  return normalized.includes(".css") ||
    normalized.includes("/css/") ||
    normalized.includes("font-awesome")
    ? "stylesheet"
    : "script";
}

function isLucideLibrary(library: ResourceLibrary | undefined) {
  if (!library?.cdn) {
    return false;
  }

  const value = `${library.name} ${library.cdn}`.toLowerCase();

  return value.includes("lucide");
}

function formatSelectedLibrary(library: ResourceLibrary | undefined) {
  return library
    ? {
        cdn: library.cdn,
        name: library.name,
      }
    : undefined;
}

function indentMultiline(value: string, indent: string) {
  return value
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function escapeHtmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
