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
  outputPath?: string;
};

export type DesignPageAgent = {
  generateProjectOutput(input: DesignPageAgentInput): Promise<DesignPageAgentResult>;
};

type WriteHtmlInput = {
  html: string;
};

type CreateDesignPageAgentInput = {
  onWriteHtml?: (output: WriteHtmlOutput) => void;
  outputType: ProjectOutputType;
  projectId: string;
  workspaceStore: WorkspaceStore;
};

export type WriteHtmlOutput = {
  outputPath: string;
  outputType: "html";
};

export class AiSdkDesignPageAgent implements DesignPageAgent {
  constructor(private readonly workspaceStore: WorkspaceStore) {}

  async generateProjectOutput(input: DesignPageAgentInput) {
    if (input.outputType !== "html") {
      throw new Error(`Unsupported Project Output Type: ${input.outputType}`);
    }

    let outputPath: string | undefined;
    const agent = createDesignPageAgent({
      onWriteHtml: (output) => {
        outputPath = output.outputPath;
      },
      outputType: input.outputType,
      projectId: input.projectId,
      workspaceStore: this.workspaceStore,
    });

    const result = await agent.generate({
      prompt: input.content,
    });

    return {
      content: result.text || "已处理请求。",
      outputPath: outputPath ?? extractWriteHtmlOutputPath(result.steps),
    };
  }
}

export function createDesignPageAgent({
  onWriteHtml,
  outputType,
  projectId,
  workspaceStore,
}: CreateDesignPageAgentInput) {
  return new ToolLoopAgent({
    model: deepseek("deepseek-v4-flash"),
    instructions: buildDesignPageAgentInstructions(outputType),
    stopWhen: stepCountIs(4),
    tools: {
      writeHtmlFile: tool({
        description:
          "Write the full standalone HTML document to the current Project Workspace.",
        inputSchema: jsonSchema<WriteHtmlInput>({
          type: "object",
          properties: {
            html: {
              type: "string",
              description: "Complete HTML document, including doctype.",
            },
          },
          required: ["html"],
          additionalProperties: false,
        }),
        execute: async ({ html }): Promise<WriteHtmlOutput> => {
          const normalizedHtml = normalizeHtmlDocument(html);
          const outputPath = await workspaceStore.writeProjectOutput(
            projectId,
            "html",
            normalizedHtml,
          );
          const output = {
            outputPath,
            outputType: "html",
          } satisfies WriteHtmlOutput;

          onWriteHtml?.(output);

          return output;
        },
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
    "Write the generated page by calling writeHtmlFile with one complete standalone HTML document.",
  ].join("\n");
}

function normalizeHtmlDocument(html: string) {
  const trimmedHtml = html.trim();

  if (/^<!doctype html>/i.test(trimmedHtml)) {
    return trimmedHtml;
  }

  return `<!doctype html>\n${trimmedHtml}`;
}

function extractWriteHtmlOutputPath(steps: unknown) {
  if (!Array.isArray(steps)) {
    return undefined;
  }

  for (const step of steps) {
    if (
      typeof step !== "object" ||
      step === null ||
      !("content" in step) ||
      !Array.isArray(step.content)
    ) {
      continue;
    }

    for (const part of step.content) {
      if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "tool-result" &&
        "output" in part &&
        typeof part.output === "object" &&
        part.output !== null &&
        "outputPath" in part.output &&
        typeof part.output.outputPath === "string"
      ) {
        return part.output.outputPath;
      }
    }
  }

  return undefined;
}
