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
import type { ProjectOutputType } from '@owndesign/core/workspace-store';
import { WorkspaceStore } from '@owndesign/core/workspace-store';
import { createProjectWorkspaceToolDefinitions } from '@owndesign/core/agent/tools/project-workspace-tools';
import { createWorkspaceToolRegistry } from '@owndesign/core/agent/tools/core';
import { loadPrompt } from '@owndesign/core/prompts';
import { buildFrontendCapabilityPrompt } from '@owndesign/core/realtime/frontend-capabilities';
import {
  buildPageEditModePolicy,
  type PageEditMode,
  type PageEditModePolicy,
} from '@owndesign/core/agent/page-edit-mode';

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
  generateProjectOutput(input: DesignPageAgentInput): Promise<DesignPageAgentResult>;
};

type CreateDesignPageAgentInput = {
  agentInstructions?: string;
  currentPreviewPath?: string;
  frontendTabId?: string;
  model: LanguageModel;
  outputType: ProjectOutputType;
  pageEditMode?: PageEditMode;
  pageEditModePolicy?: PageEditModePolicy;
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
  outputType: ProjectOutputType;
  pageEditMode?: PageEditMode;
  projectId: string;
  providerOptionsSelection?: ProviderOptionsSelection;
  workspaceStore: WorkspaceStore;
};

export type ProviderOptionsSelection = {
  anthropic?: AnthropicEffort;
  deepseek?: DeepSeekThinkingMode;
};

export class AiSdkDesignPageAgent implements DesignPageAgent {
  constructor(private readonly workspaceStore: WorkspaceStore) {}

  async generateProjectOutput(input: DesignPageAgentInput) {
    if (input.outputType !== 'html') {
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
      content: result.text || '已处理请求。',
    };
  }
}

