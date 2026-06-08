import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { stepCountIs, ToolLoopAgent, type LanguageModel, type ToolLoopAgentSettings } from 'ai';

import {
  createSettingsService,
  type AnthropicEffort,
  type DeepSeekThinkingMode,
  type ModelConfiguration,
  type ResourceLibrary,
  type ResourceSettings,
} from '@owndesign/core/settings/settings-service';
import type { ProjectOutputType, ProjectType } from '@owndesign/core/workspace-store';
import { WorkspaceStore } from '@owndesign/core/workspace-store';
import { createProjectWorkspaceToolDefinitions } from '@owndesign/core/agent/tools/project-workspace-tools';
import { createWorkspaceToolRegistry } from '@owndesign/core/agent/tools/core';
import { loadPrompt } from '@owndesign/core/prompts';
import { buildFrontendCapabilityPrompt } from '@owndesign/core/realtime/frontend-capabilities';

export const DESIGN_PAGE_AGENT_PROMPT_VERSION = 1;

export type DesignPageAgentInput = {
  content: string;
  projectId: string;
  projectType?: ProjectType;
  outputType?: ProjectOutputType;
};

export type DesignPageAgentResult = {
  content: string;
};

export type DesignPageAgent = {
  generateProjectOutput(input: DesignPageAgentInput): Promise<DesignPageAgentResult>;
};

type CreateDesignPageAgentInput = {
  agentInstructions?: string;
  currentPreviewPath?: string;
  frontendTabId?: string;
  model: LanguageModel;
  outputType?: ProjectOutputType;
  projectType?: ProjectType;
  providerOptions?: ToolLoopAgentSettings['providerOptions'];
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
  outputType?: ProjectOutputType;
  projectType?: ProjectType;
  projectId: string;
  providerOptionsSelection?: ProviderOptionsSelection;
  settingsPath?: string;
  workspaceStore: WorkspaceStore;
};

export type ProviderOptionsSelection = {
  anthropic?: AnthropicEffort;
  deepseek?: DeepSeekThinkingMode;
};

export class AiSdkDesignPageAgent implements DesignPageAgent {
  constructor(private readonly workspaceStore: WorkspaceStore) {}

  async generateProjectOutput(input: DesignPageAgentInput) {
    const projectType = normalizeProjectType(input.projectType, input.outputType);

    if (projectType !== 'single_html') {
      throw new Error(`Unsupported Project Type: ${projectType}`);
    }

    const context = await createDesignPageAgentContext({
      projectType,
      projectId: input.projectId,
      workspaceStore: this.workspaceStore,
    });
    const agent = createDesignPageAgent(context);
    const result = await agent.generate({
      prompt: input.content,
    });

    return {
      content: result.text || '已处理请求。',
    };
  }
}

