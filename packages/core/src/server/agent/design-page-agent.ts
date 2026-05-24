import { readFileSync } from "node:fs";
import path from "node:path";

import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3 } from "@ai-sdk/provider";
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
} from "@owndesign/core/server/settings/settings-service";
import type { ProjectOutputType } from "@owndesign/core/server/workspace-store";
import { WorkspaceStore } from "@owndesign/core/server/workspace-store";
import { createProjectWorkspaceTools } from "@owndesign/core/server/agent/tools/project-workspace-tools";
import { buildFrontendCapabilityPrompt } from "@owndesign/core/server/realtime/frontend-capabilities";

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
  currentPreviewPath?: string;
  frontendTabId?: string;
  model: LanguageModel;
  outputType: ProjectOutputType;
  providerOptions?: ToolLoopAgentSettings["providerOptions"];
  projectId: string;
  resources: ResourceSettings;
  workspaceStore: WorkspaceStore;
};

export type DesignAgentContext = CreateDesignPageAgentInput;

export type DesignPromptSection = {
  tag: string;
  content: string;
};

type CreateDesignPageAgentContextInput = {
  currentPreviewPath?: string;
  frontendTabId?: string;
  modelConfigurationId?: string;
  outputType: ProjectOutputType;
  projectId: string;
  providerOptionsSelection?: DeepSeekThinkingMode;
  workspaceStore: WorkspaceStore;
};

export class AiSdkDesignPageAgent implements DesignPageAgent {
  constructor(private readonly workspaceStore: WorkspaceStore) {}

  async generateProjectOutput(input: DesignPageAgentInput) {
    if (input.outputType !== "html") {
      throw new Error(`Unsupported Project Output Type: ${input.outputType}`);
    }

    const context = await createDesignPageAgentContext({
      outputType: input.outputType,
      projectId: input.projectId,
      workspaceStore: this.workspaceStore,
    });
    const agent = createDesignPageAgent(context);

    const result = await agent.generate({
      prompt: input.content,
    });

    return {
      content: result.text || "已处理请求。",
    };
  }
}

export async function createDesignPageAgentContext({
  currentPreviewPath,
  frontendTabId,
  modelConfigurationId,
  outputType,
  projectId,
  providerOptionsSelection,
  workspaceStore,
}: CreateDesignPageAgentContextInput): Promise<DesignAgentContext> {
  if (outputType !== "html") {
    throw new Error(`Unsupported Project Output Type: ${outputType}`);
  }

  const settingsService = createSettingsService();
  const [settings, modelConfiguration] = await Promise.all([
    settingsService.getSettings(),
    settingsService.resolveModelConfiguration(modelConfigurationId),
  ]);

  return {
    currentPreviewPath,
    frontendTabId,
    model: buildLanguageModel(modelConfiguration),
    outputType,
    providerOptions: buildProviderOptions(
      modelConfiguration,
      providerOptionsSelection,
    ),
    projectId,
    resources: settings.resources,
    workspaceStore,
  };
}

export function createDesignPageAgent(context: DesignAgentContext) {
  const { model, providerOptions } = context;

  return new ToolLoopAgent({
    model,
    instructions: buildDesignPageInstructions(context),
    providerOptions,
    stopWhen: stepCountIs(50),
    tools: createDesignPageWorkspaceTools(context),
  });
}

export function createDesignPageWorkspaceTools({
  projectId,
  resources,
  workspaceStore,
  frontendTabId,
}: DesignAgentContext) {
  return createProjectWorkspaceTools({
    approvedCdnUrls: buildApprovedCdnUrls(resources),
    frontendTabId,
    projectId,
    resources,
    workspaceStore,
  });
}

export function buildDesignPageInstructions({
  currentPreviewPath,
  outputType,
  resources,
}: DesignAgentContext) {
  return buildDesignPageAgentInstructions(
    outputType,
    resources,
    currentPreviewPath,
  );
}

export function buildLanguageModel(
  configuration: ModelConfiguration,
): LanguageModelV3 {
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
  currentPreviewPath?: string,
) {
  const sections: DesignPromptSection[] = [
    {
      tag: "design_agent_core",
      content: loadDesignPageAgentCorePrompt(),
    },
    {
      tag: "page_target_protocol",
      content: buildPageTargetProtocolPrompt(),
    },
    {
      tag: "tool_workflow",
      content: buildToolWorkflowPrompt(),
    },
    {
      tag: "frontend_capabilities",
      content: buildFrontendCapabilityPrompt(),
    },
    ...(resources
      ? [
          {
            tag: "resource_policy",
            content: buildResourcePolicyPrompt(resources),
          },
        ]
      : []),
    {
      tag: "runtime_context",
      content: buildProjectOutputPrompt(outputType, currentPreviewPath),
    },
  ];

  return renderDesignPromptSections(sections);
}

