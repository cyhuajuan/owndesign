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
import { createComponentAuditToolDefinition } from '@owndesign/core/agent/tools/component-audit';
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

  return createWorkspaceToolRegistry(
    [...createProjectWorkspaceToolDefinitions(), createComponentAuditToolDefinition()],
    {
      approvedCdnUrls: buildApprovedCdnUrls(resources),
      frontendTabId,
      model: context.model,
      pageEditModePolicy,
      projectId,
      providerOptions: context.providerOptions,
      resources,
      workspaceStore,
    },
  );
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
    '- Store previewable HTML pages flat in the workspace root; do not create page subdirectories unless the user explicitly asks for a directory.',
    '- Name page versions as `{slug}-v{n}.html`, such as `index-v1.html`, `login-v1.html`, or `settings-v1.html`.',
    '- Maintain `.owndesign-pages.json` as page directory metadata when creating a new page. It must contain only `{ "pages": [{ "slug": "...", "displayName": "..." }] }` entries.',
    '- Use a short English semantic slug for filenames and a natural-language displayName from the user intent, such as `index` -> `小说阅读器首页` or `detail` -> `作品详情页`.',
    '- If the user asks for a home, main, landing, or first page, use `index-v1.html` for the first version.',
    '- For a first home page, create `index-v1.html` and add an `index` displayName entry to `.owndesign-pages.json`.',
    '- If the user asks for a new named page, choose a semantic slug and create its first version, such as `login-v1.html` or `detail-v1.html`.',
    '- For a new named page, create `{slug}-v1.html` and add that slug displayName entry to `.owndesign-pages.json`.',
    '- If no target is specified and no multi-page structure is evident, default to `index-v1.html`.',
    '- If multiple HTML files exist, no current preview page is available, and the target remains ambiguous after inspection, ask one concise follow-up question.',
    '- Do not ask a follow-up question just because the request is brief; act when the target can be resolved from the current user message, an explicit filename, or the `index-v1.html` default.',
    '',
    '- Cross-page links should target concrete version files such as `detail-v2.html`; do not assume a stable `detail.html` entry file exists.',
    '- Do not overwrite an existing HTML version for a new page; create the next version only when the current task is explicitly based on an existing page.',
    '- In duplicate_edit mode, do not update `.owndesign-pages.json` unless the user explicitly asks to rename the page display name.',
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
    '- Use `copyFile` when the current user message asks you to duplicate an existing file before editing the duplicate.',
    '',
    'For HTML pages:',
    '- Do not modify unrelated HTML files unless the requested change requires coordinated edits.',
    '- Use `createHtml` when the target HTML file does not exist; do not create initial HTML with `write`.',
    '- For `createHtml`, pass the resolved target path. Pass `fontLibraryName` or `iconLibraryName` only when the user explicitly names a font or icon library; otherwise omit them so the tool reads configured defaults.',
    '- After `createHtml`, immediately use `read` on that file before editing it.',
    '- If the target HTML file exists, use `read` before editing it; do not call `createHtml`.',
    '- Use `edit` or `patch` for HTML changes after reading the file.',
    '',
    'Recover from tool failures:',
    '- If `edit` cannot find the expected text, `read` the file again and retry with a smaller replacement or `patch`.',
    '- If a write tool returns an error or produces unexpected output, read the file again before retrying.',
    '',
    'Resource constraints:',
    '- Only use CDNs already listed in resource settings; do not add others.',
    '- `write`, `edit`, and `patch` will reject HTML with unlisted CDN tags - if rejected, fall back to configured libraries, system fonts, inline SVG, or local CSS.',
    '',
    'Component audit:',
    '- After completing any HTML creation, edit, duplicate edit, or new-page design task, call `componentAudit` before the final reply.',
    '- `componentAudit` runs a read-only sub-agent. Use it for checking only; do not treat it as a replacement for editing files yourself.',
    '- If `componentAudit` returns high severity findings, fix those required issues and call `componentAudit` again before replying.',
    '- For high severity navigation findings, create or reuse a `navigation` shared component and call `syncSharedComponent`.',
    '- Medium and low severity findings are suggestions. Do not automatically fix them unless they are clearly part of the user request; mention relevant ones briefly in the final reply.',
  ].join('\n');
}

