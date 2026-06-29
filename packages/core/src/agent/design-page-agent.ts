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

export const DESIGN_PAGE_AGENT_PROMPT_VERSION = 7;

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
    maxRetries: 5,
    providerOptions,
    stopWhen: stepCountIs(50),
    tools: createDesignPageWorkspaceTools(context),
  });
}

export function createDesignPageWorkspaceTools(context: DesignAgentContext) {
  const { frontendTabId, projectId, resources, workspaceStore } = context;

  return createWorkspaceToolRegistry(createProjectWorkspaceToolDefinitions(), {
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

export function buildDesignPageAgentInstructions(
  resources?: ResourceSettings,
  designDocument?: string | null,
) {
  return buildDesignPageConversationInstructions(resources, designDocument);
}

export function buildDesignPageConversationInstructions(
  resources?: ResourceSettings,
  designDocument?: string | null,
) {
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
    {
      tag: 'resource_policy',
      content: resources ? buildResourcePolicyPrompt(resources) : buildResourcePolicyFallbackPrompt(),
    },
  ];

  const projectDesignPrompt = buildProjectDesignDocumentPrompt(designDocument);

  if (projectDesignPrompt) {
    sections.push({
      tag: 'project_design_document',
      content: projectDesignPrompt,
    });
  }

  return renderDesignPromptSections(sections);
}

export function buildProjectDesignDocumentPrompt(designDocument: string | null | undefined) {
  if (designDocument == null || designDocument === '') {
    return undefined;
  }

  return [
    '## Project DESIGN.md',
    '',
    'The following content is the user-maintained project design document frozen for this conversation.',
    'Treat it as read-only design guidance when creating or editing `index.html`.',
    'OwnDesign must not create, edit, overwrite, normalize, migrate, or summarize this document.',
    'Do not claim that you changed `DESIGN.md`; only the user can update it in project settings.',
    'If the user asks for a change that conflicts with this document, explain the conflict briefly and follow the user request only as a one-off change unless they update project settings.',
    '',
    '```md',
    designDocument,
    '```',
  ].join('\n');
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
    '- If the user asks for multiple pages, page-level screens, or route-like navigation, use hash routing inside `index.html`.',
    '- Do not use path-based browser routing.',
    '- Any UI state that a viewer would want to link to or return to directly must be restorable from `location.hash`, including tabs, modals, drawers, side panels, selected detail views, filters, and modes.',
    '- A direct load of `index.html#/route?...` must render the matching route and any material UI state without requiring prior clicks.',
    '- Render the current hash state on initial load, such as `DOMContentLoaded`, as well as on `hashchange`; do not rely on `hashchange` firing for the first paint.',
    '- Use normal hash navigation for page-level route changes. For in-page sub-state such as tabs, modals, drawers, side panels, filters, modes, and selected details, update the hash with `history.replaceState` so the Back button moves between pages instead of every toggle.',
    '- Navigation, tabs, modal and drawer controls, side-panel controls, filters, modes, and detail selectors should update `location.hash` when they control a deep-link-worthy design state.',
    '- Use local in-memory state only for ephemeral micro-interactions such as hover, focus, pressed feedback, transient toasts, loading spinners, and unsubmitted form typing.',
    '- Preserve the OwnDesign protected runtime script with `data-owndesign-runtime="preview-route-bridge"` unchanged, exactly once, as the last element inside `<body>`.',
    '- Put app-specific prototype JavaScript in a separate earlier script block, not inside the OwnDesign protected runtime script.',
    '- Use ordinary HTML, CSS, and browser JavaScript in the file.',
    '- Do not create custom elements, component module folders, or page/component reuse metadata files.',
    '- If `index.html` is missing, use `write` to create a complete `index.html` before refreshing preview.',
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
    '- Use `edit` for small, focused replacements in one existing file.',
    '- Use `write` only for deliberate full-file replacement of `index.html` or to create a missing `index.html` with complete content.',
    '',
    'Single HTML create vs update flow:',
    '- When `index.html` is missing, use `write` with a complete designed prototype.',
    '- When `index.html` exists, read it before editing.',
    '',
    'Recover from tool failures:',
    '- If an edit fails, read the file again and retry with a smaller, exact edit.',
    '- If repeated focused edits would be more fragile than replacing the file, use `write` for an intentional full-file replacement.',
    '- If a generated prototype becomes too large or brittle, simplify the file while preserving visible quality.',
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
    'The default HTML template already configures Inter and Noto Sans SC on the `html` element.',
    'Unless the user explicitly asks for a different typeface, do not change `font-family`; adjust typography with size, weight, line-height, spacing, and hierarchy.',
    'Lucide icons are already configured by the default HTML template and initialized by the protected OwnDesign runtime script.',
    'Use Lucide icons with `<i data-lucide="menu"></i>` syntax, replacing `menu` with the appropriate Lucide icon name.',
    'Do not use other icon systems, inline SVG icons, emoji icons, or decorative emoji as UI icons.',
    'When styling Lucide icons, do not target `i`, `i[data-lucide]`, or tag selectors because Lucide replaces the placeholder with inline `svg` elements.',
    'Give icons a semantic class or wrap them in a classed element, then style the class and child `svg`, such as `.nav-icon svg { width: 18px; height: 18px; stroke-width: 2; }`.',
    'If JavaScript dynamically inserts markup that contains Lucide placeholders, call `lucide.createIcons()` after updating the DOM.',
    'Do not edit, move after another element, remove, duplicate, or add app logic inside the protected OwnDesign runtime script.',
    'Prefer configured resources and local CSS before adding any external resource.',
    'Add an extra external resource only when the user explicitly requests it or when it is necessary for the prototype quality.',
    'When a configured library has no CDN, follow the library choice in CSS naming only.',
    'Configured font libraries:',
    fontLines.length ? fontLines.join('\n') : '- none',
    'Configured icon libraries:',
    iconLines.length ? iconLines.join('\n') : '- none',
    'Use regular inline CSS as the primary styling method.',
  ].join('\n');
}

function buildResourcePolicyFallbackPrompt() {
  return [
    '## Resource Policy',
    'No global resource settings were provided for this run.',
    'Use resources already present in the existing `index.html` or the default HTML template.',
    'Prefer local CSS and built-in browser capabilities before adding any external resource.',
    'Do not add a new font, icon, image, script, or CDN dependency unless the user explicitly requests it or it is necessary for prototype quality.',
    'If no icon library is configured, use text labels or simple CSS shapes instead of assuming a specific icon system.',
    'Use regular inline CSS as the primary styling method.',
  ].join('\n');
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
