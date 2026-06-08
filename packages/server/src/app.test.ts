import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from 'ai';

const aiMocks = vi.hoisted(() => ({
  createAgentUIStream: vi.fn(),
  toolLoopAgent: vi.fn(function (this: { config?: unknown; stream?: unknown }, config: unknown) {
    this.config = config;
    this.stream = vi.fn();
  }),
}));

vi.mock('ai', () => ({
  createAgentUIStream: aiMocks.createAgentUIStream,
  createUIMessageStreamResponse: vi.fn(() => new Response('')),
  readUIMessageStream: vi.fn(async function* () {}),
  stepCountIs: vi.fn((count: number) => ({ count, type: 'stepCountIs' })),
  tool: vi.fn((config: unknown) => config),
  ToolLoopAgent: aiMocks.toolLoopAgent,
}));

vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: vi.fn(() => vi.fn((modelId: string) => ({ modelId, provider: 'deepseek' }))),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn((modelId: string) => ({ modelId, provider: 'anthropic' }))),
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() =>
    vi.fn((modelId: string) => ({ modelId, provider: 'openai-compatible' })),
  ),
}));

import { createOwnDesignApp } from './app';
import { createWorkspaceStore } from './services';

const tempRoots: string[] = [];

afterEach(async () => {
  aiMocks.createAgentUIStream.mockReset();
  aiMocks.createAgentUIStream.mockResolvedValue(
    new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
  );
  aiMocks.toolLoopAgent.mockClear();
  await Promise.all(
    tempRoots.splice(0).map((tempRoot) => rm(tempRoot, { force: true, recursive: true })),
  );
});

aiMocks.createAgentUIStream.mockResolvedValue(
  new ReadableStream({
    start(controller) {
      controller.close();
    },
  }),
);

