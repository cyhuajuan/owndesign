import { deepseek } from "@ai-sdk/deepseek";
import { generateText, jsonSchema, stepCountIs, tool, ToolLoopAgent } from "ai";

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

export class AiSdkDesignPageAgent implements DesignPageAgent {
  constructor(private readonly workspaceStore: WorkspaceStore) {}

  async generateProjectOutput(input: DesignPageAgentInput) {
    if (input.outputType !== "html") {
      throw new Error(`Unsupported Project Output Type: ${input.outputType}`);
    }

    let outputPath: string | undefined;
    const agent = new ToolLoopAgent({
      model: deepseek("deepseek-v4-flash"),
      instructions: [
        "You are HJDesign's design page agent.",
      "Create one complete, production-quality HTML document for the user's requested interface.",
      "Return valid standalone HTML with inline CSS and minimal inline JavaScript only when needed.",
      "Do not use external CDNs, remote images, or markdown fences.",
      "The page must render well inside an iframe preview.",
      "Prefer calling writeHtmlFile with the full HTML document.",
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
          execute: async ({ html }) => {
            const normalizedHtml = normalizeHtmlDocument(html);
            outputPath = await this.workspaceStore.writeProjectOutput(
              input.projectId,
              "html",
              normalizedHtml,
            );

            return {
              outputPath,
              outputType: "html",
            };
          },
        }),
      },
    });

    const result = await agent.generate({
      prompt: [
        `Project: ${input.projectName}`,
        `Conversation ID: ${input.conversationId}`,
        `User request: ${input.content}`,
      ].join("\n"),
    });
    const fallbackHtml = extractHtmlDocument(result.text);

    if (!outputPath && fallbackHtml) {
      outputPath = await this.workspaceStore.writeProjectOutput(
        input.projectId,
        "html",
        normalizeHtmlDocument(fallbackHtml),
      );
    }

    return {
      content: result.text || "已生成 HTML 页面，并写入当前项目预览。",
      outputPath,
    };
  }
}

export class TextOnlyDesignPageAgent implements DesignPageAgent {
  constructor(private readonly workspaceStore: WorkspaceStore) {}

  async generateProjectOutput(input: DesignPageAgentInput) {
    if (input.outputType !== "html") {
      throw new Error(`Unsupported Project Output Type: ${input.outputType}`);
    }

    const result = await generateText({
      model: deepseek("deepseek-v4-flash"),
      system: [
        "You are HJDesign's design page agent.",
        "Create one complete, production-quality HTML document for the user's requested interface.",
        "Return only valid standalone HTML with inline CSS and minimal inline JavaScript only when needed.",
        "Do not use external CDNs, remote images, markdown fences, or explanations.",
        "The page must render well inside an iframe preview.",
      ].join("\n"),
      prompt: [
        `Project: ${input.projectName}`,
        `Conversation ID: ${input.conversationId}`,
        `User request: ${input.content}`,
      ].join("\n"),
    });
    const html = extractHtmlDocument(result.text) ?? result.text;
    const outputPath = await this.workspaceStore.writeProjectOutput(
      input.projectId,
      "html",
      normalizeHtmlDocument(html),
    );

    return {
      content: "已生成 HTML 页面，并写入当前项目预览。",
      outputPath,
    };
  }
}

function normalizeHtmlDocument(html: string) {
  const trimmedHtml = html.trim();

  if (/^<!doctype html>/i.test(trimmedHtml)) {
    return trimmedHtml;
  }

  return `<!doctype html>\n${trimmedHtml}`;
}

function extractHtmlDocument(text: string) {
  const withoutFence = text
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const doctypeIndex = withoutFence.toLowerCase().indexOf("<!doctype html>");
  const htmlIndex = withoutFence.toLowerCase().indexOf("<html");
  const startIndex = doctypeIndex >= 0 ? doctypeIndex : htmlIndex;

  if (startIndex < 0) {
    return undefined;
  }

  return withoutFence.slice(startIndex).trim();
}
