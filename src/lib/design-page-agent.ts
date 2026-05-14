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
  generateProjectOutput(input: DesignPageAgentInput): Promise<DesignPageAgentResult>;
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
    stopWhen: stepCountIs(12),
    tools: {
      deletePath: tool({
        description:
          "Recursively delete a file or directory from the current Project Workspace.",
        inputSchema: jsonSchema<WorkspacePathInput>({
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative file or directory path inside the Project Workspace.",
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
          workspaceStore.editProjectWorkspaceFile(
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
        description: "Read one UTF-8 text file from the current Project Workspace.",
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
          content: await workspaceStore.readProjectWorkspaceFile(projectId, path),
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
              description: "Plain substring to search for. Regex is not supported.",
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
          workspaceStore.writeProjectWorkspaceFile(projectId, path, content),
      }),
    },
  });
}

export function buildDesignPageAgentInstructions(outputType: ProjectOutputType) {
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
    "When the user expects a previewable page, write or update `index.html` in the Project Workspace.",
  ].join("\n");
}
