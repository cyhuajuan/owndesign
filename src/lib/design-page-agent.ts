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
  type ResourceLibrary,
  type ResourceSettings,
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
  resources: ResourceSettings;
  workspaceStore: WorkspaceStore;
};

export class AiSdkDesignPageAgent implements DesignPageAgent {
  constructor(private readonly workspaceStore: WorkspaceStore) {}

  async generateProjectOutput(input: DesignPageAgentInput) {
    if (input.outputType !== "html") {
      throw new Error(`Unsupported Project Output Type: ${input.outputType}`);
    }

    const settingsService = createSettingsService();
    const [settings, modelConfiguration] = await Promise.all([
      settingsService.getSettings(),
      settingsService.resolveModelConfiguration(),
    ]);
    const agent = createDesignPageAgent({
      model: buildLanguageModel(
        modelConfiguration,
      ),
      outputType: input.outputType,
      providerOptions: buildProviderOptions(modelConfiguration),
      projectId: input.projectId,
      resources: settings.resources,
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
  resources,
  workspaceStore,
}: CreateDesignPageAgentInput) {
  return new ToolLoopAgent({
    model,
    instructions: buildDesignPageAgentInstructions(outputType, resources),
    providerOptions,
    stopWhen: stepCountIs(50),
    tools: createProjectWorkspaceTools({
      approvedCdnUrls: buildApprovedCdnUrls(resources),
      projectId,
      resources,
      workspaceStore,
    }),
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
  resources?: ResourceSettings,
) {
  return [
    loadDesignPageAgentCorePrompt(),
    resources ? buildResourcePolicyPrompt(resources) : "",
    buildProjectOutputPrompt(outputType),
  ]
    .filter(Boolean)
    .join("\n\n");
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
    "When the target HTML file does not exist, you must call `createHtml` first instead of using `write` to create the initial HTML.",
    "For `createHtml`, choose `path` from the user's page target. Pass `fontLibraryName` or `iconLibraryName` only when the user explicitly specifies those resource preferences; otherwise omit them so the tool reads configured defaults.",
    "After `createHtml` succeeds, use `edit` or `patch` to fill in the actual page design. For existing HTML files, use `read`, `edit`, and `patch`; do not call `createHtml`.",
    "When creating a new HTML page, do not overwrite `index.html` unless the user intent points to the home or main page.",
    "Prefer `edit` for existing files, `createHtml` for missing HTML files, `write` for non-HTML files or deliberate full overwrites, and `patch` for coordinated multi-file changes.",
    "Only use resource CDNs that already exist in settings. Do not add any other external CDN.",
    "`write`, `edit`, and `patch` reject HTML that contains external CDN tags outside the configured resource settings.",
  ].join("\n");
}

export function buildResourcePolicyPrompt(resources: ResourceSettings) {
  const defaultFontLibrary = getDefaultResourceLibrary(resources.fontLibraries);
  const defaultIconLibrary = getDefaultResourceLibrary(resources.iconLibraries);
  const fontLines = formatResourceLibraryList(resources.fontLibraries);
  const iconLines = formatResourceLibraryList(resources.iconLibraries);

  return [
    "## Resource Policy",
    "Use these global resource settings when designing HTML preview pages.",
    defaultFontLibrary
      ? `Default font library: ${defaultFontLibrary.name}.`
      : "Default font library: none configured.",
    defaultIconLibrary
      ? `Default icon library: ${defaultIconLibrary.name}.`
      : "Default icon library: none configured.",
    "If the user prompt explicitly names a configured font or icon library, use that named library; otherwise use the default library.",
    "Only use configured font libraries or system fonts. Do not reference any unconfigured external font service or font CDN.",
    "Only use configured icon libraries or inline SVG icons. Do not reference any unconfigured external icon service or icon CDN.",
    "When a configured library has no CDN, follow the library choice in CSS naming only and do not add a CDN tag for it.",
    "Configured font libraries:",
    fontLines.length ? fontLines.join("\n") : "- none",
    "Configured icon libraries:",
    iconLines.length ? iconLines.join("\n") : "- none",
    "Use regular inline CSS as the primary styling method.",
    "Do not add new CDN resources. If a needed resource is not configured, use system fonts, inline SVG, local CSS, or explain the limitation.",
  ].join("\n");
}

export function buildApprovedCdnUrls(resources: ResourceSettings) {
  return [
    ...resources.fontLibraries.map((library) => library.cdn),
    ...resources.iconLibraries.map((library) => library.cdn),
  ]
    .map((url) => url.trim())
    .filter(Boolean);
}

function getDefaultResourceLibrary(libraries: ResourceLibrary[]) {
  return libraries.find((library) => library.isDefault) ?? libraries[0];
}

function formatResourceLibraryList(libraries: ResourceLibrary[]) {
  return libraries.map(
    (library) =>
      `- ${library.name}${library.isDefault ? " (default)" : ""}${library.cdn ? " (configured CDN)" : " (no CDN)"}`,
  );
}
