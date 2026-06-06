import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AiSdkDesignPageAgent,
  buildDesignPageAgentInstructions,
  createDesignPageAgentContext,
  buildProviderOptions,
} from './design-page-agent';
import { buildTurnPromptRewriterPrompt, rewriteTurnPrompt } from './turn-prompt-rewriter';
import { createWorkspaceToolRegistry } from './tools/core';
import { createProjectWorkspaceToolDefinitions } from './tools/project-workspace-tools';
import { HTML_SHARED_COMPONENTS_MANIFEST_PATH } from '@owndesign/core/html-shared-components';
import { loadPrompt } from '@owndesign/core/prompts';
import { WorkspaceStore } from '@owndesign/core/workspace-store';

const aiMocks = vi.hoisted(() => {
  const generate = vi.fn();
  const toolLoopAgent = vi.fn(function (
    this: { config?: unknown; generate?: unknown },
    config: unknown,
  ) {
    this.config = config;
    this.generate = generate;
  });

  return {
    createAnthropic: vi.fn(() => vi.fn((modelId: string) => ({ modelId, provider: 'anthropic' }))),
    createDeepSeek: vi.fn(() => vi.fn((modelId: string) => ({ modelId, provider: 'deepseek' }))),
    createOpenAICompatible: vi.fn(() =>
      vi.fn((modelId: string) => ({
        modelId,
        provider: 'openai-compatible',
      })),
    ),
    generate,
    generateText: vi.fn(),
    getSettings: vi.fn(),
    resolveModelConfiguration: vi.fn(),
    sendFrontendCommand: vi.fn(),
    toolLoopAgent,
  };
});

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: aiMocks.createAnthropic,
}));

vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: aiMocks.createDeepSeek,
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: aiMocks.createOpenAICompatible,
}));

vi.mock('@owndesign/core/settings/settings-service', () => ({
  createSettingsService: () => ({
    getSettings: aiMocks.getSettings,
    resolveModelConfiguration: aiMocks.resolveModelConfiguration,
  }),
}));

vi.mock('@owndesign/core/realtime/frontend-command-bus', () => ({
  sendFrontendCommand: aiMocks.sendFrontendCommand,
}));

vi.mock('ai', () => ({
  generateText: aiMocks.generateText,
  stepCountIs: vi.fn((count: number) => ({ count, type: 'stepCountIs' })),
  tool: vi.fn((config: unknown) => config),
  ToolLoopAgent: aiMocks.toolLoopAgent,
}));

const tempRoots: string[] = [];

const defaultResources = {
  fontLibraries: [
    {
      id: 'font-1',
      name: 'Configured Font',
      cdn: 'https://cdn.example.com/font.css',
      isDefault: true,
    },
    {
      id: 'font-2',
      name: 'Alt Font',
      cdn: '',
      isDefault: false,
    },
  ],
  iconLibraries: [
    {
      id: 'icon-1',
      name: 'Configured Icons',
      cdn: 'https://cdn.example.com/icons.js',
      isDefault: true,
    },
  ],
};

beforeEach(() => {
  aiMocks.createDeepSeek.mockClear();
  aiMocks.createAnthropic.mockClear();
  aiMocks.createOpenAICompatible.mockClear();
  aiMocks.generate.mockReset();
  aiMocks.generateText.mockReset();
  aiMocks.generateText.mockResolvedValue({ text: 'rewritten prompt' });
  aiMocks.getSettings.mockReset();
  aiMocks.getSettings.mockResolvedValue({
    resources: defaultResources,
  });
  aiMocks.resolveModelConfiguration.mockReset();
  aiMocks.resolveModelConfiguration.mockResolvedValue({
    apiKey: 'secret',
    baseUrl: 'https://api.deepseek.com',
    contextSizeK: 1000,
    id: 'model-1',
    model: 'deepseek-v4-flash',
    provider: 'deepseek',
  });
  aiMocks.sendFrontendCommand.mockReset();
  aiMocks.sendFrontendCommand.mockReturnValue({ delivered: true });
  aiMocks.toolLoopAgent.mockClear();
});

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (tempRoot) => {
      await rm(tempRoot, { force: true, recursive: true });
    }),
  );
});