export async function createDesignPageAgentContext({
  currentPreviewPath,
  frontendTabId,
  modelConfigurationId,
  outputType,
  pageEditMode = 'auto',
  projectId,
  providerOptionsSelection,
  workspaceStore,
}: CreateDesignPageAgentContextInput): Promise<DesignAgentContext> {
  if (outputType !== 'html') {
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
  const { frontendTabId, pageEditModePolicy, projectId, resources, workspaceStore } = context;

  return createWorkspaceToolRegistry(createProjectWorkspaceToolDefinitions(), {
    approvedCdnUrls: buildApprovedCdnUrls(resources),
    frontendTabId,
    model: context.model,
    pageEditModePolicy,
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
      tag: 'shared_components',
      content: buildSharedComponentsPrompt(),
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
    '## Page Target Protocol',
    '',
    'Resolve the target HTML page before creating or updating previewable output.',
    '',
    'Target resolution:',
    '- All previewable pages must be relative workspace paths ending in `.html`.',
    '- If the user names a file, path, or page type, use that explicit target.',
    "- Each turn's user message has already been rewritten with the current preview page and page edit mode when those matter.",
    '- If the user uses a relative page reference such as "this page", "current page", "here", "top", or "bottom", use the target page stated in the current user message when available.',
    '- Store previewable HTML pages flat in the workspace root; do not create page subdirectories.',
    '- Name pages as stable `{slug}.html`, such as `index.html`, `login.html`, or `settings.html`.',
    '- Each page HTML is a shell that loads and renders one page Web Component from `pages/od-{slug}-page.js`.',
    '- Maintain `.owndesign-pages.json` as page directory metadata when creating a new page. Each entry must include `slug`, `displayName`, `htmlPath`, `componentTag`, and `componentSource`.',
    '- Use a short English semantic slug for filenames and a natural-language displayName from the user intent, such as `index` -> `小说阅读器首页` or `detail` -> `作品详情页`.',
    '- If the user asks for a home, main, landing, or first page, use `index.html`.',
    '- For a first home page, create `index.html`, create `pages/od-index-page.js`, and add an `index` entry to `.owndesign-pages.json`.',
    '- If the user asks for a new named page, choose a semantic slug and create its stable HTML path, such as `login.html` or `detail.html`.',
    '- For a new named page, create `{slug}.html`, create `pages/od-{slug}-page.js`, and add that slug entry to `.owndesign-pages.json`.',
    '- If no target is specified and no multi-page structure is evident, default to `index.html`.',
    '- If multiple HTML files exist, no current preview page is available, and the target remains ambiguous after inspection, ask one concise follow-up question.',
    '- Do not ask a follow-up question just because the request is brief; act when the target can be resolved from the current user message, an explicit filename, or the `index.html` default.',
    '',
    '- Cross-page links should target stable HTML files such as `detail.html`.',
    '- Do not overwrite an existing HTML page for a new page; if the file exists, inspect it and edit the existing page only when the request targets it.',
  ].join('\n');
}

export function buildToolWorkflowPrompt() {
  return [
    '## Tool Workflow',
    'Use the narrowest reliable tool for each task; inspect before writing, recover before retrying.',
    '',
    'Inspect before changing files:',
    '- Use `glob` to discover files.',
    '- Use `grep` to locate relevant code or markup.',
    '- Use `read` before editing any existing target file.',
    '- Always inspect before coordinated edits across existing files.',
    '',
    'Choose the write tool by intent:',
    '- Use `edit` for small, focused replacements in one existing file.',
    '- Use `patch` for coordinated changes, repeated replacements, or multi-file edits.',
    '- Use `write` only for non-HTML files or deliberate full-file overwrites; never use it to create initial HTML pages.',
    '- Do not use `write` for ordinary HTML page edits. Use it for HTML only when the user explicitly asks to rebuild the whole file.',
    '- Use `delete` only after using `grep` or direct inspection to confirm the file is no longer referenced by any page or build target.',
    '- Use `copyFile` only when the current user message explicitly asks you to duplicate an existing file.',
    '',
    'For HTML pages and page Web Components:',
    '- Do not modify unrelated HTML files unless the requested change requires coordinated edits.',
    '- Use `createHtml` when the target HTML file does not exist; do not create initial HTML with `write`.',
    '- For `createHtml`, pass the resolved stable root HTML path. Pass `fontLibraryName` or `iconLibraryName` only when the user explicitly names a font or icon library; otherwise omit them so the tool reads configured defaults.',
    '- `createHtml` also creates the matching `pages/od-{slug}-page.js` page component. After `createHtml`, immediately use `read` on both files before editing them.',
    '- If the target HTML file exists, use `read` before editing it; do not call `createHtml`.',
    '- Keep HTML files as shells. Put page layout, styles, and behavior in the page Web Component under `pages/*.js`.',
    '- Use `edit` or `patch` for HTML or JS changes after reading the file.',
    '',
    'Recover from tool failures:',
    '- If `edit` cannot find the expected text, `read` the file again and retry with a smaller replacement or `patch`.',
    '- If a write tool returns an error or produces unexpected output, read the file again before retrying.',
    '',
    'Resource constraints:',
    '- Only use CDNs already listed in resource settings; do not add others.',
    '- `write`, `edit`, and `patch` will reject HTML with unlisted CDN tags - if rejected, fall back to configured libraries, system fonts, inline SVG, or local CSS.',
  ].join('\n');
}

export function buildSharedComponentsPrompt() {
  return [
    '## Shared Components',
    'Use Web Components to keep repeated UI consistent across multi-page HTML projects.',
    '',
    'Component library convention:',
    '- Before designing a new page in a multi-page project, inspect `.owndesign-components.json` and reuse existing Web Components when they fit.',
    '- Store shared component modules at `components/od-{name}.js`, such as `components/od-navigation.js` or `components/od-product-card.js`.',
    '- Each shared component module must define a custom element with `customElements.define("od-{name}", ...)`.',
    '- Keep component CSS inside the component module. Use shadow DOM or scoped host selectors so shared component styles do not leak globally.',
    '- Import shared components from page component modules with relative module imports, then render their tags such as `<od-navigation></od-navigation>`.',
    '- Maintain `.owndesign-components.json` with `{ "components": [{ "name": "navigation", "tagName": "od-navigation", "source": "components/od-navigation.js", "usedBy": ["index.html"], "description": "Site navigation" }] }`.',
    '- When navigation needs active state, pass the current page slug through an attribute such as `<od-navigation current="index"></od-navigation>` and implement active state inside the component.',
    '',
    'Workflow:',
    '- When creating or editing a page in a multi-page project, inspect `.owndesign-components.json` before designing shared site structure.',
    '- Navigation is the highest-priority shared component: if pages in the same site use the same top nav or sidebar nav, create or reuse `od-navigation` unless the user explicitly asks for page-specific navigation.',
    '- When adding a new page to an existing site, reuse shared navigation before inventing a new visual variant, and update nav links when appropriate.',
    '- Extract other components only when reuse is likely and visual consistency matters. Avoid extracting one-off sections, content-heavy sections, or modules that are intentionally different on each page.',
    '- When the user asks to change a whole-site, shared, repeated, or unified component, update the shared component module and call `syncSharedComponent` to update `.owndesign-components.json`.',
    '- For one-page local changes, edit the page component in `pages/*.js` directly.',
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
