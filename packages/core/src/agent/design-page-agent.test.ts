import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AiSdkDesignPageAgent,
  buildDesignPageAgentInstructions,
  createDesignPageAgent,
  createDesignPageAgentContext,
} from './design-page-agent';
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
      vi.fn((modelId: string) => ({ modelId, provider: 'openai-compatible' })),
    ),
    generate,
    getSettings: vi.fn(),
    resolveModelConfiguration: vi.fn(),
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

vi.mock('ai', () => ({
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
  it('loads the single HTML prompt from the prompt registry', () => {
    expect(loadPrompt('agents/design-page')).toContain('# OwnDesign Single HTML Page Agent');
    expect(loadPrompt('agents/design-page')).toContain('single `index.html` file');
  });

  it('builds single HTML conversation instructions without old architecture terms', () => {
    const instructions = buildDesignPageAgentInstructions(defaultResources);

    expect(instructions).toContain('<design_agent_core>');
    expect(instructions).toContain('<page_target_protocol>');
    expect(instructions).toContain('<tool_workflow>');
    expect(instructions).toContain('<frontend_capabilities>');
    expect(instructions).toContain('<resource_policy>');
    expect(instructions).toContain('The project has one previewable file: `index.html`');
    expect(instructions).toContain('createHtml({ path: "index.html" })');
    expect(instructions).toContain('previewRefresh');
    expect(instructions).toContain('retry with a smaller, exact edit');
    expect(instructions).toContain('Identify the interface purpose, target user, primary task');
    expect(instructions).toContain('Choose one clear visual direction');
    expect(instructions).toContain('Plan the first viewport, key workflow');
    expect(instructions).toContain('Then implement the design in `index.html`');
    expect(instructions).toContain('Use `<main id="app">` for the visible app/page body');
    expect(instructions).toContain('reset, tokens, layout, components, responsive rules, and motion');
    expect(instructions).toContain('use `[data-view]` sections with a single active state');
    expect(instructions).toContain('only prototype behavior that is needed');
    expect(instructions).toContain('Interactions should demonstrate interface states, user flows, and visual feedback');
    expect(instructions).toContain('Good prototype interactions include active tabs, modal open/close, drawer visibility');
    expect(instructions).toContain('filter chips, selected rows, toast messages, simple steppers, hash/view switching');
    expect(instructions).toContain('default to a mock UI flow');
    expect(instructions).toContain('Do not use `<input type="file">`, `webkitdirectory`, `showOpenFilePicker`, `FileReader`');
    expect(instructions).toContain('drag-and-drop file reading, real file counting, or real local file previews');
    expect(instructions).toContain('Forms may validate required fields, show error/success states, and update local mock content');
    expect(instructions).toContain('Do not submit data, persist data, call APIs, authenticate, upload files');
    expect(instructions).toContain('The goal is the interface design, not the dataset');
    expect(instructions).toContain('Use 3-6 representative items by default');
    expect(instructions).toContain('the total number of repeated mock records should usually stay under 10-12');
    expect(instructions).toContain('Do not create large arrays, full catalogs, full chapter lists');
    expect(instructions).toContain('Prefer static markup for simple examples');
    expect(instructions).toContain('If the design needs to imply scale, use layout, counts, pagination controls');
    expect(instructions).toContain('For media libraries, readers, stores, dashboards, and management tools');
    expect(instructions).toContain('never fill the page by generating many items');
    expect(instructions).toContain('For content-heavy interfaces, use short excerpts and visual placeholders');
    expect(instructions).toContain('Avoid data-first implementation');
    expect(instructions).toContain('## Pre-Output Checklist');
    expect(instructions).toContain('Before calling `previewRefresh`, re-read the rendered `index.html`');
    expect(instructions).toContain('Generic AI-style layouts');
    expect(instructions).toContain('Repeated same-looking rounded cards');
    expect(instructions).toContain('mobile horizontal overflow');
    expect(instructions).toContain('Icons that are vertically misaligned');
    expect(instructions).toContain('Use CSS variables or clear repeated values');
    expect(instructions).toContain('Do not add simulated system status bars');
    expect(instructions).toContain('phone frames, device chrome, browser chrome');
    expect(instructions).toContain('do not change `font-family`');
    expect(instructions).toContain('<i data-lucide="menu"></i>');
    expect(instructions).toContain('Do not use other icon systems, inline SVG icons, emoji icons');
    expect(instructions).toContain('do not target `i`, `i[data-lucide]`, or tag selectors');
    expect(instructions).toContain('.nav-icon svg { width: 18px; height: 18px; stroke-width: 2; }');
    expect(instructions).toContain('call `lucide.createIcons()` after updating the DOM');
    expect(instructions).toContain('Add an extra external resource only when the user explicitly requests it');
    expect(instructions).not.toContain('Do not add new CDN resources');
    expect(instructions).not.toContain('Web Components');
    expect(instructions).not.toContain(':host');
    expect(instructions).not.toContain('pages/od-');
    expect(instructions).not.toContain('manifest');
    expect(instructions).not.toContain('syncSharedComponent');
    expect(instructions).not.toContain('previewSwitchHtml');
    expect(instructions).not.toContain('componentAudit');
    expect(instructions).not.toContain('Use `patch`');
    expect(instructions).not.toContain('retry with a smaller edit or patch');
  });

  it('creates an agent context for single_html projects', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);

    const context = await createDesignPageAgentContext({
      projectId: 'project-1',
      projectType: 'single_html',
      workspaceStore,
    });

    expect(context.projectType).toBe('single_html');
    expect(context.resources).toEqual(defaultResources);
  });

  it('rejects reserved react project contexts', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);

    await expect(
      createDesignPageAgentContext({
        projectId: 'project-1',
        projectType: 'react',
        workspaceStore,
      }),
    ).rejects.toThrow('Unsupported Project Type: react');
  });

  it('registers the single HTML workspace tool set', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const context = await createDesignPageAgentContext({
      projectId: 'project-1',
      projectType: 'single_html',
      workspaceStore,
    });

    createDesignPageAgent(context);
    const config = aiMocks.toolLoopAgent.mock.calls.at(-1)?.[0] as {
      maxRetries?: number;
      tools: Record<string, unknown>;
    };

    expect(config.maxRetries).toBe(5);
    expect(Object.keys(config.tools)).toEqual(
      expect.arrayContaining([
        'copyFile',
        'createHtml',
        'delete',
        'edit',
        'glob',
        'grep',
        'previewRefresh',
        'read',
        'write',
      ]),
    );
    expect(config.tools).not.toHaveProperty('patch');
    expect(config.tools).not.toHaveProperty('previewSwitchHtml');
    expect(config.tools).not.toHaveProperty('syncSharedComponent');
    expect(config.tools).not.toHaveProperty('componentAudit');

    const tools = config.tools as Record<string, { description: string }>;
    expect(tools.read.description).toContain(
      'Read a file or directory from the current Project Workspace',
    );
    expect(tools.read.description).toContain(
      'relative file or directory path inside the Project Workspace',
    );
    expect(tools.glob.description).toContain('Fast file pattern matching tool');
    expect(tools.grep.description).toContain('Fast content search tool');
    expect(tools.edit.description).toContain('You must use the read tool before editing');
    expect(tools.edit.description).toContain('Never include any part of the line number prefix');
    expect(tools.write.description).toContain('Prefer editing existing files with the edit tool');
  });

  it('creates only index.html from the single HTML template', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore, { initializeIndex: false });
    const tools = await createTools(workspaceStore);

    await expectWorkspaceToolOk(tools.createHtml.execute({ path: 'index.html', title: 'CRM' }));

    const html = await workspaceStore.readProjectWorkspaceFile('project-1', 'index.html');
    const entries = await workspaceStore.listProjectWorkspace('project-1');

    expect(html).toContain('<main id="app"></main>');
    expect(html).toContain('body {');
    expect(html).toContain('margin: 0;');
    expect(html).toContain('<script>');
    expect(html).not.toContain('customElements.define');
    expect(entries.map((entry) => entry.path)).not.toContain('pages/od-index-page.js');
  });

  it('rejects non-index createHtml targets and existing index.html', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const tools = await createTools(workspaceStore);

    await expectWorkspaceToolError(
      tools.createHtml.execute({ path: 'detail.html' }),
      'Single HTML projects can only create index.html',
    );
    await expectWorkspaceToolError(
      tools.createHtml.execute({ path: 'index.html' }),
      'Project Workspace HTML file already exists',
    );
  });

  it('allows HTML writes and edits without CDN guard rejection', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const tools = await createTools(workspaceStore);
    const html =
      '<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><main>Old</main></body></html>';

    await expectWorkspaceToolOk(tools.write.execute({ content: html, path: 'index.html' }));
    await expectWorkspaceToolOk(
      tools.edit.execute({
        newString: '<main>New</main>',
        oldString: '<main>Old</main>',
        path: 'index.html',
      }),
    );

    await expect(workspaceStore.readProjectWorkspaceFile('project-1', 'index.html')).resolves.toContain(
      'https://cdn.tailwindcss.com',
    );
    await expect(workspaceStore.readProjectWorkspaceFile('project-1', 'index.html')).resolves.toContain(
      '<main>New</main>',
    );
  });

  it('generates project output with the single_html project type', async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: '已完成。' });

    await expect(
      agent.generateProjectOutput({
        content: '设计首页',
        projectId: 'project-1',
        projectType: 'single_html',
      }),
    ).resolves.toEqual({ content: '已完成。' });
  });
});