export function buildSharedComponentsPrompt() {
  return [
    '## Shared Components',
    'Use shared component fragments to keep repeated UI consistent across multi-page HTML projects.',
    '',
    'Component library convention:',
    '- Before designing a new page in a multi-page project, inspect `.owndesign-components.json` and reuse existing components when they fit.',
    '- Store source fragments at `components/{name}.html`, such as `components/nav.html` or `components/product-card.html`.',
    '- Component fragments may include ordinary `<style>` plus HTML markup; do not use the obsolete `<style scoped>` attribute.',
    '- Use the manifest component name as the component ID. Give the component root `data-owndesign-component="{name}"` and a stable root class `odc-{name}`, such as `.odc-nav`.',
    '- Component CSS selectors must be scoped through the root class, such as `.odc-nav .nav-link.active`. Avoid broad component styles like `body`, `a`, `button`, `.active`, or `.card` as selector entrypoints.',
    '- Insert expanded component markup into HTML pages inside `<!-- owndesign:component {name} start -->` and `<!-- owndesign:component {name} end -->` markers.',
    '- Maintain `.owndesign-components.json` with `{ "components": [{ "name": "nav", "source": "components/nav.html", "usedBy": ["index-v1.html"], "syncMode": "navigation", "description": "Site navigation" }] }`.',
    '',
    'Sync modes:',
    '- `exact`: shared content should remain identical across pages. Use for footer, CTA band, newsletter, testimonial, and other fixed repeated sections.',
    '- `navigation`: shared navigation structure should sync across pages while active state changes by page. Nav items must use `data-owndesign-nav-item="{slug}"`; `syncSharedComponent` adds `class="active"` and `aria-current="page"` for the current page slug.',
    '- `pattern`: shared design pattern template only. Use for product-card, pricing-card, form-field, stat-card, article-card, and other components whose structure/style repeats but content differs. Do not auto-sync pattern instances unless the user explicitly asks.',
    '',
    'Editing marked component instances:',
    '- Treat any HTML inside `<!-- owndesign:component NAME start -->` and `<!-- owndesign:component NAME end -->` as a shared component instance, even if `.owndesign-components.json` is missing.',
    '- Before changing content inside a component marker, decide whether the request is a component-level change or a current-page instance change.',
    '- For component-level changes, update `components/{name}.html` and use `syncSharedComponent`; do not directly hand-edit the current page marker contents.',
    '- Navigation text, nav items, top nav, sidebar nav, active styling, and nav links default to component-level changes for `navigation` components unless the user explicitly says the change is page-local.',
    '- Marker content for `exact` components defaults to component-level changes. Marker content for `pattern` components defaults to current-page instance changes unless the user asks to update the shared template, structure, or unified styling.',
    '- For explicit current-page instance changes, edit only the current HTML page and intentionally preserve or remove the component markers based on whether the instance should remain shared.',
    '',
    'Workflow:',
    '- When creating or editing a page in a multi-page project, inspect `.owndesign-components.json` before designing shared site structure.',
    '- For `exact` and `navigation` components, place the necessary component-scoped CSS inside the fragment so structure and styling sync together.',
    '- For `pattern` components, keep useful scoped styles in the template, but do not auto-sync pattern instances unless the user explicitly asks.',
    '- Navigation is the highest-priority shared component: if pages in the same site use the same top nav or sidebar nav, create or reuse a `navigation` component unless the user explicitly asks for page-specific navigation.',
    '- When expanding a one-page site into a second page, upgrade shared top nav or sidebar nav into a `navigation` component when both pages should use the same site navigation.',
    '- When adding a new page to an existing site, reuse shared navigation before inventing a new visual variant, and update the shared nav links when appropriate.',
    '- Extract other components only when reuse is likely and visual consistency matters. Avoid extracting one-off sections, content-heavy sections, or modules that are intentionally different on each page.',
    '- When the user asks to change a whole-site, shared, repeated, or unified component, use `syncSharedComponent` with the right syncMode.',
    '- `syncSharedComponent` only updates pages that already contain matching markers; insert markers with normal HTML edits when adding a new page.',
    '- For one-page local changes, edit the current HTML page directly.',
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