describe('AiSdkDesignPageAgent', () => {
  it('loads design page prompt from the prompt registry', () => {
    expect(loadPrompt('agents/design-page')).toContain('# Design Page Agent');
  });

  it('writes Project Workspace files when the model calls write', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockImplementationOnce(
      async function (this: {
        config: {
          tools: {
            write: {
              execute: (input: { content: string; path: string }) => Promise<unknown>;
            };
          };
        };
      }) {
        await this.config.tools.write.execute({
          content: '<!doctype html><html><body><main>CRM Dashboard</main></body></html>',
          path: 'index.html',
        });

        return { text: '已生成 HTML 页面。' };
      },
    );

    const result = await agent.generateProjectOutput(buildInput());

    expect(result).toEqual({ content: '已生成 HTML 页面。' });
    await expect(
      readFile(
        path.join(
          workspaceStore.getWorkspaceRoot(),
          'projects',
          'project-1',
          'workspace',
          'index.html',
        ),
        'utf8',
      ),
    ).resolves.toContain('CRM Dashboard');
  });

  it('allows normal assistant messages without writing Project Output', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({
      text: '需要确认：这是后台管理界面还是营销落地页？',
    });

    const result = await agent.generateProjectOutput(buildInput());

    expect(result).toEqual({
      content: '需要确认：这是后台管理界面还是营销落地页？',
    });
    await expect(workspaceStore.readProjectOutput('project-1', 'html')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('configures the agent to ask follow-up questions only when page target remains ambiguous', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    expect(aiMocks.createDeepSeek).toHaveBeenCalledWith({
      apiKey: 'secret',
      baseURL: 'https://api.deepseek.com',
    });
    expect(aiMocks.toolLoopAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        allowSystemInMessages: true,
        instructions: expect.stringContaining(
          'Ask a follow-up question only when the target page remains ambiguous',
        ),
        providerOptions: {
          deepseek: {
            thinking: { type: 'enabled' },
            reasoningEffort: 'high',
          },
        },
      }),
    );
  });

  it('maps DeepSeek thinking modes to provider options', () => {
    const configuration = {
      apiKey: 'secret',
      baseUrl: '',
      contextSizeK: 1000,
      id: 'model-1',
      model: 'deepseek-chat',
      provider: 'deepseek' as const,
    };

    expect(buildProviderOptions(configuration, { deepseek: 'disabled' })).toEqual({
      deepseek: {
        thinking: { type: 'disabled' },
      },
    });
    expect(buildProviderOptions(configuration, { deepseek: 'max' })).toEqual({
      deepseek: {
        thinking: { type: 'enabled' },
        reasoningEffort: 'max',
      },
    });
  });

  it('maps Anthropic effort selection to provider options', () => {
    const configuration = {
      apiKey: 'secret',
      baseUrl: '',
      contextSizeK: 200,
      id: 'model-1',
      model: 'claude-sonnet-4-5',
      provider: 'anthropic' as const,
    };

    expect(buildProviderOptions(configuration)).toBeUndefined();
    expect(buildProviderOptions(configuration, { anthropic: 'xhigh' })).toEqual({
      anthropic: {
        thinking: { type: 'adaptive' },
        effort: 'xhigh',
      },
    });
  });

  it('creates Anthropic language models with optional base URL', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    aiMocks.resolveModelConfiguration.mockResolvedValueOnce({
      apiKey: 'anthropic-key',
      baseUrl: '',
      contextSizeK: 200,
      id: 'model-1',
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
    });

    const context = await createDesignPageAgentContext({
      outputType: 'html',
      projectId: 'project-1',
      providerOptionsSelection: { anthropic: 'max' },
      workspaceStore,
    });

    expect(aiMocks.createAnthropic).toHaveBeenCalledWith({
      apiKey: 'anthropic-key',
      baseURL: undefined,
    });
    expect(context.model).toEqual({
      modelId: 'claude-sonnet-4-5',
      provider: 'anthropic',
    });
    expect(context.providerOptions).toEqual({
      anthropic: {
        thinking: { type: 'adaptive' },
        effort: 'max',
      },
    });
  });

  it('creates a design agent context from settings, model selection, and preview state', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);

    const context = await createDesignPageAgentContext({
      currentPreviewPath: 'dashboard.html',
      modelConfigurationId: 'model-1',
      outputType: 'html',
      projectId: 'project-1',
      providerOptionsSelection: { deepseek: 'max' },
      workspaceStore,
    });

    expect(aiMocks.resolveModelConfiguration).toHaveBeenCalledWith('model-1');
    expect(context).toMatchObject({
      currentPreviewPath: 'dashboard.html',
      outputType: 'html',
      projectId: 'project-1',
      providerOptions: {
        deepseek: {
          thinking: { type: 'enabled' },
          reasoningEffort: 'max',
        },
      },
      resources: defaultResources,
      workspaceStore,
    });
    expect(context.model).toEqual({
      modelId: 'deepseek-v4-flash',
      provider: 'deepseek',
    });
  });

  it('registers Project Workspace file tools', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: Record<string, unknown>;
    };
    expect(Object.keys(config.tools).sort()).toEqual([
      'copyFile',
      'createHtml',
      'delete',
      'edit',
      'glob',
      'grep',
      'patch',
      'previewRefresh',
      'previewSwitchHtml',
      'read',
      'syncSharedComponent',
      'write',
    ]);
    expect(config.tools).not.toHaveProperty('callFrontendCapability');
    expect(config.tools).not.toHaveProperty('writeFile');
    expect(config.tools).not.toHaveProperty('addCdnResource');
  });

  it('builds Project Workspace tools from one registry with metadata', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        __metadata: Record<string, { parallelSafe: boolean }>;
        patch: { inputSchema: { safeParse: (input: unknown) => { success: boolean } } };
        previewRefresh: { inputSchema: { safeParse: (input: unknown) => { success: boolean } } };
        previewSwitchHtml: { inputSchema: { safeParse: (input: unknown) => { success: boolean } } };
        read: { inputSchema: { safeParse: (input: unknown) => { success: boolean } } };
        syncSharedComponent: {
          inputSchema: { safeParse: (input: unknown) => { success: boolean } };
        };
      };
    };
    expect(config.tools.__metadata.read).toEqual({ parallelSafe: true });
    expect(config.tools.__metadata.patch).toEqual({ parallelSafe: false });
    expect(config.tools.read.inputSchema.safeParse({ path: 'index.html' }).success).toBe(true);
    expect(
      config.tools.read.inputSchema.safeParse({
        extra: true,
        path: 'index.html',
      }).success,
    ).toBe(false);
    expect(config.tools.previewRefresh.inputSchema.safeParse({}).success).toBe(true);
    expect(config.tools.previewRefresh.inputSchema.safeParse({ path: 'index.html' }).success).toBe(
      false,
    );
    expect(
      config.tools.previewSwitchHtml.inputSchema.safeParse({ path: 'index.html' }).success,
    ).toBe(true);
    expect(config.tools.previewSwitchHtml.inputSchema.safeParse({}).success).toBe(false);
    expect(
      config.tools.syncSharedComponent.inputSchema.safeParse({
        content: '<nav>Updated</nav>',
        description: '全站顶部导航',
        name: 'nav',
        syncMode: 'navigation',
        usedBy: ['index.html'],
      }).success,
    ).toBe(true);
    expect(
      config.tools.patch.inputSchema.safeParse({
        changes: [
          {
            content: '<main>Home</main>',
            operation: 'write',
            path: 'index.html',
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      config.tools.patch.inputSchema.safeParse({
        changes: [{ operation: 'write', path: 'index.html' }],
      }).success,
    ).toBe(false);
    expect(
      config.tools.patch.inputSchema.safeParse({
        changes: [
          {
            content: 'unexpected',
            newString: 'new',
            oldString: 'old',
            operation: 'edit',
            path: 'index.html',
          },
        ],
      }).success,
    ).toBe(false);
    expect(config.tools.patch.inputSchema.safeParse({ changes: [] }).success).toBe(false);

    const definitions = createProjectWorkspaceToolDefinitions();
    expect(() =>
      createWorkspaceToolRegistry([definitions[0], definitions[0]], {
        projectId: 'project-1',
        resources: defaultResources,
        workspaceStore,
      }),
    ).toThrow('already registered');
  });

  it('includes shared component workflow instructions', () => {
    const instructions = buildDesignPageAgentInstructions(defaultResources);

    expect(instructions).toContain('syncSharedComponent');
    expect(instructions).toContain('syncMode');
    expect(instructions).toContain('pattern');
    expect(instructions).toContain('data-owndesign-nav-item');
    expect(instructions).toContain('ordinary `<style>` plus HTML markup');
    expect(instructions).toContain('do not use the obsolete `<style scoped>` attribute');
    expect(instructions).toContain('data-owndesign-component="{name}"');
    expect(instructions).toContain('odc-{name}');
    expect(instructions).toContain('.odc-nav .nav-link.active');
    expect(instructions).toContain('Avoid broad component styles like `body`, `a`, `button`');
    expect(instructions).toContain('structure and styling sync together');
    expect(instructions).toContain('Editing marked component instances');
    expect(instructions).toContain(
      'as a shared component instance, even if `.owndesign-components.json` is missing',
    );
    expect(instructions).toContain(
      'decide whether the request is a component-level change or a current-page instance change',
    );
    expect(instructions).toContain('update `components/{name}.html` and use `syncSharedComponent`');
    expect(instructions).toContain('do not directly hand-edit the current page marker contents');
    expect(instructions).toContain(
      'Navigation text, nav items, top nav, sidebar nav, active styling, and nav links default to component-level changes',
    );
    expect(instructions).toContain('Marker content for `exact` components defaults');
    expect(instructions).toContain(
      'Marker content for `pattern` components defaults to current-page instance changes',
    );
    expect(instructions).toContain('Navigation is the highest-priority shared component');
    expect(instructions).toContain('expanding a one-page site into a second page');
    expect(instructions).toContain('reuse shared navigation before inventing a new visual variant');
    expect(instructions).toContain(
      'Avoid extracting one-off sections, content-heavy sections, or modules that are intentionally different on each page',
    );
    expect(instructions).toContain('<!-- owndesign:component {name} start -->');
  });

  it('syncs shared component source into marked HTML pages', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index.html',
      [
        '<main>',
        '<!-- owndesign:component nav start -->',
        '<nav>Old</nav>',
        '<!-- owndesign:component nav end -->',
        '</main>',
      ].join('\n'),
    );
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'detail.html',
      [
        '<main>',
        '<!-- owndesign:component nav start -->',
        '<nav>Old</nav>',
        '<!-- owndesign:component nav end -->',
        '</main>',
      ].join('\n'),
    );
    await workspaceStore.writeProjectWorkspaceFile('project-1', 'plain.html', '<main>Plain</main>');
    const tools = createWorkspaceToolRegistry(createProjectWorkspaceToolDefinitions(), {
      approvedCdnUrls: ['https://cdn.example.com/font.css', 'https://cdn.example.com/icons.js'],
      projectId: 'project-1',
      resources: defaultResources,
      workspaceStore,
    }) as unknown as {
      syncSharedComponent: {
        execute: (input: { content?: string; name: string; usedBy?: string[] }) => Promise<unknown>;
      };
    };

    await expect(
      expectWorkspaceToolOk<{
        manifestUpdated: boolean;
        skippedPages: string[];
        source: string;
        updatedPages: string[];
      }>(
        tools.syncSharedComponent.execute({
          content: [
            '<style>',
            '.odc-nav { display: flex; gap: 16px; }',
            '</style>',
            '<nav class="odc-nav" data-owndesign-component="nav">New</nav>',
          ].join('\n'),
          name: 'nav',
          usedBy: ['index.html', 'detail.html', 'plain.html', 'notes.txt', 'missing.html'],
        }),
      ),
    ).resolves.toEqual({
      manifestUpdated: true,
      skippedPages: ['plain.html', 'notes.txt', 'missing.html'],
      source: 'components/nav.html',
      updatedPages: ['index.html', 'detail.html'],
    });
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'components/nav.html'),
    ).resolves.toBe(
      [
        '<style>',
        '.odc-nav { display: flex; gap: 16px; }',
        '</style>',
        '<nav class="odc-nav" data-owndesign-component="nav">New</nav>',
      ].join('\n'),
    );
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'index.html'),
    ).resolves.toContain('.odc-nav { display: flex; gap: 16px; }');
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'index.html'),
    ).resolves.toContain('<nav class="odc-nav" data-owndesign-component="nav">New</nav>');
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', HTML_SHARED_COMPONENTS_MANIFEST_PATH),
    ).resolves.toContain('"usedBy": [\n        "index.html",\n        "detail.html"\n      ]');
  });

  it('syncs navigation active state for each target page', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const markedNav = [
      '<!-- owndesign:component nav start -->',
      '<nav>Old</nav>',
      '<!-- owndesign:component nav end -->',
    ].join('\n');
    await workspaceStore.writeProjectWorkspaceFile('project-1', 'index-v1.html', markedNav);
    await workspaceStore.writeProjectWorkspaceFile('project-1', 'products-v2.html', markedNav);
    const tools = createWorkspaceToolRegistry(createProjectWorkspaceToolDefinitions(), {
      approvedCdnUrls: ['https://cdn.example.com/font.css', 'https://cdn.example.com/icons.js'],
      projectId: 'project-1',
      resources: defaultResources,
      workspaceStore,
    }) as unknown as {
      syncSharedComponent: {
        execute: (input: {
          content: string;
          name: string;
          syncMode: 'navigation';
          usedBy: string[];
        }) => Promise<unknown>;
      };
    };

    await expectWorkspaceToolOk(
      tools.syncSharedComponent.execute({
        content: [
          '<style>',
          '.odc-nav { display: flex; gap: 16px; }',
          '.odc-nav .nav-link.active { font-weight: 700; }',
          '</style>',
          '<nav class="odc-nav" data-owndesign-component="nav">',
          '<a class="nav-link active" aria-current="page" href="index-v1.html" data-owndesign-nav-item="index">Home</a>',
          '<a class="nav-link" href="products-v2.html" data-owndesign-nav-item="products">Products</a>',
          '</nav>',
        ].join('\n'),
        name: 'nav',
        syncMode: 'navigation',
        usedBy: ['index-v1.html', 'products-v2.html'],
      }),
    );

    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'index-v1.html'),
    ).resolves.toContain('.odc-nav .nav-link.active { font-weight: 700; }');
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'index-v1.html'),
    ).resolves.toContain(
      '<a class="nav-link active" href="index-v1.html" data-owndesign-nav-item="index" aria-current="page">Home</a>',
    );
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'products-v2.html'),
    ).resolves.toContain(
      '<a class="nav-link active" href="products-v2.html" data-owndesign-nav-item="products" aria-current="page">Products</a>',
    );
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'products-v2.html'),
    ).resolves.toContain(
      '<a class="nav-link" href="index-v1.html" data-owndesign-nav-item="index">Home</a>',
    );
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'components/nav.html'),
    ).resolves.toContain(
      '<a class="nav-link" href="index-v1.html" data-owndesign-nav-item="index">Home</a>',
    );
  });

  it('updates pattern components without syncing page instances', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index.html',
      [
        '<!-- owndesign:component product-card start -->',
        '<article>Old instance</article>',
        '<!-- owndesign:component product-card end -->',
      ].join('\n'),
    );
    const tools = createWorkspaceToolRegistry(createProjectWorkspaceToolDefinitions(), {
      approvedCdnUrls: ['https://cdn.example.com/font.css', 'https://cdn.example.com/icons.js'],
      projectId: 'project-1',
      resources: defaultResources,
      workspaceStore,
    }) as unknown as {
      syncSharedComponent: {
        execute: (input: {
          content: string;
          description: string;
          name: string;
          syncMode: 'pattern';
          usedBy: string[];
        }) => Promise<unknown>;
      };
    };

    await expect(
      expectWorkspaceToolOk<{ skippedPages: string[]; updatedPages: string[] }>(
        tools.syncSharedComponent.execute({
          content: '<article>Template only</article>',
          description: '商品卡片视觉模板',
          name: 'product-card',
          syncMode: 'pattern',
          usedBy: ['index.html'],
        }),
      ),
    ).resolves.toMatchObject({
      skippedPages: [],
      updatedPages: [],
    });
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'components/product-card.html'),
    ).resolves.toBe('<article>Template only</article>');
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'index.html'),
    ).resolves.toContain('<article>Old instance</article>');
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', HTML_SHARED_COMPONENTS_MANIFEST_PATH),
    ).resolves.toContain('"syncMode": "pattern"');
  });

  it('finds marked pages when sync shared component usedBy is omitted', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'components/nav.html',
      '<nav>Source</nav>',
    );
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index.html',
      [
        '<!-- owndesign:component nav start -->',
        '<nav>Old</nav>',
        '<!-- owndesign:component nav end -->',
      ].join('\n'),
    );
    const tools = createWorkspaceToolRegistry(createProjectWorkspaceToolDefinitions(), {
      approvedCdnUrls: ['https://cdn.example.com/font.css', 'https://cdn.example.com/icons.js'],
      projectId: 'project-1',
      resources: defaultResources,
      workspaceStore,
    }) as unknown as {
      syncSharedComponent: {
        execute: (input: { name: string }) => Promise<unknown>;
      };
    };

    await expect(
      expectWorkspaceToolOk<{ updatedPages: string[] }>(
        tools.syncSharedComponent.execute({ name: 'nav' }),
      ),
    ).resolves.toMatchObject({
      updatedPages: ['index.html'],
    });
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'index.html'),
    ).resolves.toContain('<nav>Source</nav>');
  });

  it('keeps html CDN guard active when syncing shared components', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index.html',
      [
        '<main>',
        '<!-- owndesign:component nav start -->',
        '<nav>Old</nav>',
        '<!-- owndesign:component nav end -->',
        '</main>',
      ].join('\n'),
    );
    const tools = createWorkspaceToolRegistry(createProjectWorkspaceToolDefinitions(), {
      approvedCdnUrls: [],
      projectId: 'project-1',
      resources: defaultResources,
      workspaceStore,
    }) as unknown as {
      syncSharedComponent: {
        execute: (input: { content: string; name: string; usedBy: string[] }) => Promise<unknown>;
      };
    };

    await expectWorkspaceToolError(
      tools.syncSharedComponent.execute({
        content: '<nav><script src="https://cdn.example.com/nav.js"></script></nav>',
        name: 'nav',
        usedBy: ['index.html'],
      }),
      'HTML files can only use CDN resources configured in settings',
    );
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'components/nav.html'),
    ).rejects.toThrow('ENOENT');
  });

  it('creates missing HTML from configured resource defaults', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        createHtml: {
          execute: (input: { path: string; title?: string }) => Promise<unknown>;
        };
      };
    };
    await expect(
      expectWorkspaceToolOk(
        config.tools.createHtml.execute({
          path: 'index.html',
          title: 'CRM Dashboard',
        }),
      ),
    ).resolves.toMatchObject({
      fontLibrary: {
        cdn: 'https://cdn.example.com/font.css',
        name: 'Configured Font',
      },
      iconLibrary: {
        cdn: 'https://cdn.example.com/icons.js',
        name: 'Configured Icons',
      },
      path: 'index.html',
      title: 'CRM Dashboard',
    });

    const html = await workspaceStore.readProjectWorkspaceFile('project-1', 'index.html');
    expect(html).toContain('<main id="app"></main>');
    expect(html).toContain("@import url('https://cdn.example.com/font.css');");
    expect(html).toContain(
      '<script src="https://cdn.example.com/icons.js" data-owndesign-approved-cdn="true"></script>',
    );
    expect(html).not.toContain('tailwindcss');
  });

  it('creates HTML with explicit resource selections', async () => {
    aiMocks.getSettings.mockResolvedValueOnce({
      resources: {
        fontLibraries: [
          {
            id: 'font-1',
            name: 'Default Font',
            cdn: 'https://cdn.example.com/default-font.css',
            isDefault: true,
          },
          {
            id: 'font-2',
            name: 'Display Font',
            cdn: '',
            isDefault: false,
          },
        ],
        iconLibraries: [
          {
            id: 'icon-1',
            name: 'Default Icons',
            cdn: 'https://cdn.example.com/default-icons.js',
            isDefault: true,
          },
          {
            id: 'icon-2',
            name: 'Font Awesome',
            cdn: 'https://cdn.example.com/font-awesome.css',
            isDefault: false,
          },
        ],
      },
    });
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        createHtml: {
          execute: (input: {
            fontLibraryName?: string;
            iconLibraryName?: string;
            path: string;
          }) => Promise<unknown>;
        };
      };
    };
    await expect(
      expectWorkspaceToolOk(
        config.tools.createHtml.execute({
          fontLibraryName: 'Display Font',
          iconLibraryName: 'Font Awesome',
          path: 'pages/detail.html',
        }),
      ),
    ).resolves.toMatchObject({
      fontLibrary: { cdn: '', name: 'Display Font' },
      iconLibrary: {
        cdn: 'https://cdn.example.com/font-awesome.css',
        name: 'Font Awesome',
      },
      path: 'pages/detail.html',
    });

    const html = await workspaceStore.readProjectWorkspaceFile('project-1', 'pages/detail.html');
    expect(html).not.toContain('default-font.css');
    expect(html).not.toContain('Display Font');
    expect(html).toContain('https://cdn.example.com/font-awesome.css');
    expect(html).not.toContain('tailwindcss');
  });

  it('allows explicit resource disabling during HTML creation', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        createHtml: {
          execute: (input: {
            fontLibraryName?: string;
            iconLibraryName?: string;
            path: string;
          }) => Promise<unknown>;
        };
      };
    };
    await config.tools.createHtml.execute({
      fontLibraryName: '',
      iconLibraryName: '',
      path: 'index.html',
    });

    const html = await workspaceStore.readProjectWorkspaceFile('project-1', 'index.html');
    expect(html).not.toContain('cdn.example.com/font.css');
    expect(html).not.toContain('cdn.example.com/icons.js');
    expect(html).not.toContain('tailwindcss');
  });

  it('rejects invalid or existing HTML initialization targets', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index.html',
      '<main>Existing</main>',
    );
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        createHtml: {
          execute: (input: {
            fontLibraryName?: string;
            iconLibraryName?: string;
            path: string;
          }) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.createHtml.execute({ path: 'index.html' }),
      'already exists',
    );
    await expectWorkspaceToolError(
      config.tools.createHtml.execute({ path: 'notes.txt' }),
      'must end with .html',
    );
    await expectWorkspaceToolError(
      config.tools.createHtml.execute({ path: '../escape.html' }),
      'escapes workspace',
    );
    await expectWorkspaceToolError(
      config.tools.createHtml.execute({
        fontLibraryName: 'Missing Font',
        path: 'new.html',
      }),
      'Configured font library was not found',
    );
    await expect(workspaceStore.readProjectWorkspaceFile('project-1', 'index.html')).resolves.toBe(
      '<main>Existing</main>',
    );
  });

  it('reads files with line windows and finds workspace files with glob and grep', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index.html',
      '<main>\n  <h1>CRM Dashboard</h1>\n</main>',
    );
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'assets/app.css',
      '.hero { color: red; }',
    );
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        glob: {
          execute: (input: { pattern: string }) => Promise<unknown>;
        };
        grep: {
          execute: (input: { include?: string; pattern: string }) => Promise<unknown>;
        };
        read: {
          execute: (input: { limit?: number; offset?: number; path: string }) => Promise<unknown>;
        };
      };
    };
    await expect(
      expectWorkspaceToolOk(config.tools.read.execute({ limit: 1, offset: 2, path: 'index.html' })),
    ).resolves.toMatchObject({
      content: '2:   <h1>CRM Dashboard</h1>',
      path: 'index.html',
      startLine: 2,
      type: 'file',
    });
    await expect(
      expectWorkspaceToolOk(config.tools.glob.execute({ pattern: '**/*.css' })),
    ).resolves.toMatchObject({
      matches: [
        expect.objectContaining({
          path: 'assets/app.css',
          type: 'file',
        }),
      ],
    });
    await expect(
      expectWorkspaceToolOk(
        config.tools.grep.execute({ include: '*.html', pattern: 'CRM\\s+Dashboard' }),
      ),
    ).resolves.toMatchObject({
      matches: [
        {
          line: 2,
          path: 'index.html',
          preview: '<h1>CRM Dashboard</h1>',
        },
      ],
    });
  });

  it('edits files with replaceAll support', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index.html',
      '<button>Save</button><button>Save</button>',
    );
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        edit: {
          execute: (input: {
            newString: string;
            oldString: string;
            path: string;
            replaceAll?: boolean;
          }) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.edit.execute({
        newString: 'Submit',
        oldString: 'Save',
        path: 'index.html',
      }),
      'oldString appears more than once',
    );
    await expect(
      expectWorkspaceToolOk(
        config.tools.edit.execute({
          newString: 'Submit',
          oldString: 'Save',
          path: 'index.html',
          replaceAll: true,
        }),
      ),
    ).resolves.toMatchObject({
      path: 'index.html',
      replacements: 2,
    });
    await expect(workspaceStore.readProjectWorkspaceFile('project-1', 'index.html')).resolves.toBe(
      '<button>Submit</button><button>Submit</button>',
    );
  });

  it('applies coordinated patch changes inside the Project Workspace', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile('project-1', 'index.html', '<main>Old</main>');
    await workspaceStore.writeProjectWorkspaceFile('project-1', 'stale.txt', 'delete me');
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        patch: {
          execute: (input: {
            changes: Array<
              | {
                  content: string;
                  operation: 'add' | 'write';
                  path: string;
                }
              | {
                  newString: string;
                  oldString: string;
                  operation: 'edit';
                  path: string;
                }
              | {
                  operation: 'delete';
                  path: string;
                }
            >;
          }) => Promise<unknown>;
        };
      };
    };
    await expect(
      expectWorkspaceToolOk(
        config.tools.patch.execute({
          changes: [
            {
              newString: 'New',
              oldString: 'Old',
              operation: 'edit',
              path: 'index.html',
            },
            {
              content: '.hero { color: red; }',
              operation: 'add',
              path: 'assets/app.css',
            },
            {
              operation: 'delete',
              path: 'stale.txt',
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({
      changed: 3,
    });
    await expect(workspaceStore.readProjectWorkspaceFile('project-1', 'index.html')).resolves.toBe(
      '<main>New</main>',
    );
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'assets/app.css'),
    ).resolves.toBe('.hero { color: red; }');
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'stale.txt'),
    ).rejects.toThrow();
  });

  it('rejects patch changes that escape the Project Workspace', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        patch: {
          execute: (input: {
            changes: Array<{
              content: string;
              operation: 'write';
              path: string;
            }>;
          }) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.patch.execute({
        changes: [
          {
            content: 'bad',
            operation: 'write',
            path: '../escape.html',
          },
        ],
      }),
      'escapes workspace',
    );
  });

  it('does not partially apply patch changes when CDN validation fails', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index.html',
      '<!doctype html><html><head></head><body><main>Old</main></body></html>',
    );
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        patch: {
          execute: (input: {
            changes: Array<
              | {
                  content: string;
                  operation: 'write';
                  path: string;
                }
              | {
                  newString: string;
                  oldString: string;
                  operation: 'edit';
                  path: string;
                }
            >;
          }) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.patch.execute({
        changes: [
          {
            newString: 'New',
            oldString: 'Old',
            operation: 'edit',
            path: 'index.html',
          },
          {
            content:
              '<!doctype html><html><head><script src="https://cdn.example.com/raw.js"></script></head><body></body></html>',
            operation: 'write',
            path: 'blocked.html',
          },
        ],
      }),
      'can only use CDN resources configured in settings',
    );
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'index.html'),
    ).resolves.toContain('Old');
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'blocked.html'),
    ).rejects.toThrow();
  });

  it('rejects invalid discriminated patch changes before execution', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        patch: {
          execute: (input: unknown) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.patch.execute({
        changes: [{ operation: 'edit', path: 'index.html', oldString: 'Old' }],
      }),
      'newString',
    );
    await expectWorkspaceToolError(
      config.tools.patch.execute({
        changes: [{ operation: 'write', path: 'index.html' }],
      }),
      'content',
    );
    await expectWorkspaceToolError(
      config.tools.patch.execute({
        changes: [{ content: 'bad', operation: 'delete', path: 'index.html' }],
      }),
      'content',
    );
  });

  it('rejects unconfigured CDN additions through write', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        write: {
          execute: (input: { content: string; path: string }) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.write.execute({
        content:
          '<!doctype html><html><head><link rel="stylesheet" href="https://cdn.example.com/raw.css"></head><body></body></html>',
        path: 'index.html',
      }),
      'can only use CDN resources configured in settings',
    );
  });

  it('rejects unconfigured CDN additions through edit', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index.html',
      '<!doctype html><html><head></head><body></body></html>',
    );
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        edit: {
          execute: (input: {
            newString: string;
            oldString: string;
            path: string;
          }) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.edit.execute({
        newString: '<script src="https://cdn.example.com/raw.js"></script></body>',
        oldString: '</body>',
        path: 'index.html',
      }),
      'can only use CDN resources configured in settings',
    );
  });

  it('rejects unconfigured CSS imports through write', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        write: {
          execute: (input: { content: string; path: string }) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.write.execute({
        content:
          "<!doctype html><html><head><style>@import url('https://cdn.example.com/raw-font.css');</style></head><body></body></html>",
        path: 'index.html',
      }),
      'can only use CDN resources configured in settings',
    );
  });

  it('allows configured CDN additions through write', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        write: {
          execute: (input: { content: string; path: string }) => Promise<unknown>;
        };
      };
    };
    await expect(
      expectWorkspaceToolOk(
        config.tools.write.execute({
          content:
            "<!doctype html><html><head><style>@import url('https://cdn.example.com/font.css');</style></head><body></body></html>",
          path: 'index.html',
        }),
      ),
    ).resolves.toMatchObject({
      path: 'index.html',
    });
  });

  it('rejects existing unconfigured CDN tags on later HTML edits', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index.html',
      '<!doctype html><html><head><script src="https://cdn.example.com/legacy.js" data-owndesign-approved-cdn="true"></script></head><body><main>Old</main></body></html>',
    );
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        edit: {
          execute: (input: {
            newString: string;
            oldString: string;
            path: string;
          }) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.edit.execute({
        newString: 'New',
        oldString: 'Old',
        path: 'index.html',
      }),
      'can only use CDN resources configured in settings',
    );
  });

  it('normalizes model-chosen Google Fonts CDN to the configured CDN through write', async () => {
    const configuredFontCdn =
      'https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Noto+Sans+SC:wght@100..900&display=swap';
    aiMocks.getSettings.mockResolvedValueOnce({
      resources: {
        ...defaultResources,
        fontLibraries: [
          {
            id: 'font-1',
            name: 'Google Fonts',
            cdn: configuredFontCdn,
            isDefault: true,
          },
        ],
      },
    });
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        write: {
          execute: (input: { content: string; path: string }) => Promise<unknown>;
        };
      };
    };
    await expect(
      expectWorkspaceToolOk(
        config.tools.write.execute({
          content:
            "<!doctype html><html><head><style>@import url('https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Noto+Sans+SC:wght@100..900&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap');</style></head><body></body></html>",
          path: 'index.html',
        }),
      ),
    ).resolves.toMatchObject({
      path: 'index.html',
    });

    const html = await workspaceStore.readProjectWorkspaceFile('project-1', 'index.html');
    expect(html).toContain(configuredFontCdn);
    expect(html).not.toContain('Playfair+Display');
  });

  it('rejects Tailwind CDN additions through write', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        write: {
          execute: (input: { content: string; path: string }) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.write.execute({
        content:
          '<!doctype html><html><head><script src="https://cdn.tailwindcss.com/"></script></head><body></body></html>',
        path: 'index.html',
      }),
      'can only use CDN resources configured in settings',
    );
    await expectWorkspaceToolError(
      config.tools.write.execute({
        content:
          '<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script></head><body></body></html>',
        path: 'index.html',
      }),
      'can only use CDN resources configured in settings',
    );
  });

  it('does not apply CDN guards to non-html files', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        write: {
          execute: (input: { content: string; path: string }) => Promise<unknown>;
        };
      };
    };
    await expect(
      expectWorkspaceToolOk(
        config.tools.write.execute({
          content: '<script src="https://cdn.example.com/raw.js"></script>',
          path: 'notes.txt',
        }),
      ),
    ).resolves.toMatchObject({
      path: 'notes.txt',
    });
  });

  it('builds structured conversation instructions from core markdown and stable prompt sections', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      instructions: string;
    };
    expect(config.instructions).toContain('# Design Page Agent');
    expect(config.instructions).toContain('<design_agent_core>');
    expect(config.instructions).toContain('</design_agent_core>');
    expect(config.instructions).toContain('<page_target_protocol>');
    expect(config.instructions).toContain('</page_target_protocol>');
    expect(config.instructions).toContain('<tool_workflow>');
    expect(config.instructions).toContain('</tool_workflow>');
    expect(config.instructions).toContain('<resource_policy>');
    expect(config.instructions).toContain('</resource_policy>');
    expect(config.instructions).toContain('You design and build previewable product pages');
    expect(config.instructions).toContain('previewable UI prototype');
    expect(config.instructions).toContain('local UI state');
    expect(config.instructions).toContain('clipboard');
    expect(config.instructions).toContain('network');
    expect(config.instructions).toContain('persistence');
    expect(config.instructions).toContain('real form submissions');
    expect(config.instructions).toContain('Never use emoji as icons');
    expect(config.instructions).toContain('Project Workspace tools');
    expect(config.instructions).toContain('Use preview tools');
    expect(config.instructions).toContain('previewSwitchHtml');
    expect(config.instructions).toContain('previewRefresh');
    expect(config.instructions).toContain('preview.switchHtml');
    expect(config.instructions).toContain('preview.refresh');
    expect(config.instructions).not.toContain('<runtime_context>');
    expect(config.instructions).not.toContain('</runtime_context>');
    expect(config.instructions).not.toContain('<page_edit_mode_policy>');
    expect(config.instructions).not.toContain('</page_edit_mode_policy>');
    expect(config.instructions).not.toContain('## Runtime Context');
    expect(config.instructions).not.toContain('Project Output Type: html.');
    expect(config.instructions).not.toContain('Current preview page:');
    expect(config.instructions).toContain(
      'Resolve the target HTML page before creating or updating previewable output',
    );
    expect(config.instructions).toContain('Target resolution:');
    expect(config.instructions).toContain('If the user names a file, path, or page type');
    expect(config.instructions).toContain(
      'use the target page stated in the current user message when available',
    );
    expect(config.instructions).toContain(
      'Do not ask a follow-up question just because the request is brief',
    );
    expect(config.instructions).toContain('Inspect before changing files:');
    expect(config.instructions).toContain('For HTML pages:');
    expect(config.instructions).toContain(
      'Do not modify unrelated HTML files unless the requested change requires coordinated edits',
    );
    expect(config.instructions).toContain('do not create initial HTML with `write`');
    expect(config.instructions).toContain(
      'Use `edit` or `patch` for HTML changes after reading the file',
    );
    expect(config.instructions).toContain(
      'Notify the Preview Pane according to the frontend capabilities rules',
    );
    expect(config.instructions).toContain(
      'After successful previewable HTML changes, call exactly one preview tool',
    );
    expect(config.instructions).toContain(
      'Use `previewRefresh` when the Preview Pane is already showing the correct page',
    );
    expect(config.instructions).toContain(
      'Reply concisely with what changed and what to inspect next',
    );
    expect(config.instructions).toContain('relative workspace paths ending in `.html`');
    expect(config.instructions).toContain('default to `index-v1.html`');
    expect(config.instructions).toContain('no current preview page is available');
    expect(config.instructions).toContain(
      'Use `createHtml` when the target HTML file does not exist',
    );
    expect(config.instructions).toContain('omit them so the tool reads configured defaults');
    expect(config.instructions).toContain(
      'After `createHtml`, immediately use `read` on that file',
    );
    expect(config.instructions).toContain(
      'If the target HTML file exists, use `read` before editing it',
    );
    expect(config.instructions).toContain('will reject HTML with unlisted CDN tags');
    expect(config.instructions).toContain('semantic slug');
    expect(config.instructions).toContain('.owndesign-pages.json');
    expect(config.instructions).toContain('displayName');
    expect(config.instructions).toContain('`index` -> `小说阅读器首页`');
    expect(config.instructions).toContain('create `index-v1.html`');
    expect(config.instructions).toContain('create `{slug}-v1.html`');
    expect(config.instructions).toContain('Do not overwrite an existing HTML version');
    expect(config.instructions).toContain(
      'In duplicate_edit mode, do not update `.owndesign-pages.json`',
    );
    expect(config.instructions).toContain('Only use CDNs already listed in resource settings');
    expect(config.instructions).toContain('Configured Font');
    expect(config.instructions).toContain('Configured Icons');
    expect(config.instructions).toContain('Only use configured font libraries or system fonts');
    expect(config.instructions).toContain('Prefer configured icon libraries for icons');
    expect(config.instructions).toContain('Use regular inline CSS as the primary styling method');
    expect(config.instructions).toContain('`index-v1.html`');
    expect(config.instructions).not.toContain('https://cdn.example.com/font.css');
    expect(config.instructions).not.toContain('Tailwind');
    expect(config.instructions).not.toContain('tailwindcss');
    expect(config.instructions).not.toContain('approval');
    expect(config.instructions).not.toContain('addCdnResource');
    expect(config.instructions).not.toContain(
      'When the user expects a previewable page, write or update `index.html`',
    );
    expect(config.instructions).not.toContain('Do not:\n- use external CDNs');
    expect(config.instructions).not.toContain('writeHtmlFile');
    expect(config.instructions).not.toContain('Project One');
    expect(config.instructions).not.toContain('project-1');
    expect(config.instructions).not.toContain('conversation-1');
    expect(config.instructions).toContain(
      'Each user message may already include the current preview page',
    );
    expect(aiMocks.generate).toHaveBeenCalledWith({
      prompt: '设计一个 CRM 仪表盘的界面',
    });
  });

  it('builds turn prompt rewrite input from preview state and page edit mode', () => {
    const prompt = buildTurnPromptRewriterPrompt({
      originalUserPrompt: '精简布局',
      pageEditMode: 'duplicate_edit',
      pageEditModePolicy: {
        mode: 'duplicate_edit',
        sourcePath: 'dashboard.html',
        targetPath: 'dashboard-v1.html',
      },
      previewPath: 'dashboard.html',
    });

    expect(prompt).toContain('currentPreviewFile: dashboard.html');
    expect(prompt).toContain('pageEditMode: duplicate_edit');
    expect(prompt).toContain('duplicateSourcePath: dashboard.html');
    expect(prompt).toContain('duplicateTargetPath: dashboard-v1.html');
    expect(prompt).toContain('use copyFile');
    expect(prompt).toContain('forbid modifying any HTML page except the target page');
    expect(prompt).toContain('精简布局');
  });

  it('builds direct and new page rewrite prompts without adding hard edit restrictions', () => {
    const directPrompt = buildTurnPromptRewriterPrompt({
      originalUserPrompt: '调小标题',
      pageEditMode: 'direct_edit',
      pageEditModePolicy: {
        mode: 'direct_edit',
        targetPath: 'index.html',
      },
      previewPath: 'index.html',
    });
    const newPagePrompt = buildTurnPromptRewriterPrompt({
      originalUserPrompt: '加一个设置页',
      pageEditMode: 'new_page',
      pageEditModePolicy: {
        currentPreviewPath: 'index.html',
        mode: 'new_page',
      },
      previewPath: 'index.html',
    });

    expect(directPrompt).toContain('For direct_edit');
    expect(directPrompt).toContain('targetPath: index.html');
    expect(newPagePrompt).toContain('For new_page');
    expect(newPagePrompt).toContain('do not forbid related edits');
    expect(newPagePrompt).toContain('shared component reuse');
    expect(newPagePrompt).toContain('inserting shared component markers');
  });

  it('rewrites turn prompts as plain text', async () => {
    aiMocks.generateText.mockResolvedValueOnce({
      text: '```text\nEdit index.html: 精简布局\n```',
    });

    await expect(
      rewriteTurnPrompt({
        model: { modelId: 'test-model', provider: 'test' } as never,
        originalUserPrompt: '精简布局',
        pageEditMode: 'direct_edit',
        pageEditModePolicy: {
          mode: 'direct_edit',
          targetPath: 'index.html',
        },
        previewPath: 'index.html',
      }),
    ).resolves.toEqual({
      rewrittenPrompt: 'Edit index.html: 精简布局',
    });
    expect(aiMocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { modelId: 'test-model', provider: 'test' },
        prompt: expect.stringContaining('Original user request:\n精简布局'),
        system: expect.stringContaining('Return only the rewritten request'),
      }),
    );
  });

  it('adds forced page edit mode instructions', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'dashboard.html',
      '<main>Dashboard</main>',
    );

    const directContext = await createDesignPageAgentContext({
      currentPreviewPath: 'dashboard.html',
      modelConfigurationId: 'model-1',
      outputType: 'html',
      pageEditMode: 'direct_edit',
      projectId: 'project-1',
      workspaceStore,
    });

    expect(directContext.pageEditModePolicy).toEqual({
      mode: 'direct_edit',
      targetPath: 'dashboard.html',
    });
    expect(
      directContext.pageEditModePolicy ? buildDesignPageAgentInstructions(defaultResources) : '',
    ).not.toContain('Mode: direct_edit.');

    const duplicateContext = await createDesignPageAgentContext({
      currentPreviewPath: 'dashboard.html',
      modelConfigurationId: 'model-1',
      outputType: 'html',
      pageEditMode: 'duplicate_edit',
      projectId: 'project-1',
      workspaceStore,
    });

    expect(duplicateContext.pageEditModePolicy).toEqual({
      mode: 'duplicate_edit',
      sourcePath: 'dashboard.html',
      targetPath: 'dashboard-v1.html',
    });
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'dashboard-v1.html'),
    ).rejects.toThrow('ENOENT');
  });

  it('resolves duplicate edit targets from the latest page version', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile('project-1', 'index.html', '<main>Home</main>');
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index-v1.html',
      '<main>Home v1</main>',
    );
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index-v3.html',
      '<main>Home v3</main>',
    );

    await expect(
      createDesignPageAgentContext({
        currentPreviewPath: 'index.html',
        modelConfigurationId: 'model-1',
        outputType: 'html',
        pageEditMode: 'duplicate_edit',
        projectId: 'project-1',
        workspaceStore,
      }),
    ).resolves.toMatchObject({
      pageEditModePolicy: {
        mode: 'duplicate_edit',
        sourcePath: 'index.html',
        targetPath: 'index-v4.html',
      },
    });

    await expect(
      createDesignPageAgentContext({
        currentPreviewPath: 'index-v1.html',
        modelConfigurationId: 'model-1',
        outputType: 'html',
        pageEditMode: 'duplicate_edit',
        projectId: 'project-1',
        workspaceStore,
      }),
    ).resolves.toMatchObject({
      pageEditModePolicy: {
        mode: 'duplicate_edit',
        sourcePath: 'index-v1.html',
        targetPath: 'index-v4.html',
      },
    });
  });

  it('enforces forced page edit modes in workspace tools', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile('project-1', 'index.html', '<main>Home</main>');
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index.copy.html',
      '<main>Home</main>',
    );

    const directTools = createWorkspaceToolRegistry(createProjectWorkspaceToolDefinitions(), {
      approvedCdnUrls: ['https://cdn.example.com/font.css', 'https://cdn.example.com/icons.js'],
      pageEditModePolicy: {
        mode: 'direct_edit',
        targetPath: 'index.html',
      },
      projectId: 'project-1',
      resources: defaultResources,
      workspaceStore,
    }) as unknown as {
      createHtml: { execute: (input: { path: string }) => Promise<unknown> };
      edit: {
        execute: (input: {
          newString: string;
          oldString: string;
          path: string;
        }) => Promise<unknown>;
      };
    };

    await expectWorkspaceToolOk(directTools.createHtml.execute({ path: 'login.html' }));
    await expectWorkspaceToolOk(
      directTools.edit.execute({
        newString: 'Copy',
        oldString: 'Home',
        path: 'index.copy.html',
      }),
    );
    await expectWorkspaceToolOk(
      directTools.edit.execute({
        newString: 'Updated',
        oldString: 'Home',
        path: 'index.html',
      }),
    );

    const newPageTools = createWorkspaceToolRegistry(createProjectWorkspaceToolDefinitions(), {
      approvedCdnUrls: ['https://cdn.example.com/font.css', 'https://cdn.example.com/icons.js'],
      pageEditModePolicy: {
        currentPreviewPath: 'index.html',
        mode: 'new_page',
      },
      projectId: 'project-1',
      resources: defaultResources,
      workspaceStore,
    }) as unknown as {
      createHtml: { execute: (input: { path: string }) => Promise<unknown> };
      edit: {
        execute: (input: {
          newString: string;
          oldString: string;
          path: string;
        }) => Promise<unknown>;
      };
    };

    await expectWorkspaceToolOk(
      newPageTools.edit.execute({
        newString: 'Again',
        oldString: 'Updated',
        path: 'index.html',
      }),
    );
    await expectWorkspaceToolOk(newPageTools.createHtml.execute({ path: 'landing.html' }));
    await expectWorkspaceToolOk(
      newPageTools.edit.execute({
        newString: '<main id="app">Landing</main>',
        oldString: '<main id="app"></main>',
        path: 'landing.html',
      }),
    );
  });

  it('isolates duplicate edit mode to the copied HTML page', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile('project-1', 'index.html', '<main>Home</main>');
    await workspaceStore.writeProjectWorkspaceFile('project-1', 'notes.txt', 'Home notes');

    const tools = createWorkspaceToolRegistry(createProjectWorkspaceToolDefinitions(), {
      approvedCdnUrls: ['https://cdn.example.com/font.css', 'https://cdn.example.com/icons.js'],
      frontendTabId: 'tab-1',
      pageEditModePolicy: {
        mode: 'duplicate_edit',
        sourcePath: 'index.html',
        targetPath: 'index-v1.html',
      },
      projectId: 'project-1',
      resources: defaultResources,
      workspaceStore,
    }) as unknown as {
      copyFile: {
        execute: (input: { sourcePath: string; targetPath: string }) => Promise<unknown>;
      };
      previewSwitchHtml: {
        execute: (input: { path: string }) => Promise<unknown>;
      };
      delete: { execute: (input: { path: string }) => Promise<unknown> };
      edit: {
        execute: (input: {
          newString: string;
          oldString: string;
          path: string;
        }) => Promise<unknown>;
      };
      glob: { execute: (input: { pattern: string }) => Promise<unknown> };
      grep: {
        execute: (input: { include?: string; path?: string; pattern: string }) => Promise<unknown>;
      };
      patch: {
        execute: (input: {
          changes: Array<{
            content?: string;
            newString?: string;
            oldString?: string;
            operation: 'delete' | 'edit' | 'write';
            path: string;
          }>;
        }) => Promise<unknown>;
      };
      read: { execute: (input: { path: string }) => Promise<unknown> };
      write: {
        execute: (input: { content: string; path: string }) => Promise<unknown>;
      };
    };

    await expect(
      expectWorkspaceToolOk<{ content: string; path: string; type: string }>(
        tools.read.execute({ path: 'index.html' }),
      ),
    ).resolves.toMatchObject({
      content: expect.stringContaining('Home'),
      path: 'index.html',
      type: 'file',
    });
    await expectWorkspaceToolError(
      tools.copyFile.execute({
        sourcePath: 'index.html',
        targetPath: 'other.html',
      }),
      'can only copy index.html to index-v1.html',
    );
    await expectWorkspaceToolOk(
      tools.copyFile.execute({
        sourcePath: 'index.html',
        targetPath: 'index-v1.html',
      }),
    );
    await expect(
      tools.write.execute({
        content: '<main>Duplicate</main>',
        path: 'index.html',
      }),
    ).resolves.toMatchObject({
      error: expect.stringContaining('can only edit index-v1.html'),
      ok: false,
    });
    await expectWorkspaceToolOk(
      tools.write.execute({
        content: '<main>Duplicate</main>',
        path: 'index-v1.html',
      }),
    );
    await expect(workspaceStore.readProjectWorkspaceFile('project-1', 'index.html')).resolves.toBe(
      '<main>Home</main>',
    );
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'index-v1.html'),
    ).resolves.toBe('<main>Duplicate</main>');
    await expect(
      expectWorkspaceToolOk<{ path: string; replacements: number }>(
        tools.edit.execute({
          newString: 'Updated',
          oldString: 'Duplicate',
          path: 'index-v1.html',
        }),
      ),
    ).resolves.toMatchObject({
      path: 'index-v1.html',
      replacements: 1,
    });
    await expect(
      expectWorkspaceToolOk<{
        results: Array<{
          operation: string;
          result: { path: string };
        }>;
      }>(
        tools.patch.execute({
          changes: [
            {
              content: '<main>Patched</main>',
              operation: 'write',
              path: 'index-v1.html',
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({
      results: [
        {
          operation: 'write',
          result: { path: 'index-v1.html' },
        },
      ],
    });
    await expectWorkspaceToolError(
      tools.patch.execute({
        changes: [{ operation: 'delete', path: 'index.html' }],
      }),
      'can only delete index-v1.html',
    );
    await expectWorkspaceToolError(
      tools.delete.execute({ path: 'index.html' }),
      'can only delete index-v1.html',
    );
    await expectWorkspaceToolError(
      tools.previewSwitchHtml.execute({ path: 'index.html' }),
      'can only preview index-v1.html',
    );

    await expectWorkspaceToolOk(tools.read.execute({ path: 'index-v1.html' }));
    await expect(
      expectWorkspaceToolOk<{ content: string; path: string; type: string }>(
        tools.read.execute({ path: 'index.html' }),
      ),
    ).resolves.toMatchObject({
      content: expect.stringContaining('Home'),
      path: 'index.html',
      type: 'file',
    });
    await expect(
      expectWorkspaceToolOk<{ matches: Array<{ path: string }> }>(
        tools.grep.execute({ path: 'index.html', pattern: 'Home' }),
      ),
    ).resolves.toMatchObject({
      matches: [{ path: 'index.html' }],
    });
    await expect(
      expectWorkspaceToolOk<{ matches: Array<{ path: string }> }>(
        tools.glob.execute({ pattern: '**/*.html' }),
      ),
    ).resolves.toMatchObject({
      matches: expect.arrayContaining([
        expect.objectContaining({ path: 'index.html' }),
        expect.objectContaining({ path: 'index-v1.html' }),
      ]),
    });
    await expect(
      expectWorkspaceToolOk<{ matches: Array<{ path: string }> }>(
        tools.grep.execute({ include: '*.html', pattern: 'Home|Patched' }),
      ),
    ).resolves.toMatchObject({
      matches: expect.arrayContaining([
        expect.objectContaining({ path: 'index.html' }),
        expect.objectContaining({ path: 'index-v1.html' }),
      ]),
    });
    await expect(
      expectWorkspaceToolOk(tools.previewSwitchHtml.execute({ path: 'index-v1.html' })),
    ).resolves.toMatchObject({
      payload: { path: 'index-v1.html' },
    });
    await expectWorkspaceToolOk(tools.delete.execute({ path: 'index-v1.html' }));
    await expect(workspaceStore.readProjectWorkspaceFile('project-1', 'index.html')).resolves.toBe(
      '<main>Home</main>',
    );
  });

  it('isolates new page mode before and after the first HTML creation', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile('project-1', 'index.html', '<main>Home</main>');
    await workspaceStore.writeProjectWorkspaceFile('project-1', 'notes.txt', 'Landing notes');

    const pageEditModePolicy = {
      currentPreviewPath: 'index.html',
      mode: 'new_page' as const,
    };
    const tools = createWorkspaceToolRegistry(createProjectWorkspaceToolDefinitions(), {
      approvedCdnUrls: ['https://cdn.example.com/font.css', 'https://cdn.example.com/icons.js'],
      frontendTabId: 'tab-1',
      pageEditModePolicy,
      projectId: 'project-1',
      resources: defaultResources,
      workspaceStore,
    }) as unknown as {
      createHtml: { execute: (input: { path: string }) => Promise<unknown> };
      edit: {
        execute: (input: {
          newString: string;
          oldString: string;
          path: string;
        }) => Promise<unknown>;
      };
      glob: { execute: (input: { pattern: string }) => Promise<unknown> };
      grep: {
        execute: (input: { include?: string; pattern: string }) => Promise<unknown>;
      };
      read: { execute: (input: { path: string }) => Promise<unknown> };
      previewSwitchHtml: {
        execute: (input: { path: string }) => Promise<unknown>;
      };
      write: {
        execute: (input: { content: string; path: string }) => Promise<unknown>;
      };
    };

    await expectWorkspaceToolOk(tools.read.execute({ path: 'index.html' }));
    await expectWorkspaceToolOk(
      tools.write.execute({ content: '<main>Early</main>', path: 'landing.html' }),
    );
    await expectWorkspaceToolError(
      tools.createHtml.execute({ path: 'index.html' }),
      'already exists',
    );
    await expect(
      expectWorkspaceToolOk<{ matches: Array<{ path: string }> }>(
        tools.glob.execute({ pattern: '**/*.html' }),
      ),
    ).resolves.toMatchObject({
      matches: expect.arrayContaining([
        expect.objectContaining({ path: 'index.html' }),
        expect.objectContaining({ path: 'landing.html' }),
      ]),
    });
    await expect(
      expectWorkspaceToolOk<{ matches: Array<{ path: string }> }>(
        tools.grep.execute({ include: '*.html', pattern: 'Home' }),
      ),
    ).resolves.toMatchObject({
      matches: [{ path: 'index.html' }],
    });

    await expectWorkspaceToolOk(tools.createHtml.execute({ path: 'other.html' }));
    await expectWorkspaceToolOk(tools.read.execute({ path: 'index.html' }));
    await expectWorkspaceToolOk(
      tools.write.execute({
        content: '<main>Landing</main>',
        path: 'landing.html',
      }),
    );
    await expectWorkspaceToolOk(tools.read.execute({ path: 'landing.html' }));
    await expectWorkspaceToolOk(
      tools.edit.execute({
        newString: 'Published',
        oldString: 'Landing',
        path: 'landing.html',
      }),
    );
    await expectWorkspaceToolOk(tools.previewSwitchHtml.execute({ path: 'index.html' }));
    await expect(
      expectWorkspaceToolOk(tools.previewSwitchHtml.execute({ path: 'landing.html' })),
    ).resolves.toMatchObject({
      payload: { path: 'landing.html' },
    });
    await expect(
      expectWorkspaceToolOk<{ matches: Array<{ path: string }> }>(
        tools.glob.execute({ pattern: '**/*.html' }),
      ),
    ).resolves.toMatchObject({
      matches: expect.arrayContaining([
        expect.objectContaining({ path: 'index.html' }),
        expect.objectContaining({ path: 'landing.html' }),
      ]),
    });
    await expect(
      expectWorkspaceToolOk<{ matches: Array<{ path: string }> }>(
        tools.grep.execute({ include: '*.html', pattern: 'Home|Published' }),
      ),
    ).resolves.toMatchObject({
      matches: expect.arrayContaining([
        expect.objectContaining({ path: 'index.html' }),
        expect.objectContaining({ path: 'landing.html' }),
      ]),
    });
  });

  it('keeps the current preview page out of conversation instructions', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    const agent = new AiSdkDesignPageAgent(workspaceStore);

    await agent.generateProjectOutput(buildInput());

    const baseConfig = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      instructions: string;
    };
    expect(baseConfig.instructions).not.toContain('Current preview page:');

    aiMocks.generate.mockResolvedValueOnce({ text: '' });

    const { createDesignPageAgent } = await import('./design-page-agent');
    createDesignPageAgent({
      currentPreviewPath: 'dashboard.html',
      model: { modelId: 'test-model', provider: 'test' } as never,
      outputType: 'html',
      projectId: 'project-1',
      resources: defaultResources,
      workspaceStore,
    });

    const config = aiMocks.toolLoopAgent.mock.calls.at(-1)?.[0] as {
      instructions: string;
    };
    expect(config.instructions).not.toContain('Current preview page: dashboard.html.');
    expect(config.instructions).not.toContain('<page_edit_mode_policy>');
  });

  it('calls frontend preview capabilities only with valid payloads', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'pages/detail.html',
      '<main>Detail</main>',
    );
    const { createDesignPageAgent } = await import('./design-page-agent');
    createDesignPageAgent({
      frontendTabId: 'tab-1',
      model: { modelId: 'test-model', provider: 'test' } as never,
      outputType: 'html',
      projectId: 'project-1',
      resources: defaultResources,
      workspaceStore,
    });

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        previewRefresh: {
          execute: (input: Record<string, never>) => Promise<unknown>;
        };
        previewSwitchHtml: {
          execute: (input: { path: string }) => Promise<unknown>;
        };
      };
    };
    await expect(
      expectWorkspaceToolOk(config.tools.previewSwitchHtml.execute({ path: 'pages/detail.html' })),
    ).resolves.toEqual({
      capability: 'preview.switchHtml',
      delivered: true,
      payload: { path: 'pages/detail.html' },
    });
    expect(aiMocks.sendFrontendCommand).toHaveBeenCalledWith({
      capability: 'preview.switchHtml',
      frontendTabId: 'tab-1',
      payload: { path: 'pages/detail.html' },
      projectId: 'project-1',
    });
    await expect(expectWorkspaceToolOk(config.tools.previewRefresh.execute({}))).resolves.toEqual({
      capability: 'preview.refresh',
      delivered: true,
      payload: {},
    });
    await expectWorkspaceToolError(
      config.tools.previewSwitchHtml.execute({ path: 'missing.html' }),
      'was not found',
    );
    await expectWorkspaceToolError(
      config.tools.previewSwitchHtml.execute({ path: 'notes.txt' }),
      'must end with .html',
    );
  });

  it('requires frontend tab id before calling frontend capabilities', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const { createDesignPageAgent } = await import('./design-page-agent');
    createDesignPageAgent({
      model: { modelId: 'test-model', provider: 'test' } as never,
      outputType: 'html',
      projectId: 'project-1',
      resources: defaultResources,
      workspaceStore,
    });

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        previewRefresh: {
          execute: (input: Record<string, never>) => Promise<unknown>;
        };
      };
    };

    await expectWorkspaceToolError(
      config.tools.previewRefresh.execute({}),
      'Frontend tab id is required',
    );
  });
});