async function createWorkspaceStore() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'owndesign-agent-test-'));
  tempRoots.push(tempRoot);

  return new WorkspaceStore({ workspaceRoot: tempRoot });
}

async function createProject(
  workspaceStore: WorkspaceStore,
  options: { initializeIndex?: boolean } = {},
) {
  await workspaceStore.createProject({
    id: 'project-1',
    name: 'Test Project',
    projectType: 'single_html',
    outputType: 'html',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  if (options.initializeIndex !== false) {
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index.html',
      '<!doctype html><html><body><main>Initial</main></body></html>',
    );
  }
}

async function createTools(workspaceStore: WorkspaceStore) {
  const context = await createDesignPageAgentContext({
    projectId: 'project-1',
    projectType: 'single_html',
    workspaceStore,
  });

  createDesignPageAgent(context);

  return (aiMocks.toolLoopAgent.mock.calls.at(-1)?.[0] as {
    tools: Record<
      string,
      {
        execute: (input: Record<string, unknown>) => Promise<unknown>;
      }
    >;
  }).tools;
}

async function expectWorkspaceToolOk(promise: Promise<unknown>) {
  const result = await promise;

  expect(result).toMatchObject({
    ok: true,
    wallTimeMs: expect.any(Number),
  });

  return result;
}

async function expectWorkspaceToolError(promise: Promise<unknown>, message: string) {
  await expect(promise).resolves.toMatchObject({
    error: expect.stringContaining(message),
    ok: false,
    wallTimeMs: expect.any(Number),
  });
}
