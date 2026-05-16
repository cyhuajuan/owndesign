import { readFileSync } from "node:fs";
import path from "node:path";

import { deepseek } from "@ai-sdk/deepseek";
import { stepCountIs, ToolLoopAgent } from "ai";

import type { ProjectOutputType } from "./workspace-store";
import { WorkspaceStore } from "./workspace-store";
import { createProjectWorkspaceTools } from "./agent-tools/project-workspace-tools";

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
    tools: createProjectWorkspaceTools({ projectId, workspaceStore }),
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
    "Use Project Workspace tools to inspect, create, edit, search, patch, and delete UTF-8 files.",
    "Inspect with `glob`, `grep`, and `read` before coordinated edits when existing files may matter.",
    "Prefer `edit` for existing files, `write` for new files or deliberate full overwrites, and `patch` for coordinated multi-file changes.",
    "Only add external CDNs through `addCdnResource`, and never by raw file edits.",
    "`write`, `edit`, and `patch` reject unapproved external CDN tags in `index.html`; request CDN approval through `addCdnResource` first.",
    "When writing `index.html`, preserve any existing `data-hjdesign-approved-cdn=\"true\"` CDN tags.",
    "If the user denies a CDN approval request, do not retry the same CDN. Use a local or inline fallback, or explain the limitation.",
    "When the user expects a previewable page, write or update `index.html` in the Project Workspace.",
  ].join("\n");
}
