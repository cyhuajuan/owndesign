import { deepseek } from "@ai-sdk/deepseek";
import { jsonSchema, stepCountIs, tool, ToolLoopAgent } from "ai";

import type { ProjectOutputType } from "./workspace-store";
import { WorkspaceStore } from "./workspace-store";

export type DesignPageAgentInput = {
  content: string;
  conversationId: string;
  projectId: string;
  projectName: string;
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
  conversationId: string;
  onWriteHtml?: (output: WriteHtmlOutput) => void;
  projectId: string;
  projectName: string;
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
      conversationId: input.conversationId,
      onWriteHtml: (output) => {
        outputPath = output.outputPath;
      },
      projectId: input.projectId,
      projectName: input.projectName,
      workspaceStore: this.workspaceStore,
    });

    const result = await agent.generate({
      prompt: [
        `Project: ${input.projectName}`,
        `Conversation ID: ${input.conversationId}`,
        `User request: ${input.content}`,
      ].join("\n"),
    });

    return {
      content: result.text || "已处理请求。",
      outputPath: outputPath ?? extractWriteHtmlOutputPath(result.steps),
    };
  }
}

export function createDesignPageAgent({
  conversationId,
  onWriteHtml,
  projectId,
  projectName,
  workspaceStore,
}: CreateDesignPageAgentInput) {
  return new ToolLoopAgent({
    model: deepseek("deepseek-v4-flash"),
    instructions: [
      "You are HJDesign's design page agent.",
      `Project: ${projectName}`,
      `Project ID: ${projectId}`,
      `Conversation ID: ${conversationId}`,
      "First version Project Output Type is html only.",
      "If the user's request is specific enough, create one complete, production-quality standalone HTML document and call writeHtmlFile with the full document.",
      "If key design details are missing, respond with a normal assistant message that asks concise follow-up questions instead of calling writeHtmlFile.",
      "The HTML must include inline CSS, use minimal inline JavaScript only when needed, and render well inside an iframe preview.",
      "Do not use external CDNs, remote images, markdown fences, or explanatory wrapper text around the HTML.",
      "Design real product UI with responsive layout, polished visual hierarchy, useful states, and domain-appropriate components.",
    ].join("\n"),
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
