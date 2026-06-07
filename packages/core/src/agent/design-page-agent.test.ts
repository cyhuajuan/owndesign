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
import {
  buildComponentAuditInstructions,
  parseComponentAuditResult,
} from './component-audit-agent';
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
  aiMocks.generate.mockResolvedValue({
    text: JSON.stringify({
      findings: [],
      passed: true,
      summary: 'No component audit findings.',
    }),
  });
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

  it('loads component audit prompt from the prompt registry', () => {
    expect(loadPrompt('agents/component-audit')).toContain('# Component Audit Agent');
  });

  it('loads turn prompt templates from the prompt registry', () => {
    expect(loadPrompt('turn-templates/new-page')).toContain('我要新建一个页面');
    expect(loadPrompt('turn-templates/direct-edit')).toContain('我要直接修改');
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

  it('does not run component audit silently after the main task', async () => {
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
          content: '<!doctype html><html><body><main>Home</main></body></html>',
          path: 'index.html',
        });
        expect(aiMocks.toolLoopAgent).toHaveBeenCalledTimes(1);

        return { text: '页面已更新。' };
      },
    );

    await agent.generateProjectOutput(buildInput());

    expect(aiMocks.toolLoopAgent).toHaveBeenCalledTimes(1);
    expect(aiMocks.generate).toHaveBeenNthCalledWith(1, {
      prompt: '设计一个 CRM 仪表盘的界面',
    });
  });

  it('runs component audit as a visible main-agent tool with a read-only sub-agent', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate
      .mockImplementationOnce(
        async function (this: {
          config: {
            tools: {
              componentAudit: {
                execute: (input: {
                  completedWorkSummary?: string;
                  taskSummary?: string;
                }) => Promise<unknown>;
              };
            };
          };
        }) {
          const auditResult = await this.config.tools.componentAudit.execute({
            completedWorkSummary: 'Created the dashboard page.',
            taskSummary: '设计一个 CRM 仪表盘的界面',
          });

          expect(auditResult).toMatchObject({
            ok: true,
            output: {
              findings: [],
              passed: true,
              summary: 'No component audit findings.',
            },
          });

          return { text: '页面已更新。' };
        },
      )
      .mockResolvedValueOnce({
        text: JSON.stringify({
          findings: [],
          passed: true,
          summary: 'No component audit findings.',
        }),
      });

    await agent.generateProjectOutput(buildInput());

    const auditConfig = aiMocks.toolLoopAgent.mock.calls[1]?.[0] as {
      instructions: string;
      tools: Record<string, unknown>;
    };
    expect(aiMocks.toolLoopAgent).toHaveBeenCalledTimes(2);
    expect(aiMocks.generate).toHaveBeenNthCalledWith(2, {
      prompt: expect.stringContaining('Audit the completed OwnDesign HTML task.'),
    });
    expect(aiMocks.generate).toHaveBeenNthCalledWith(2, {
      prompt: expect.stringContaining('Original user task:\n设计一个 CRM 仪表盘的界面'),
    });
    expect(aiMocks.generate).toHaveBeenNthCalledWith(2, {
      prompt: expect.stringContaining('Main agent final response:\nCreated the dashboard page.'),
    });
    expect(Object.keys(auditConfig.tools).sort()).toEqual(['glob', 'grep', 'read']);
    expect(auditConfig.instructions).toContain('# Component Audit Agent');
    expect(auditConfig.instructions).toContain('Use only read, glob, and grep tools');
    expect(auditConfig.instructions).toContain('Navigation is the highest-priority');
  });

  it('leaves high severity component audit repair inside the main agent tool loop', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    const highFinding = {
      message: 'Page has top navigation but no shared navigation component marker.',
      path: 'index.html',
      recommendedAction: 'create_or_reuse_navigation_component',
      severity: 'high',
      type: 'missing_navigation_component',
    };
    aiMocks.generate.mockImplementationOnce(
      async function (this: {
        config: {
          tools: {
            componentAudit: {
              execute: (input: {
                completedWorkSummary?: string;
                taskSummary?: string;
              }) => Promise<unknown>;
            };
          };
        };
      }) {
        const auditResult = await this.config.tools.componentAudit.execute({
          completedWorkSummary: 'Created a page with navigation.',
          taskSummary: '设计一个 CRM 仪表盘的界面',
        });

        expect(auditResult).toMatchObject({
          ok: true,
          output: {
            findings: [highFinding],
            passed: false,
            summary: 'Navigation needs a shared component.',
          },
        });

        return { text: '已根据 componentAudit 修复导航组件。' };
      },
    );
    aiMocks.generate.mockResolvedValueOnce({
      text: JSON.stringify({
        findings: [highFinding],
        passed: false,
        summary: 'Navigation needs a shared component.',
      }),
    });

    const result = await agent.generateProjectOutput(buildInput());

    expect(result).toEqual({ content: '已根据 componentAudit 修复导航组件。' });
    expect(aiMocks.toolLoopAgent).toHaveBeenCalledTimes(2);
    expect(aiMocks.generate).not.toHaveBeenCalledWith({
      prompt: expect.stringContaining('Fix the high severity findings now'),
    });
  });

  it('does not auto-repair medium and low component audit findings outside the main agent', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '页面已更新。' });

    const result = await agent.generateProjectOutput(buildInput());

    expect(result).toEqual({ content: '页面已更新。' });
    expect(aiMocks.toolLoopAgent).toHaveBeenCalledTimes(1);
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
      'componentAudit',
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
    expect(
      createProjectWorkspaceToolDefinitions().map((definition) => definition.name),
    ).not.toContain('componentAudit');
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
        componentAudit: { inputSchema: { safeParse: (input: unknown) => { success: boolean } } };
        patch: { inputSchema: { safeParse: (input: unknown) => { success: boolean } } };
        previewRefresh: { inputSchema: { safeParse: (input: unknown) => { success: boolean } } };
        previewSwitchHtml: { inputSchema: { safeParse: (input: unknown) => { success: boolean } } };
        read: { inputSchema: { safeParse: (input: unknown) => { success: boolean } } };
        syncSharedComponent: {
          inputSchema: { safeParse: (input: unknown) => { success: boolean } };
        };
      };
    };
    expect(config.tools.__metadata.componentAudit).toEqual({ parallelSafe: false });
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
      config.tools.componentAudit.inputSchema.safeParse({
        completedWorkSummary: 'Created index.html.',
        taskSummary: 'Create a home page.',
      }).success,
    ).toBe(true);
    expect(
      config.tools.componentAudit.inputSchema.safeParse({
        completedWorkSummary: 'Created index.html.',
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      config.tools.syncSharedComponent.inputSchema.safeParse({
        content: 'customElements.define("od-navigation", class extends HTMLElement {});',
        description: '全站顶部导航',
        name: 'navigation',
        tagName: 'od-navigation',
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
    expect(instructions).toContain('Web Components');
    expect(instructions).toContain('components/od-{name}.js');
    expect(instructions).toContain('customElements.define("od-{name}", ...)');
    expect(instructions).toContain('tagName');
    expect(instructions).toContain('<od-navigation current="index"></od-navigation>');
    expect(instructions).toContain('Navigation is the highest-priority shared component');
    expect(instructions).toContain('reuse shared navigation before inventing a new visual variant');
    expect(instructions).toContain('call `componentAudit` before the final reply');
    expect(instructions).toContain('fix those required issues and call `componentAudit` again');
    expect(instructions).toContain('Medium and low severity findings are suggestions');
    expect(instructions).toContain(
      'Avoid extracting one-off sections, content-heavy sections, or modules that are intentionally different on each page',
    );
  });

  it('includes component audit prompt rules and parses invalid audit output as a diagnostic failure', () => {
    const instructions = buildComponentAuditInstructions();

    expect(instructions).toContain('Navigation is the highest-priority shared component');
    expect(instructions).toContain('od-navigation');
    expect(instructions).toContain('components/od-navigation.js');
    expect(instructions).toContain('customElements.define("od-navigation", ...)');
    expect(instructions).toContain('Shared navigation must contain usable links');
    expect(instructions).toContain('href="#"');
    expect(instructions).toContain('javascript:void(0)');
    expect(instructions).toContain('navigation links should point to existing `.html` pages');
    expect(instructions).toContain('stable HTML paths');
    expect(instructions).toContain('.owndesign-pages.json');
    expect(instructions).toContain('pages/od-{slug}-page.js');
    expect(instructions).toContain('Footer, CTA, newsletter, testimonial');
    expect(instructions).toContain('shared Web Components');
    expect(instructions).toContain('Do not report one-off sections');

    expect(parseComponentAuditResult('not json')).toEqual({
      findings: [
        {
          message: 'Component audit returned invalid JSON.',
          recommendedAction: 'Review component audit output format.',
          severity: 'medium',
          type: 'component_audit_invalid_output',
        },
      ],
      passed: false,
      summary: 'Component audit returned invalid JSON.',
    });
  });

  it('writes shared Web Component source and manifest metadata', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const tools = createWorkspaceToolRegistry(createProjectWorkspaceToolDefinitions(), {
      approvedCdnUrls: ['https://cdn.example.com/font.css', 'https://cdn.example.com/icons.js'],
      projectId: 'project-1',
      resources: defaultResources,
      workspaceStore,
    }) as unknown as {
      syncSharedComponent: {
        execute: (input: {
          content?: string;
          description?: string;
          name: string;
          tagName?: string;
          usedBy?: string[];
        }) => Promise<unknown>;
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
          content: 'customElements.define("od-navigation", class extends HTMLElement {});',
          description: 'Site navigation',
          name: 'navigation',
          tagName: 'od-navigation',
          usedBy: ['index.html', 'detail.html', 'index.html'],
        }),
      ),
    ).resolves.toEqual({
      manifestUpdated: true,
      skippedPages: [],
      source: 'components/od-navigation.js',
      updatedPages: ['index.html', 'detail.html'],
    });
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'components/od-navigation.js'),
    ).resolves.toBe('customElements.define("od-navigation", class extends HTMLElement {});');
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', HTML_SHARED_COMPONENTS_MANIFEST_PATH),
    ).resolves.toContain('"tagName": "od-navigation"');
  });

  it('reuses existing shared Web Component source when content is omitted', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'components/od-navigation.js',
      'customElements.define("od-navigation", class extends HTMLElement {});',
    );
    const tools = createWorkspaceToolRegistry(createProjectWorkspaceToolDefinitions(), {
      approvedCdnUrls: ['https://cdn.example.com/font.css', 'https://cdn.example.com/icons.js'],
      projectId: 'project-1',
      resources: defaultResources,
      workspaceStore,
    }) as unknown as {
      syncSharedComponent: {
        execute: (input: { name: string; tagName?: string; usedBy?: string[] }) => Promise<unknown>;
      };
    };

    await expect(
      expectWorkspaceToolOk<{ source: string; updatedPages: string[] }>(
        tools.syncSharedComponent.execute({
          name: 'navigation',
          tagName: 'od-navigation',
          usedBy: ['index.html'],
        }),
      ),
    ).resolves.toMatchObject({
      source: 'components/od-navigation.js',
      updatedPages: ['index.html'],
    });
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
      componentSource: 'pages/od-index-page.js',
      componentTag: 'od-index-page',
      path: 'index.html',
      slug: 'index',
      title: 'CRM Dashboard',
    });

    const html = await workspaceStore.readProjectWorkspaceFile('project-1', 'index.html');
    expect(html).toContain('<od-index-page></od-index-page>');
    expect(html).toContain('<script type="module" src="./pages/od-index-page.js"></script>');
    expect(html).toContain("@import url('https://cdn.example.com/font.css');");
    expect(html).toContain(
      '<script src="https://cdn.example.com/icons.js" data-owndesign-approved-cdn="true"></script>',
    );
    await expect(
      workspaceStore.readProjectWorkspaceFile('project-1', 'pages/od-index-page.js'),
    ).resolves.toContain("customElements.define('od-index-page'");
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
          path: 'detail.html',
        }),
      ),
    ).resolves.toMatchObject({
      fontLibrary: { cdn: '', name: 'Display Font' },
      iconLibrary: {
        cdn: 'https://cdn.example.com/font-awesome.css',
        name: 'Font Awesome',
      },
      componentSource: 'pages/od-detail-page.js',
      componentTag: 'od-detail-page',
      path: 'detail.html',
      slug: 'detail',
    });

    const html = await workspaceStore.readProjectWorkspaceFile('project-1', 'detail.html');
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
      'root slug HTML path',
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
    expect(config.instructions).toContain('For HTML pages and page Web Components:');
    expect(config.instructions).toContain(
      'Do not modify unrelated HTML files unless the requested change requires coordinated edits',
    );
    expect(config.instructions).toContain('do not create initial HTML with `write`');
    expect(config.instructions).toContain(
      'Use `edit` or `patch` for HTML or JS changes after reading the file',
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
    expect(config.instructions).toContain('default to `index.html`');
    expect(config.instructions).toContain('no current preview page is available');
    expect(config.instructions).toContain(
      'Use `createHtml` when the target HTML file does not exist',
    );
    expect(config.instructions).toContain('omit them so the tool reads configured defaults');
    expect(config.instructions).toContain(
      'After `createHtml`, immediately use `read` on both files',
    );
    expect(config.instructions).toContain(
      'If the target HTML file exists, use `read` before editing it',
    );
    expect(config.instructions).toContain('will reject HTML with unlisted CDN tags');
    expect(config.instructions).toContain('semantic slug');
    expect(config.instructions).toContain('.owndesign-pages.json');
    expect(config.instructions).toContain('displayName');
    expect(config.instructions).toContain('componentSource');
    expect(config.instructions).toContain('pages/od-{slug}-page.js');
    expect(config.instructions).toContain('`index` -> `小说阅读器首页`');
    expect(config.instructions).toContain('create `index.html`');
    expect(config.instructions).toContain('create `{slug}.html`');
    expect(config.instructions).toContain('Do not overwrite an existing HTML page');
    expect(config.instructions).toContain('Only use CDNs already listed in resource settings');
    expect(config.instructions).toContain('Configured Font');
    expect(config.instructions).toContain('Configured Icons');
    expect(config.instructions).toContain('Only use configured font libraries or system fonts');
    expect(config.instructions).toContain('Prefer configured icon libraries for icons');
    expect(config.instructions).toContain('Use regular inline CSS as the primary styling method');
    expect(config.instructions).toContain('`index.html`');
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

  it('renders direct and new page turn prompts from deterministic templates', () => {
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

    expect(directPrompt).toContain('我要直接修改 index.html');
    expect(directPrompt).toContain('不要创建新页面或新版本');
    expect(directPrompt).toContain('pages/*.js');
    expect(directPrompt).toContain('具体要求：');
    expect(directPrompt).not.toContain('用户具体要求');
    expect(directPrompt).toContain('调小标题');
    expect(newPagePrompt).toContain('我要新建一个页面');
    expect(newPagePrompt).toContain('不要覆盖已有 HTML 页面');
    expect(newPagePrompt).toContain('页面 slug');
    expect(newPagePrompt).toContain('共享导航、页面目录和页面间链接');
    expect(newPagePrompt).toContain('当前预览页面：index.html');
    expect(newPagePrompt).toContain('具体要求：');
    expect(newPagePrompt).not.toContain('用户具体要求');
    expect(newPagePrompt).toContain('加一个设置页');
  });

  it('keeps auto turn prompts unchanged and does not call the LLM rewriter', async () => {
    await expect(
      rewriteTurnPrompt({
        model: { modelId: 'test-model', provider: 'test' } as never,
        originalUserPrompt: '精简布局',
        pageEditMode: 'auto',
        pageEditModePolicy: {
          mode: 'auto',
        },
        previewPath: 'index.html',
      }),
    ).resolves.toEqual({
      rewrittenPrompt: '精简布局',
    });
    expect(aiMocks.generateText).not.toHaveBeenCalled();
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

    await expectWorkspaceToolError(
      directTools.createHtml.execute({ path: 'login.html' }),
      'can only create index.html',
    );
    await expectWorkspaceToolError(
      directTools.edit.execute({
        newString: 'Copy',
        oldString: 'Home',
        path: 'index.copy.html',
      }),
      'can only edit index.html',
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
        newString: 'Landing',
        oldString: 'OwnDesign Preview',
        path: 'pages/od-landing-page.js',
      }),
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
