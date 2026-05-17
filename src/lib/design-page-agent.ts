import { readFileSync } from "node:fs";
import path from "node:path";

import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  stepCountIs,
  ToolLoopAgent,
  type LanguageModel,
  type ToolLoopAgentSettings,
} from "ai";

import {
  createSettingsService,
  type DeepSeekThinkingMode,
  type ModelConfiguration,
} from "./settings-service";
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
  model: LanguageModel;
  outputType: ProjectOutputType;
  providerOptions?: ToolLoopAgentSettings["providerOptions"];
  projectId: string;
  workspaceStore: WorkspaceStore;
};

export class AiSdkDesignPageAgent implements DesignPageAgent {
  constructor(private readonly workspaceStore: WorkspaceStore) {}

  async generateProjectOutput(input: DesignPageAgentInput) {
    if (input.outputType !== "html") {
      throw new Error(`Unsupported Project Output Type: ${input.outputType}`);
    }

    const modelConfiguration =
      await createSettingsService().resolveModelConfiguration();
    const agent = createDesignPageAgent({
      model: buildLanguageModel(
        modelConfiguration,
      ),
      outputType: input.outputType,
      providerOptions: buildProviderOptions(modelConfiguration),
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
  model,
  outputType,
  providerOptions,
  projectId,
  workspaceStore,
}: CreateDesignPageAgentInput) {
  return new ToolLoopAgent({
    model,
    instructions: buildDesignPageAgentInstructions(outputType),
    providerOptions,
    stopWhen: stepCountIs(50),
    tools: createProjectWorkspaceTools({ projectId, workspaceStore }),
  });
}

export function buildLanguageModel(configuration: ModelConfiguration) {
  if (configuration.provider === "deepseek") {
    return createDeepSeek({
      apiKey: configuration.apiKey || undefined,
      baseURL: configuration.baseUrl || undefined,
    })(configuration.model);
  }

  return createOpenAICompatible({
    name: "openaiCompatible",
    apiKey: configuration.apiKey || undefined,
    baseURL: configuration.baseUrl,
  })(configuration.model);
}

export function buildProviderOptions(
  configuration: ModelConfiguration,
  thinkingModeOverride?: DeepSeekThinkingMode,
): ToolLoopAgentSettings["providerOptions"] {
  if (configuration.provider !== "deepseek") {
    return undefined;
  }

  const thinkingMode =
    thinkingModeOverride ??
    configuration.providerOptions?.deepseek?.thinkingMode ??
    "high";

  if (thinkingMode === "disabled") {
    return {
      deepseek: {
        thinking: { type: "disabled" },
      },
    };
  }

  return {
    deepseek: {
      thinking: { type: "enabled" },
      reasoningEffort: thinkingMode,
    },
  };
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
    "Project Output is a previewable UI prototype, not a production app implementation.",
    "Use inline JavaScript only for local UI state interactions; do not implement clipboard, network, storage, or real submit behavior.",
    "Use Project Workspace tools to inspect, create, edit, search, patch, and delete UTF-8 files.",
    "Inspect with `glob`, `grep`, and `read` before coordinated edits when existing files may matter.",
    "All previewable HTML files must stay inside the Project Workspace; use relative paths ending in `.html`.",
    "Choose the HTML target from the user's intent: edit `index.html` for home/main/landing page requests; create or edit a semantic `.html` file such as `login.html`, `settings.html`, or `pages/detail.html` for a new or named page.",
    "If no page is specified and no multi-page structure is evident, default to `index.html`; if multiple HTML files exist and the target is unclear, inspect first and ask a concise follow-up question if needed.",
    "When creating a new HTML page, do not overwrite `index.html` unless the user intent points to the home or main page.",
    "Prefer `edit` for existing files, `write` for new files or deliberate full overwrites, and `patch` for coordinated multi-file changes.",
    "Only add external CDNs through `addCdnResource`, and never by raw file edits. `addCdnResource` currently manages `index.html`; for other HTML pages, prefer inline or local fallbacks instead of adding unapproved CDN tags.",
    "`write`, `edit`, and `patch` reject unapproved external CDN tags in `index.html`; request CDN approval through `addCdnResource` first.",
    "When writing `index.html`, preserve any existing `data-hjdesign-approved-cdn=\"true\"` CDN tags.",
    "If the user denies a CDN approval request, do not retry the same CDN. Use a local or inline fallback, or explain the limitation.",
  ].join("\n");
}
