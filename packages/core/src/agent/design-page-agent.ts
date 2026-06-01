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
} from "@owndesign/core/settings/settings-service";
import type { ProjectOutputType } from "@owndesign/core/workspace-store";
import { WorkspaceStore } from "@owndesign/core/workspace-store";
import { createProjectWorkspaceTools } from "@owndesign/core/agent/tools/project-workspace-tools";
import { loadPrompt } from "@owndesign/core/prompts";
import { buildFrontendCapabilityPrompt } from "@owndesign/core/realtime/frontend-capabilities";
import {
  buildPageEditModePolicy,
  type PageEditMode,
  type PageEditModePolicy,
} from "@owndesign/core/agent/page-edit-mode";

export const DESIGN_PAGE_AGENT_PROMPT_VERSION = 1;

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
  agentInstructions?: string;
  currentPreviewPath?: string;
  frontendTabId?: string;
  model: LanguageModel;
  outputType: ProjectOutputType;
  pageEditMode?: PageEditMode;
  pageEditModePolicy?: PageEditModePolicy;
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
  pageEditMode?: PageEditMode;
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
  pageEditMode = "auto",
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

  const pageEditModePolicy = await buildPageEditModePolicy({
    currentPreviewPath,
    mode: pageEditMode,
    projectId,
    workspaceStore,
  });

  return {
    currentPreviewPath,
    frontendTabId,
    model: buildLanguageModel(modelConfiguration),
    outputType,
    pageEditMode,
    pageEditModePolicy,
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
  const { agentInstructions, model, providerOptions } = context;

  return new ToolLoopAgent({
    allowSystemInMessages: true,
    model,
    instructions: agentInstructions ?? buildDesignPageInstructions(context),
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
  pageEditModePolicy,
}: DesignAgentContext) {
  return createProjectWorkspaceTools({
    approvedCdnUrls: buildApprovedCdnUrls(resources),
    frontendTabId,
    pageEditModePolicy,
    projectId,
    resources,
    workspaceStore,
  });
}

export function buildDesignPageInstructions({
  resources,
}: DesignAgentContext) {
  return buildDesignPageConversationInstructions(resources);
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
  resources?: ResourceSettings,
) {
  return buildDesignPageConversationInstructions(resources);
}

export function buildDesignPageConversationInstructions(
  resources?: ResourceSettings,
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
  return loadPrompt("agents/design-page");
}

export function buildPageTargetProtocolPrompt() {
  return [
    "## Page Target Protocol",
    "",
    "Resolve the target HTML page before creating or updating previewable output.",
    "",
    "Target resolution:",
    "- All previewable pages must be relative workspace paths ending in `.html`.",
    "- If the user names a file, path, or page type, use that explicit target.",
    "- Each turn's user message has already been rewritten with the current preview page and page edit mode when those matter.",
    "- If the user uses a relative page reference such as \"this page\", \"current page\", \"here\", \"top\", or \"bottom\", use the target page stated in the current user message when available.",
    "- If the user asks for a home, main, landing, or first page, use `index.html`.",
    "- If the user asks for a new named page, choose a semantic filename such as `login.html`, `settings.html`, or `pages/detail.html`.",
    "- If no target is specified and no multi-page structure is evident, default to `index.html`.",
    "- If multiple HTML files exist, no current preview page is available, and the target remains ambiguous after inspection, ask one concise follow-up question.",
    "- Do not ask a follow-up question just because the request is brief; act when the target can be resolved from the current user message, an explicit filename, or the `index.html` default.",
    "",
    "Workspace inspection:",
    "- Use `glob`, `grep`, and `read` when existing files may affect the change.",
    "- Always inspect before coordinated edits across existing files.",
    "",
    "File operation:",
    "- Do not modify unrelated HTML files unless the requested change requires coordinated edits.",
    "- If the target HTML file does not exist, create it with `createHtml`; do not create initial HTML with `write`.",
    "- For `createHtml`, pass the resolved target path. Pass `fontLibraryName` or `iconLibraryName` only when the user explicitly names a font or icon library; otherwise omit them so the tool reads configured defaults.",
    "- After `createHtml` succeeds, use `edit` or `patch` to fill in the actual page design.",
    "- If the target HTML file exists, use `read` first, then `edit` or `patch`; do not call `createHtml`.",
    "- Do not overwrite `index.html` for a new page unless the user intent points to the home or main page.",
    "",
    "Preview update:",
    "- After file changes, call `callFrontendCapability` exactly once before the final summary.",
    "- Use `preview.switchHtml` when the Preview Pane should move to a different HTML page.",
    "- Use `preview.refresh` when the Preview Pane is already on the correct page.",
    "",
    "Final response:",
    "- Finish with a concise user-facing summary after workspace changes are done.",
  ].join("\n");
}

export function buildToolWorkflowPrompt() {
  return [
    "## Tool Workflow",
    "Use the narrowest reliable tool for each task; inspect before writing, recover before retrying.",
    "",
    "Inspect before changing existing files:",
    "- Use `glob` to discover files.",
    "- Use `grep` to locate relevant code or markup.",
    "- Use `read` before editing any existing target file.",
    "",
    "Choose the write tool by intent:",
    "- Use `edit` for small, focused replacements in one existing file.",
    "- Use `patch` for coordinated changes, repeated replacements, or multi-file edits.",
    "- Use `write` only for non-HTML files or deliberate full-file overwrites (never to create a new HTML page).",
    "- Use `delete` only after using `grep` or direct inspection to confirm the file is no longer referenced by any page or build target.",
    "- Use `copyFile` when the current user message asks you to duplicate an existing file before editing the duplicate.",
    "",
    "For HTML pages:",
    "- Use `createHtml` when the target HTML file does not exist.",
    "- After `createHtml`, continue with `edit` or `patch` until the page is complete.",
    "",
    "Recover from tool failures:",
    "- If `edit` cannot find the expected text, `read` the file again and retry with a smaller replacement or `patch`.",
    "- If a write tool returns an error or produces unexpected output, read the file again before retrying.",
    "",
    "Resource constraints:",
    "- Only use CDNs already listed in resource settings; do not add others.",
    "- `write`, `edit`, and `patch` will reject HTML with unlisted CDN tags - if rejected, fall back to configured libraries, system fonts, inline SVG, or local CSS.",
    "",
    "Preview workflow:",
    "- Call preview once, after all file changes for the current task are complete.",
    "- Do not call preview during intermediate edits.",
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
    "Prefer configured icon libraries for icons. Use inline SVG only when no icon library is configured or when the configured libraries cannot provide a suitable icon.",
    "Do not reference any unconfigured external icon service or icon CDN.",
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