async function createWorkspaceStore() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'owndesign-agent-'));
  tempRoots.push(tempRoot);

  return new WorkspaceStore({
    workspaceRoot: path.join(tempRoot, '.owndesign'),
    moveToTrash: async (targetPath) => {
      await rm(targetPath, { force: true, recursive: true });
    },
  });
}

async function createProject(workspaceStore: WorkspaceStore) {
  await workspaceStore.createProject({
    id: 'project-1',
    name: 'Project One',
    outputType: 'html',
    createdAt: '2026-05-14T10:00:00.000Z',
    updatedAt: '2026-05-14T10:00:00.000Z',
  });
}

function buildInput() {
  return {
    content: '设计一个 CRM 仪表盘的界面',
    outputType: 'html' as const,
    projectId: 'project-1',
  };
}

async function expectWorkspaceToolOk<T>(promise: Promise<unknown>) {
  const result = await promise;

  expect(result).toMatchObject({
    ok: true,
    wallTimeMs: expect.any(Number),
  });

  return (result as { output: T }).output;
}

async function expectWorkspaceToolError(promise: Promise<unknown>, message: string) {
  await expect(promise).resolves.toMatchObject({
    error: expect.stringContaining(message),
    ok: false,
    wallTimeMs: expect.any(Number),
  });
}
