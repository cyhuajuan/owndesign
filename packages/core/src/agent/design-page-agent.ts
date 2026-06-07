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
    'Resolve the target preview page before creating or updating previewable output.',
    '',
    'Target rules:',
    '- Previewable pages are stable root HTML files such as `index.html`, `login.html`, `detail.html`, or `settings.html`.',
    '- Do not create `{slug}-v{n}.html` files.',
    '- If the user asks for a home, main, landing, or first page, use `index.html`.',
    '- If the user names a page, file, or path, use that explicit target.',
    '- If no target is specified and no existing multi-page structure clarifies it, use `index.html`.',
    '- If the user refers to "this page", "current page", "here", "top", or "bottom", use the target page stated in the current rewritten user message when available.',
    '- If multiple HTML files exist, no current preview page is available, and the target remains ambiguous after inspection, ask one concise follow-up question.',
    '',
    'HTML shell rules:',
    '- Each HTML file should only load resources, import the page module, and mount one page Web Component.',
    '- Do not put page layout, page CSS, or page interaction logic directly in the HTML shell unless the user explicitly asks to rebuild raw HTML.',
    '- The matching page component for `{slug}.html` is `pages/od-{slug}-page.js`.',
    '- The matching custom element is `od-{slug}-page`.',
    '',
    'Page component styling contract:',
    '- Page components use light DOM by default through `this.innerHTML`.',
    '- Do not use `attachShadow()` in page components.',
    '- Do not use `:host` in page component CSS.',
    '- Wrap page output in a stable root element such as `<main class="od-page">...</main>` or a page-specific root class.',
    '- Scope page CSS through that root class, such as `.od-page`, `.od-page .hero`, and `.od-page .card`.',
    '',
    'New page rules:',
    '- Use a short English semantic slug for filenames and a natural-language displayName from the user intent, such as `index` -> `小说阅读器首页` or `detail` -> `作品详情页`.',
    '- Use `createHtml` when the target HTML file does not exist.',
    '- Do not overwrite an existing HTML page for a new page; if the file exists, inspect it and edit it only when the request targets it.',
    '- After `createHtml`, read the generated HTML shell and page component.',
    '- Continue by replacing the default page component markup and style with a complete designed page prototype.',
    '- Maintain `.owndesign-pages.json` for new pages with `slug`, `displayName`, `htmlPath`, `componentTag`, and `componentSource`.',
    '',
    'Existing page rules:',
    '- If the target HTML exists, read it before editing.',
    '- Prefer editing the corresponding `pages/*.js` page component.',
    '- Edit the HTML shell only when the shell itself is incorrect.',
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
    '- Use `createHtml` only to create a missing HTML shell and its page component.',
    '- Use `edit` for small, focused replacements in one existing file.',
    '- Use `patch` for coordinated changes, repeated replacements, or multi-file edits.',
    '- Use `write` only for non-HTML files or deliberate full-file replacement.',
    '- Do not use `write` to create initial HTML pages.',
    '- Use `copyFile` only when the current user message explicitly asks you to duplicate an existing file.',
    '- Use `delete` only after confirming the file is not referenced.',
    '',
    'For page creation:',
    '- Pass `createHtml` the resolved stable root HTML path.',
    '- Pass `fontLibraryName` or `iconLibraryName` only when the user explicitly names a configured font or icon library; otherwise omit them so the tool reads configured defaults.',
    '- After `createHtml`, read the generated HTML shell and `pages/od-{slug}-page.js` page component.',
    '- Edit the page component before previewing; the default component is only a starting placeholder.',
    '- Replace any default placeholder markup and style completely, including default `.od-page` content.',
    '- Keep page components in light DOM and avoid `:host` or `attachShadow()`.',
    '',
    'For page updates:',
    '- If the target HTML exists, read it before editing and do not call `createHtml`.',
    '- Prefer changes in the matching `pages/*.js` page component.',
    '- Modify the HTML shell only when its resource loading, module import, or mounted custom element is wrong.',
    '',
    'After page changes:',
    '- Use `previewSwitchHtml` when the Preview Pane should show a different existing HTML page.',
    '- Use `previewRefresh` when the current preview page changed and should reload.',
    '- Call exactly one preview tool after successful previewable changes.',
    '',
    'Recover from tool failures:',
    '- If an edit fails, read the file again and retry with a smaller edit or patch.',
    '- If a write, edit, or patch is rejected by CDN guard, remove unconfigured external resources and use configured resources or local CSS.',
  ].join('\n');
}

export function buildSharedComponentsPrompt() {
  return [
    '## Shared Components',
    'Shared Web Components are for clear reuse, not for default abstraction.',
    '',
    'Use shared components when:',
    '- Multiple pages already share the same navigation or site chrome.',
    '- The user asks for site-wide consistency.',
    '- An existing shared component clearly fits the new page.',
    '- Repeated UI would otherwise become inconsistent across pages.',
    '',
    '- Do not extract one-off page sections just because they could be components.',
    '- For single-page work, prioritize the page component visual quality over component extraction.',
    '',
    'Conventions:',
    '- Store shared components in `components/od-{name}.js`.',
    '- Define `customElements.define("od-{name}", ...)`.',
    '- Keep shared component CSS inside the component module.',
    '- Import shared components from page component modules.',
    '- Track shared components in `.owndesign-components.json` with `name`, `tagName`, `source`, `usedBy`, and optional `description`.',
    '- When the user asks to change a whole-site, shared, repeated, or unified component, update the shared component module and call `syncSharedComponent` to update `.owndesign-components.json`.',
    '',
    'Navigation:',
    '- Navigation is the highest-priority shared component in multi-page sites.',
    '- Reuse or create `od-navigation` when pages share top navigation or sidebar navigation.',
    '- Navigation links should point to stable HTML files.',
    '- Active page state can be passed with an attribute such as `<od-navigation current="index"></od-navigation>`.',
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