export function renderDesignPromptSections(sections: DesignPromptSection[]) {
  return sections
    .map(({ content, tag }) => {
      const trimmedContent = content.trim();

      return `<${tag}>\n${trimmedContent}\n</${tag}>`;
    })
    .join("\n\n");
}

export function loadDesignPageAgentCorePrompt() {
  return readFileSync(
    path.join(process.cwd(), "src", "server", "agent", "design-page.agent.md"),
    "utf8",
  ).trim();
}

export function buildProjectOutputPrompt(
  outputType: ProjectOutputType,
  currentPreviewPath?: string,
) {
  return buildRuntimeContextPrompt(outputType, currentPreviewPath);
}

export function buildRuntimeContextPrompt(
  outputType: ProjectOutputType,
  currentPreviewPath?: string,
) {
  if (outputType !== "html") {
    throw new Error(`Unsupported Project Output Type: ${outputType}`);
  }

  return [
    "## Runtime Context",
    "Project Output Type: html.",
    "Project Output is a previewable UI prototype, not a production app implementation.",
    `Current preview page: ${currentPreviewPath ?? "none"}.`,
    "If current preview page is known, treat relative references such as 'here', 'this page', 'current page', 'top', 'bottom', or similar page positions as that file.",
    "If the user names another HTML file, path, or page type, that explicit target overrides the current preview page.",
    "If the user only gives a relative page reference and the current preview page is known, edit that page directly; do not ask which page they mean.",
    "Use `callFrontendCapability` with `preview.switchHtml` only when the Preview Pane should move to a different existing target HTML page after creation or updates.",
    "When the current preview page is already the correct target page, do not call `preview.switchHtml` redundantly.",
  ].join("\n");
}

export function buildPageTargetProtocolPrompt() {
  return [
    "## Page Target Protocol",
    "Resolve target page before creating or updating a previewable page.",
    "All previewable HTML files must stay inside the Project Workspace; use relative paths ending in `.html`.",
    "If the user clearly names a page or path, use that explicit target.",
    "If the user uses a relative reference and current preview page is known, use the current preview page.",
    "If the user asks for a home, main, landing, or first page, use `index.html`.",
    "If the user asks for a new named page, choose a semantic `.html` file such as `login.html`, `settings.html`, or `pages/detail.html`.",
    "If no page is specified and no multi-page structure is evident, default to `index.html`.",
    "If multiple HTML files exist, current preview page is unknown, and the user's target is still ambiguous after `glob` and `read`, ask one concise follow-up question.",
    "Do not ask a follow-up question just because the request is brief; act when current preview page, explicit filename, or `index.html` default resolves the target.",
    "Resolve target page.",
    "Inspect workspace when needed with `glob`, `grep`, and `read`; always inspect before coordinated edits when existing files may matter.",
    "Create missing HTML with `createHtml`.",
    "When the target HTML file does not exist, you must call `createHtml` first instead of using `write` to create the initial HTML.",
    "For `createHtml`, choose `path` from the user's page target. Pass `fontLibraryName` or `iconLibraryName` only when the user explicitly specifies those resource preferences; otherwise omit them so the tool reads configured defaults.",
    "Edit existing HTML with `read` plus `edit` or `patch`.",
    "After `createHtml` succeeds, use `edit` or `patch` to fill in the actual page design, then call `callFrontendCapability` with `preview.switchHtml` for that page only if the Preview Pane is not already there.",
    "For existing HTML files, use `read` first, then `edit` or `patch`; do not call `createHtml`.",
    "When creating a new HTML page, do not overwrite `index.html` unless the user intent points to the home or main page.",
    "After file changes are complete, call `callFrontendCapability` exactly once before the final summary: use `preview.switchHtml` when the Preview Pane should move to another HTML file, otherwise use `preview.refresh`.",
    "Finish with concise user-facing summary after the workspace changes are done.",
  ].join("\n");
}

export function buildToolWorkflowPrompt() {
  return [
    "## Tool Workflow",
    "Use Project Workspace tools to inspect, create, edit, search, patch, and delete UTF-8 files.",
    "Use `glob`, `grep`, and `read` to inspect existing Project Workspace files.",
    "Prefer `edit` for focused changes to existing files.",
    "Use `patch` for coordinated changes or when multiple replacements must stay consistent.",
    "Use `createHtml` for missing HTML files, then continue with `edit` or `patch` to complete the design.",
    "Use `write` only for non-HTML files or deliberate full-file overwrites.",
    "Use `delete` only for Project Workspace files that are clearly obsolete.",
    "Only use resource CDNs that already exist in settings. Do not add any other external CDN.",
    "`write`, `edit`, and `patch` reject HTML that contains external CDN tags outside the configured resource settings.",
    "If a tool rejects HTML because of CDN guard rules, retry using configured libraries, system fonts, inline SVG, local CSS, or no external resource.",
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