describe('createOwnDesignApp static hosting', () => {
  it('serves index and static assets from the configured static root', async () => {
    const { app } = await createAppWithStaticRoot();

    const indexResponse = await app.fetch(new Request('http://localhost/'));
    const assetResponse = await app.fetch(new Request('http://localhost/assets/app.js'));

    expect(indexResponse.status).toBe(200);
    expect(indexResponse.headers.get('Content-Type')).toContain('text/html');
    expect(await indexResponse.text()).toContain('OwnDesign static shell');
    expect(assetResponse.status).toBe(200);
    expect(await assetResponse.text()).toBe('console.log("asset");');
  });

  it('returns 404 for missing static assets', async () => {
    const { app } = await createAppWithStaticRoot();

    const response = await app.fetch(new Request('http://localhost/assets/missing.js'));

    expect(response.status).toBe(404);
  });

  it('keeps API routes ahead of static hosting', async () => {
    const { app } = await createAppWithStaticRoot();

    const response = await app.fetch(new Request('http://localhost/api/workspace'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('settings');
  });

  it('creates single_html projects by default', async () => {
    const { app, root } = await createAppWithTempOptions();
    const workspaceRoot = path.join(root, 'workspace');

    const response = await app.fetch(
      new Request('http://localhost/api/projects', {
        body: JSON.stringify({ name: 'Landing Redesign' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );
    const body = (await response.json()) as { href: string };
    const match = /\/projects\/([^/]+)\/conversations\/([^/?]+)/.exec(body.href);
    const projectId = match?.[1] ?? '';
    const workspaceStore = createWorkspaceStore({ workspaceRoot });
    const project = await workspaceStore.getProject(projectId);

    expect(response.status).toBe(200);
    expect(project.projectType).toBe('single_html');
    await expect(workspaceStore.readProjectWorkspaceFile(projectId, 'index.html')).resolves.toContain(
      '<main id="app"></main>',
    );
  });

  it('rejects reserved react project creation', async () => {
    const { app } = await createAppWithTempOptions();

    const response = await app.fetch(
      new Request('http://localhost/api/projects', {
        body: JSON.stringify({ name: 'React App', projectType: 'react' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('React project type is reserved but not supported yet.');
  });

  it('persists single HTML agent instructions on first chat without page edit mode validation', async () => {
    const { app, root } = await createAppWithTempOptions();
    const workspaceRoot = path.join(root, 'workspace');
    const { conversationId, projectId } = await setupProject(app);

    const response = await app.fetch(
      new Request('http://localhost/api/chat', {
        body: JSON.stringify({
          conversationId,
          message: createChatRequestMessage('user-1', '设计一个 CRM 仪表盘'),
          pageEditMode: 'replace_everything',
          previewPath: 'dashboard.html',
          projectId,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );
    await response.text();
    await waitFor(() => expect(aiMocks.createAgentUIStream).toHaveBeenCalled());

    const workspaceStore = createWorkspaceStore({ workspaceRoot });
    const conversation = await workspaceStore.getConversation(projectId, conversationId);
    const streamInput = aiMocks.createAgentUIStream.mock.calls[0]?.[0] as {
      originalMessages: UIMessage[];
      uiMessages: UIMessage[];
    };
    const agentConfig = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      instructions: string;
    };

    expect(response.status).toBe(200);
    expect(conversation.agentPromptVersion).toBe(1);
    expect(conversation.agentInstructions).toContain('# OwnDesign Single HTML Page Agent');
    expect(conversation.agentInstructions).not.toContain('page_edit_mode_policy');
    expect(agentConfig.instructions).toBe(conversation.agentInstructions);
    expect(streamInput.uiMessages).toHaveLength(1);
    expect(getMessageText(streamInput.uiMessages[0])).toBe('设计一个 CRM 仪表盘');
    expect(streamInput.originalMessages).toEqual(streamInput.uiMessages);
  });

  it('ignores frontend message history and appends only submitted user input', async () => {
    const { app, root } = await createAppWithTempOptions();
    const workspaceRoot = path.join(root, 'workspace');
    const { conversationId, projectId } = await setupProject(app);
    const workspaceStore = createWorkspaceStore({ workspaceRoot });
    const conversation = await workspaceStore.getConversation(projectId, conversationId);
    const storedUserMessage = createUserMessage('stored-user-1', 'stored input');
    const frontendOnlyMessage = createUserMessage('frontend-user-ignored', 'frontend history');

    await workspaceStore.updateConversation(projectId, conversationId, {
      ...conversation,
      agentInstructions: 'persisted instructions',
      agentPromptVersion: 1,
      messages: [storedUserMessage],
    });

    const response = await app.fetch(
      new Request('http://localhost/api/chat', {
        body: JSON.stringify({
          conversationId,
          message: createChatRequestMessage('user-2', 'current input'),
          messages: [frontendOnlyMessage],
          projectId,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );
    await response.text();
    await waitFor(() => expect(aiMocks.createAgentUIStream).toHaveBeenCalled());

    const streamInput = aiMocks.createAgentUIStream.mock.calls[0]?.[0] as {
      uiMessages: UIMessage[];
    };

    expect(response.status).toBe(200);
    expect(streamInput.uiMessages.map((message) => message.id)).toEqual([
      'stored-user-1',
      'user-2',
    ]);
    expect(getMessageText(streamInput.uiMessages[1])).toBe('current input');
  });
});

async function createAppWithStaticRoot() {
  const root = await createTempRoot();
  const staticRoot = path.join(root, 'web');

  await mkdir(path.join(staticRoot, 'assets'), { recursive: true });
  await writeFile(
    path.join(staticRoot, 'index.html'),
    '<!doctype html><html><body>OwnDesign static shell</body></html>',
  );
  await writeFile(path.join(staticRoot, 'assets', 'app.js'), 'console.log("asset");');

  return {
    app: createOwnDesignApp({
      settingsPath: path.join(root, 'settings.json'),
      staticRoot,
      workspaceRoot: path.join(root, 'workspace'),
    }),
    root,
  };
}

async function createAppWithTempOptions() {
  const root = await createTempRoot();

  return {
    app: createOwnDesignApp({
      settingsPath: path.join(root, 'settings.json'),
      workspaceRoot: path.join(root, 'workspace'),
    }),
    root,
  };
}

async function createTempRoot() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'owndesign-server-test-'));
  tempRoots.push(tempRoot);

  return tempRoot;
}

async function setupProject(app: ReturnType<typeof createOwnDesignApp>) {
  const setupResponse = await app.fetch(
    new Request('http://localhost/api/initial-setup', {
      body: JSON.stringify({
        interfaceLanguage: 'zh-CN',
        modelConfigurations: [
          {
            apiKey: 'secret',
            baseUrl: 'https://example.test/v1',
            contextSizeK: 1000,
            id: 'model-1',
            model: 'mock-model',
            provider: 'openai-compatible',
          },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }),
  );
  const setupBody = (await setupResponse.json()) as { href: string };
  const match = /\/projects\/([^/]+)\/conversations\/([^/?]+)/.exec(setupBody.href);

  return {
    conversationId: match?.[2] ?? '',
    projectId: match?.[1] ?? '',
  };
}

function createChatRequestMessage(id: string, text: string) {
  return { id, text };
}

function createUserMessage(id: string, text: string): UIMessage {
  return {
    id,
    parts: [{ text, type: 'text' }],
    role: 'user',
  };
}

function getMessageText(message: UIMessage | undefined) {
  return (
    message?.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('') ?? ''
  );
}

async function waitFor(assertion: () => void) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 1000) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  assertion();
}
