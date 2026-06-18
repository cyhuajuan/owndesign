import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

const screenshotMocks = vi.hoisted(() => {
  class ScreenshotBrowserUnavailableError extends Error {
    constructor() {
      super(
        'No supported browser was found. Install Chrome/Edge or set OWNDESIGN_SCREENSHOT_BROWSER_EXECUTABLE.',
      );
      this.name = 'ScreenshotBrowserUnavailableError';
    }
  }

  return {
    captureProjectScreenshot: vi.fn(),
    ScreenshotBrowserUnavailableError,
  };
});

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

vi.mock('./screenshot', () => ({
  captureProjectScreenshot: screenshotMocks.captureProjectScreenshot,
  ScreenshotBrowserUnavailableError: screenshotMocks.ScreenshotBrowserUnavailableError,
}));

import { createOwnDesignApp } from './app';
import { createWorkspaceStore } from './services';
import { DESIGN_PAGE_AGENT_PROMPT_VERSION } from '@owndesign/core/agent/design-page-agent';

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
  screenshotMocks.captureProjectScreenshot.mockReset();
  await stopPreviewServerManager();
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
    await expect(
      workspaceStore.readProjectWorkspaceFile(projectId, 'index.html'),
    ).resolves.toContain('<main id="app"></main>');
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
      messageMetadata: (input: { part: { type: string } }) => unknown;
      onStepFinish: (step: { usage: Record<string, unknown> }) => void;
      originalMessages: UIMessage[];
      uiMessages: UIMessage[];
    };
    const agentConfig = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      instructions: string;
    };

    expect(response.status).toBe(200);
    expect(conversation.agentPromptVersion).toBe(DESIGN_PAGE_AGENT_PROMPT_VERSION);
    expect(conversation.agentInstructions).toContain('# OwnDesign Single HTML Page Agent');
    expect(conversation.agentInstructions).toContain('Before editing, form a compact design brief');
    expect(conversation.agentInstructions).toContain(
      'When instructions pull in different directions',
    );
    expect(conversation.agentInstructions).toContain(
      'Use `<main id="app">` for the visible app/page body',
    );
    expect(conversation.agentInstructions).toContain('## Hash-addressable UI State');
    expect(conversation.agentInstructions).toContain('restorable from `location.hash`');
    expect(conversation.agentInstructions).toContain('## Quality Gate');
    expect(conversation.agentInstructions).toContain('Generic AI-style layouts');
    expect(conversation.agentInstructions).not.toContain('You are Codex');
    expect(conversation.agentInstructions).not.toContain('apply_patch');
    expect(conversation.agentInstructions).not.toContain('page_edit_mode_policy');
    expect(agentConfig.instructions).toBe(conversation.agentInstructions);
    expect(streamInput.uiMessages).toHaveLength(1);
    expect(getMessageText(streamInput.uiMessages[0])).toBe('设计一个 CRM 仪表盘');
    expect(streamInput.originalMessages).toEqual(streamInput.uiMessages);
    streamInput.onStepFinish({
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      },
    });
    expect(streamInput.messageMetadata({ part: { type: 'finish' } })).toMatchObject({
      contextUsage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      },
      taskTiming: {
        completedAt: expect.any(String),
        elapsedMs: expect.any(Number),
        startedAt: expect.any(String),
      },
    });
    await expect(workspaceStore.listCheckpoints(projectId)).resolves.toMatchObject([
      {
        conversationId,
        files: ['index.html'],
        projectId,
        userMessageId: 'user-1',
        userPrompt: '设计一个 CRM 仪表盘',
      },
    ]);
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
    expect(aiMocks.toolLoopAgent).toHaveBeenCalled();
    const agentConfig = aiMocks.toolLoopAgent.mock.calls[0]![0] as { instructions: string };

    expect(agentConfig.instructions).toBe('persisted instructions');
    expect(getMessageText(streamInput.uiMessages[1])).toBe('current input');
  });

  it('creates a checkpoint before persisting the submitted user message', async () => {
    const { app, root } = await createAppWithTempOptions();
    const workspaceRoot = path.join(root, 'workspace');
    const { conversationId, projectId } = await setupProject(app);
    const workspaceStore = createWorkspaceStore({ workspaceRoot });

    await workspaceStore.writeProjectWorkspaceFile(projectId, 'index.html', '<main>Before</main>');

    const response = await app.fetch(
      new Request('http://localhost/api/chat', {
        body: JSON.stringify({
          conversationId,
          message: createChatRequestMessage('user-checkpoint', 'Change it'),
          projectId,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );
    await response.text();
    await waitFor(() => expect(aiMocks.createAgentUIStream).toHaveBeenCalled());

    const checkpoints = await workspaceStore.listCheckpoints(projectId);
    const checkpoint = checkpoints[0];
    const checkpointFile = await readFile(
      path.join(
        workspaceRoot,
        'projects',
        projectId,
        'checkpoints',
        checkpoint.id,
        'files',
        'index.html',
      ),
      'utf8',
    );

    expect(response.status).toBe(200);
    expect(checkpoint).toMatchObject({
      conversationId,
      userMessageId: 'user-checkpoint',
      userPrompt: 'Change it',
    });
    expect(checkpointFile).toBe('<main>Before</main>');
  });

  it('does not persist the user message or start the agent when checkpoint creation fails', async () => {
    const { app, root } = await createAppWithTempOptions();
    const workspaceRoot = path.join(root, 'workspace');
    const { conversationId, projectId } = await setupProject(app);
    const workspaceStore = createWorkspaceStore({ workspaceRoot });

    await workspaceStore.deleteProjectWorkspacePath(projectId, 'index.html');

    const response = await app.fetch(
      new Request('http://localhost/api/chat', {
        body: JSON.stringify({
          conversationId,
          message: createChatRequestMessage('user-fail', 'Change it'),
          projectId,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );

    const conversation = await workspaceStore.getConversation(projectId, conversationId);

    expect(response.status).toBe(500);
    expect(aiMocks.createAgentUIStream).not.toHaveBeenCalled();
    expect(conversation.messages).toEqual([]);
  });

  it('lists checkpoints and restores files, conversation, or both', async () => {
    const { app, root } = await createAppWithTempOptions();
    const workspaceRoot = path.join(root, 'workspace');
    const { conversationId, projectId } = await setupProject(app);
    const workspaceStore = createWorkspaceStore({ workspaceRoot });
    const conversation = await workspaceStore.getConversation(projectId, conversationId);

    await workspaceStore.writeProjectWorkspaceFile(projectId, 'index.html', '<main>Before</main>');
    await workspaceStore.createCheckpoint({
      id: 'cp_restore',
      conversationId,
      createdAt: '2026-06-09T10:00:00.000Z',
      projectId,
      userMessageId: 'user-restore',
      userPrompt: 'Bad change',
    });
    await workspaceStore.writeProjectWorkspaceFile(projectId, 'index.html', '<main>After</main>');
    await workspaceStore.updateConversation(projectId, conversationId, {
      ...conversation,
      messages: [
        createUserMessage('kept-user', 'kept'),
        createUserMessage('user-restore', 'bad'),
        {
          id: 'assistant-after',
          parts: [{ text: 'done', type: 'text' }],
          role: 'assistant',
        } satisfies UIMessage,
      ],
    });

    const listResponse = await app.fetch(
      new Request(`http://localhost/api/projects/${projectId}/checkpoints`),
    );
    const listBody = (await listResponse.json()) as Array<{ id: string }>;

    expect(listResponse.status).toBe(200);
    expect(listBody.map((checkpoint) => checkpoint.id)).toEqual(['cp_restore']);

    const filesResponse = await restoreCheckpoint(app, projectId, 'cp_restore', 'files');
    expect(filesResponse.status).toBe(200);
    await expect(workspaceStore.readProjectWorkspaceFile(projectId, 'index.html')).resolves.toBe(
      '<main>Before</main>',
    );
    await expect(workspaceStore.getConversation(projectId, conversationId)).resolves.toMatchObject({
      messages: expect.arrayContaining([expect.objectContaining({ id: 'user-restore' })]),
    });

    await workspaceStore.writeProjectWorkspaceFile(projectId, 'index.html', '<main>After 2</main>');
    const conversationResponse = await restoreCheckpoint(
      app,
      projectId,
      'cp_restore',
      'conversation',
    );
    const truncatedConversation = await workspaceStore.getConversation(projectId, conversationId);

    expect(conversationResponse.status).toBe(200);
    await expect(workspaceStore.readProjectWorkspaceFile(projectId, 'index.html')).resolves.toBe(
      '<main>After 2</main>',
    );
    expect((truncatedConversation.messages as UIMessage[]).map((message) => message.id)).toEqual([
      'kept-user',
    ]);

    await workspaceStore.updateConversation(projectId, conversationId, {
      ...truncatedConversation,
      messages: [createUserMessage('kept-user', 'kept'), createUserMessage('user-restore', 'bad')],
    });
    await workspaceStore.writeProjectWorkspaceFile(projectId, 'index.html', '<main>After 3</main>');
    const bothResponse = await restoreCheckpoint(app, projectId, 'cp_restore', 'both');

    expect(bothResponse.status).toBe(200);
    await expect(workspaceStore.readProjectWorkspaceFile(projectId, 'index.html')).resolves.toBe(
      '<main>Before</main>',
    );
    await expect(workspaceStore.getConversation(projectId, conversationId)).resolves.toMatchObject({
      messages: [expect.objectContaining({ id: 'kept-user' })],
    });
  });
});

describe('createOwnDesignApp project downloads', () => {
  it('rejects screenshot downloads with missing or invalid params', async () => {
    const { app } = await createAppWithTempOptions();
    const { projectId } = await setupProject(app);

    const missingPreviewPathResponse = await app.fetch(
      new Request(
        `http://localhost/api/projects/${projectId}/download?kind=current-screenshot&device=desktop`,
      ),
    );
    const invalidDeviceResponse = await app.fetch(
      new Request(
        `http://localhost/api/projects/${projectId}/download?kind=current-screenshot&previewPath=index.html&device=tablet`,
      ),
    );

    expect(missingPreviewPathResponse.status).toBe(400);
    expect(invalidDeviceResponse.status).toBe(400);
    expect(screenshotMocks.captureProjectScreenshot).not.toHaveBeenCalled();
  });

  it('downloads a desktop screenshot png for the current html', async () => {
    const { app, root } = await createAppWithTempOptions();
    const workspaceStore = createWorkspaceStore({ workspaceRoot: path.join(root, 'workspace') });
    const { projectId } = await setupProject(app);

    await workspaceStore.writeProjectWorkspaceFile(
      projectId,
      'pages/detail.html',
      '<h1>Detail</h1>',
    );
    screenshotMocks.captureProjectScreenshot.mockResolvedValue(Buffer.from('png-detail'));

    const response = await app.fetch(
      new Request(
        `http://localhost/api/projects/${projectId}/download?kind=current-screenshot&previewPath=pages%2Fdetail.html&device=desktop`,
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Content-Disposition')).toContain('detail.png');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from('png-detail'));
    expect(screenshotMocks.captureProjectScreenshot).toHaveBeenCalledWith({
      device: 'desktop',
      url: expect.stringMatching(/\/pages\/detail\.html$/),
    });
  });

  it('passes the mobile device through screenshot downloads', async () => {
    const { app } = await createAppWithTempOptions();
    const { projectId } = await setupProject(app);

    screenshotMocks.captureProjectScreenshot.mockResolvedValue(Buffer.from('png-mobile'));

    const response = await app.fetch(
      new Request(
        `http://localhost/api/projects/${projectId}/download?kind=current-screenshot&previewPath=index.html&device=mobile`,
      ),
    );

    expect(response.status).toBe(200);
    expect(screenshotMocks.captureProjectScreenshot).toHaveBeenCalledWith({
      device: 'mobile',
      url: expect.stringMatching(/\/index\.html$/),
    });
  });

  it('downloads a screenshot for a hash route and includes the route in the filename', async () => {
    const { app } = await createAppWithTempOptions();
    const { projectId } = await setupProject(app);

    screenshotMocks.captureProjectScreenshot.mockResolvedValue(Buffer.from('png-route'));

    const response = await app.fetch(
      new Request(
        `http://localhost/api/projects/${projectId}/download?kind=current-screenshot&previewPath=index.html&device=desktop&route=%23%2Fpricing`,
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain('index-pricing.png');
    expect(screenshotMocks.captureProjectScreenshot).toHaveBeenCalledWith({
      device: 'desktop',
      url: expect.stringMatching(/\/index\.html#\/pricing$/),
    });
  });

  it('preserves hash query state for screenshot downloads', async () => {
    const { app } = await createAppWithTempOptions();
    const { projectId } = await setupProject(app);

    screenshotMocks.captureProjectScreenshot.mockResolvedValue(Buffer.from('png-route-state'));

    const response = await app.fetch(
      new Request(
        `http://localhost/api/projects/${projectId}/download?kind=current-screenshot&previewPath=index.html&device=desktop&route=%23%2Forders%3Ftab%3Dkanban`,
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain('index-orders-tab-kanban.png');
    expect(screenshotMocks.captureProjectScreenshot).toHaveBeenCalledWith({
      device: 'desktop',
      url: expect.stringMatching(/\/index\.html#\/orders\?tab=kanban$/),
    });
  });

  it('rejects screenshot routes that are not hash routes', async () => {
    const { app } = await createAppWithTempOptions();
    const { projectId } = await setupProject(app);

    const pathRouteResponse = await app.fetch(
      new Request(
        `http://localhost/api/projects/${projectId}/download?kind=current-screenshot&previewPath=index.html&device=desktop&route=%2Fpricing`,
      ),
    );
    const absoluteRouteResponse = await app.fetch(
      new Request(
        `http://localhost/api/projects/${projectId}/download?kind=current-screenshot&previewPath=index.html&device=desktop&route=https%3A%2F%2Fexample.test`,
      ),
    );
    const controlCharacterRouteResponse = await app.fetch(
      new Request(
        `http://localhost/api/projects/${projectId}/download?kind=current-screenshot&previewPath=index.html&device=desktop&route=%23%2Fpricing%0A`,
      ),
    );

    expect(pathRouteResponse.status).toBe(400);
    expect(absoluteRouteResponse.status).toBe(400);
    expect(controlCharacterRouteResponse.status).toBe(400);
    expect(screenshotMocks.captureProjectScreenshot).not.toHaveBeenCalled();
  });

  it('returns 503 when no supported screenshot browser is available', async () => {
    const { app } = await createAppWithTempOptions();
    const { projectId } = await setupProject(app);

    screenshotMocks.captureProjectScreenshot.mockRejectedValue(
      new screenshotMocks.ScreenshotBrowserUnavailableError(),
    );

    const response = await app.fetch(
      new Request(
        `http://localhost/api/projects/${projectId}/download?kind=current-screenshot&previewPath=index.html&device=desktop`,
      ),
    );

    expect(response.status).toBe(503);
    expect(await response.text()).toContain('Install Chrome/Edge');
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

function restoreCheckpoint(
  app: ReturnType<typeof createOwnDesignApp>,
  projectId: string,
  checkpointId: string,
  mode: 'files' | 'conversation' | 'both',
) {
  return app.fetch(
    new Request(`http://localhost/api/projects/${projectId}/checkpoints/${checkpointId}/restore`, {
      body: JSON.stringify({ mode }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }),
  );
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

async function stopPreviewServerManager() {
  const globalWithPreviewManager = globalThis as typeof globalThis & {
    __owndesignPreviewServerManager?: {
      stopAll: () => Promise<void>;
    };
  };

  await globalWithPreviewManager.__owndesignPreviewServerManager?.stopAll();
  globalWithPreviewManager.__owndesignPreviewServerManager = undefined;
}