export async function createDesignPageAgentContext({
  currentPreviewPath,
  frontendTabId,
  modelConfigurationId,
  outputType,
  projectType,
  projectId,
  providerOptionsSelection,
  settingsPath,
  workspaceStore,
}: CreateDesignPageAgentContextInput): Promise<DesignAgentContext> {
  projectType = normalizeProjectType(projectType, outputType);

  if (projectType !== 'single_html') {
    throw new Error(`Unsupported Project Type: ${projectType}`);
  }

  const settingsService = createSettingsService({ settingsPath });
  const [settings, modelConfiguration] = await Promise.all([
    settingsService.getSettings(),
    settingsService.resolveModelConfiguration(modelConfigurationId),
  ]);

  return {
    currentPreviewPath,
    frontendTabId,
    model: buildLanguageModel(modelConfiguration),
    projectType,
    providerOptions: buildProviderOptions(modelConfiguration, providerOptionsSelection),
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

export function createDesignPageWorkspaceTools(context: DesignAgentContext) {
  const { frontendTabId, projectId, resources, workspaceStore } = context;

  return createWorkspaceToolRegistry(createProjectWorkspaceToolDefinitions(), {
    approvedCdnUrls: buildApprovedCdnUrls(resources),
    frontendTabId,
    model: context.model,
    projectId,
    providerOptions: context.providerOptions,
    resources,
    workspaceStore,
  });
}

export function buildDesignPageInstructions({ resources }: DesignAgentContext) {
  return buildDesignPageConversationInstructions(resources);
}

export function buildLanguageModel(configuration: ModelConfiguration): LanguageModelV3 {
  if (configuration.provider === 'deepseek') {
    return createDeepSeek({
      apiKey: configuration.apiKey || undefined,
      baseURL: configuration.baseUrl || undefined,
    })(configuration.model);
  }

  if (configuration.provider === 'anthropic') {
    return createAnthropic({
      apiKey: configuration.apiKey || undefined,
      baseURL: configuration.baseUrl || undefined,
    })(configuration.model);
  }

  return createOpenAICompatible({
    name: 'openaiCompatible',
    apiKey: configuration.apiKey || undefined,
    baseURL: configuration.baseUrl,
  })(configuration.model);
}

export function buildProviderOptions(
  configuration: ModelConfiguration,
  selection?: ProviderOptionsSelection,
): ToolLoopAgentSettings['providerOptions'] {
  if (configuration.provider === 'anthropic') {
    if (!selection?.anthropic) {
      return undefined;
    }

    return {
      anthropic: {
        thinking: { type: 'adaptive' },
        effort: selection.anthropic,
      },
    };
  }

  if (configuration.provider !== 'deepseek') {
    return undefined;
  }

  const thinkingMode =
    selection?.deepseek ?? configuration.providerOptions?.deepseek?.thinkingMode ?? 'high';

  if (thinkingMode === 'disabled') {
    return {
      deepseek: {
        thinking: { type: 'disabled' },
      },
    };
  }

  return {
    deepseek: {
      thinking: { type: 'enabled' },
      reasoningEffort: thinkingMode,
    },
  };
}

function normalizeProjectType(projectType?: ProjectType, outputType?: ProjectOutputType) {
  if (projectType) {
    return projectType;
  }

  if (outputType === 'html') {
    return 'single_html';
  }

  return 'single_html';
}

export function buildDesignPageAgentInstructions(resources?: ResourceSettings) {
  return buildDesignPageConversationInstructions(resources);
}

export function buildDesignPageConversationInstructions(resources?: ResourceSettings) {
  const sections: DesignPromptSection[] = [
    {
      tag: 'design_agent_core',
      content: loadDesignPageAgentCorePrompt(),
    },
    {
      tag: 'page_target_protocol',
      content: buildPageTargetProtocolPrompt(),
    },
    {
      tag: 'tool_workflow',
      content: buildToolWorkflowPrompt(),
    },
    {
      tag: 'frontend_capabilities',
      content: buildFrontendCapabilityPrompt(),
    },
    ...(resources
      ? [
          {
            tag: 'resource_policy',
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
    .join('\n\n');
}

export function loadDesignPageAgentCorePrompt() {
  return loadPrompt('agents/design-page');
}

export function buildPageTargetProtocolPrompt() {
  return [
    '## Single HTML Target Protocol',
    '',
    'The project has one previewable file: `index.html`.',
    '',
    'Rules:',
    '- Always target `index.html` for previewable output.',
    '- Do not create `login.html`, `detail.html`, versioned HTML files, or any other HTML page.',
    '- If the user asks for multiple pages, screens, or routes, implement them as internal views inside `index.html`.',
    '- Use ordinary HTML, CSS, and browser JavaScript in the file.',
    '- Do not create custom elements, component module folders, page manifests, or shared component manifests.',
    '- If `index.html` is missing, call `createHtml({ path: "index.html" })` before editing.',
    '- If `index.html` exists, read it before editing and continue from the current design.',
  ].join('\n');
}

export function buildToolWorkflowPrompt() {
  return [
    '## Tool Workflow',
    'Use the narrowest reliable tool for each task.',
    '',
    'Inspect before editing:',
    '- Use `glob` to discover files.',
    '- Use `grep` to locate relevant code or markup.',
    '- Use `read` before editing an existing file.',
    '',
    'Choose tools by intent:',
    '- Use `createHtml` only to create a missing `index.html` file.',
    '- Use `edit` for small, focused replacements in one existing file.',
    '- Use `patch` for coordinated changes, repeated replacements, or multi-file edits.',
    '- Use `write` only for deliberate full-file replacement or non-preview support files.',
    '- Do not use `write` to create the initial `index.html`; use `createHtml` first.',
    '- Use `copyFile` only when the current user message explicitly asks you to duplicate an existing file.',
    '- Use `delete` only after confirming the file is not referenced.',
    '',
    'For Single HTML creation:',
    '- Call `createHtml({ path: "index.html" })` when `index.html` is missing.',
    '- After `createHtml`, read `index.html`.',
    '- Replace the default placeholder markup, CSS, and script with a complete designed prototype.',
    '',
    'For Single HTML updates:',
    '- If `index.html` exists, read it before editing and do not call `createHtml`.',
    '- Keep visible page structure, styling, and local interactions in `index.html`.',
    '- Use internal views for multi-screen workflows instead of additional HTML files.',
    '',
    'After page changes:',
    '- Use `previewRefresh` when the current preview page changed and should reload.',
    '- Call exactly one `previewRefresh` after successful previewable changes.',
    '',
    'Recover from tool failures:',
    '- If an edit fails, read the file again and retry with a smaller edit or patch.',
    '- If a generated prototype becomes too large or brittle, simplify the file while preserving visible quality.',
  ].join('\n');
}

export function buildSharedComponentsPrompt() {
  return [
    '## Single File Architecture',
    'This project type does not use shared components or multiple preview pages.',
    '',
    '- Keep the prototype self-contained in `index.html`.',
    '- For repeated UI, reuse CSS classes and small JavaScript helper functions inside `index.html`.',
    '- Navigation should switch internal views, tabs, sections, or hash routes inside the same document.',
    '- Do not create manifests or component modules for reuse.',
  ].join('\n');
}

export function buildResourcePolicyPrompt(resources: ResourceSettings) {
  const defaultFontLibrary = getDefaultResourceLibrary(resources.fontLibraries);
  const defaultIconLibrary = getDefaultResourceLibrary(resources.iconLibraries);
  const fontLines = formatResourceLibraryList(resources.fontLibraries);
  const iconLines = formatResourceLibraryList(resources.iconLibraries);

  return [
    '## Resource Policy',
    'Use these global resource settings when designing HTML preview pages.',
    defaultFontLibrary
      ? `Default font library: ${defaultFontLibrary.name}.`
      : 'Default font library: none configured.',
    defaultIconLibrary
      ? `Default icon library: ${defaultIconLibrary.name}.`
      : 'Default icon library: none configured.',
    'If the user prompt explicitly names a configured font or icon library, use that named library; otherwise use the default library.',
    'Only use configured font libraries or system fonts. Do not reference any unconfigured external font service or font CDN.',
    'Prefer configured icon libraries for icons. Use inline SVG only when no icon library is configured or when the configured libraries cannot provide a suitable icon.',
    'Do not reference any unconfigured external icon service or icon CDN.',
    'When a configured library has no CDN, follow the library choice in CSS naming only and do not add a CDN tag for it.',
    'Configured font libraries:',
    fontLines.length ? fontLines.join('\n') : '- none',
    'Configured icon libraries:',
    iconLines.length ? iconLines.join('\n') : '- none',
    'Use regular inline CSS as the primary styling method.',
    'Do not add new CDN resources. If a needed resource is not configured, use system fonts, inline SVG, local CSS, or explain the limitation.',
  ].join('\n');
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
      `- ${library.name}${library.isDefault ? ' (default)' : ''}${library.cdn ? ' (configured CDN)' : ' (no CDN)'}`,
  );
}
