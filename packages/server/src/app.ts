import { createWriteStream, statSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { serveStatic } from '@hono/node-server/serve-static';
import { cors } from 'hono/cors';
import { stream } from 'hono/streaming';
import { Hono } from 'hono';
import { ZipFile } from 'yazl';
import {
  createAgentUIStream,
  type InferAgentUIMessage,
  type LanguageModelUsage,
  type UIMessage,
} from 'ai';

import {
  getUIMessageText,
  normalizeConversationMessages,
} from '@owndesign/core/conversations/chat-messages';
import { getDefaultConversationTitle } from '@owndesign/core/conversations/default-title';
import {
  buildDesignPageConversationInstructions,
  createDesignPageAgent,
  createDesignPageAgentContext,
  DESIGN_PAGE_AGENT_PROMPT_VERSION,
} from '@owndesign/core/agent/design-page-agent';
import { getPreviewServerManager } from '@owndesign/core/preview/preview-server-manager';
import { registerFrontendConnection } from '@owndesign/core/realtime/frontend-command-bus';
import {
  parseAnthropicEffort,
  parseDeepSeekThinkingMode,
} from '@owndesign/core/settings/settings-service';
import { buildWorkspaceHref } from '@owndesign/core/navigation';
import type { CheckpointRestoreMode } from '@owndesign/core/workspace-store';

import {
  createConversationService,
  createOwnDesignServices,
  createProjectService,
  createWorkspaceStore,
  type OwnDesignServerOptions,
} from './services';
import { createChatRunStreamResponse, getChatRunManager } from './chat-run-manager';
import { sanitizePublicConversation } from './sanitize-ui-message';
import {
  captureProjectScreenshot,
  ScreenshotBrowserUnavailableError,
  type ScreenshotDevice,
} from './screenshot';

type ChatRequestBody = {
  conversationId?: unknown;
  frontendTabId?: unknown;
  message?: unknown;
  messages?: unknown;
  modelConfigurationId?: unknown;
  previewPath?: unknown;
  projectId?: unknown;
  projectType?: unknown;
  providerOptionsSelection?: unknown;
};

type DesignPageUIMessage = InferAgentUIMessage<ReturnType<typeof createDesignPageAgent>>;

export function createOwnDesignApp(options: OwnDesignServerOptions = {}) {
  const app = new Hono();
  const chatRunManager = getChatRunManager(getChatRunManagerKey(options));

  app.use(
    '/api/*',
    cors({
      allowHeaders: ['Content-Type'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['Content-Disposition', 'Content-Length', 'Content-Type'],
      origin: options.corsOrigin ?? '*',
    }),
  );

  app.get('/api/workspace', async (context) => {
    const services = createOwnDesignServices(options);
    const [projectState, settings] = await Promise.all([
      services.projectService.getProjectState(),
      services.settingsService.getPublicSettings(),
    ]);
    const requestedProjectId = context.req.query('projectId');
    const requestedConversationId = context.req.query('conversationId');
    const activeProject =
      projectState.projects.find((project) => project.id === requestedProjectId) ??
      projectState.projects[0];
    const conversationState = activeProject
      ? await services.conversationService.getConversationState(activeProject.id)
      : { conversations: [] };
    const activeConversation =
      conversationState.conversations.find(
        (conversation) => conversation.id === requestedConversationId,
      ) ?? conversationState.conversations[0];

    return context.json({
      activeConversationId: activeConversation?.id,
      activeProject,
      activeRun: activeProject ? chatRunManager.getActiveRun(activeProject.id) : undefined,
      conversations: conversationState.conversations.map(sanitizePublicConversation),
      projects: projectState.projects,
      settings,
    });
  });

  app.get('/api/settings', async (context) => {
    return context.json(await createOwnDesignServices(options).settingsService.getPublicSettings());
  });

  app.put('/api/settings', async (context) => {
    try {
      const body = await context.req.json();

      return context.json(
        await createOwnDesignServices(options).settingsService.updatePublicSettings(body),
      );
    } catch (error) {
      return context.text(
        error instanceof Error ? error.message : 'Invalid settings payload.',
        400,
      );
    }
  });

  app.post('/api/initial-setup', async (context) => {
    const input = await context.req.json();
    const services = createOwnDesignServices(options);
    const modelConfigurations = Array.isArray(input.modelConfigurations)
      ? input.modelConfigurations.map((configuration: Record<string, unknown>) => ({
          apiKey: configuration.apiKey,
          baseUrl: configuration.baseUrl,
          contextSizeK: configuration.contextSizeK,
          id: configuration.id,
          model: configuration.model,
          provider: configuration.provider,
          providerOptions: configuration.providerOptions,
        }))
      : [];

    await services.settingsService.updateSettings({
      defaultModelId: modelConfigurations[0]?.id ?? null,
      interfaceLanguage: input.interfaceLanguage,
      modelConfigurations,
    });

    const result = await services.projectService.createProject({
      defaultConversationTitle: getDefaultConversationTitle(
        input.interfaceLanguage === 'en-US' ? 'en-US' : 'zh-CN',
      ),
      name: 'helloworld',
    });

    return context.json({
      href: buildWorkspaceHref({
        conversationId: result.conversation.id,
        projectId: result.project.id,
      }),
    });
  });

  app.post('/api/projects', async (context) => {
    const body = await context.req.json();
    const trimmedName = asNonEmptyString(body.name);
    const projectType = parseProjectType(body.projectType);

    if (!trimmedName || !projectType) {
      return context.json({}, 400);
    }

    if (projectType === 'react') {
      return context.text('React project type is reserved but not supported yet.', 400);
    }

    const services = createOwnDesignServices(options);
    const settings = await services.settingsService.getSettings();
    const result = await services.projectService.createProject({
      defaultConversationTitle: getDefaultConversationTitle(settings.interfaceLanguage),
      name: trimmedName,
      description: asNonEmptyString(body.description),
      projectType,
    });

    return context.json({
      href: buildWorkspaceHref({
        conversationId: result.conversation.id,
        projectId: result.project.id,
      }),
    });
  });

  app.patch('/api/projects/:projectId', async (context) => {
    const projectId = context.req.param('projectId');
    const body = await context.req.json();
    const trimmedName = asNonEmptyString(body.name);

    if (!trimmedName) {
      return context.json({}, 400);
    }

    await createProjectService(options).renameProject(projectId, {
      name: trimmedName,
      description: asNonEmptyString(body.description),
    });

    return context.json({});
  });

  app.delete('/api/projects/:projectId', async (context) => {
    const projectId = context.req.param('projectId');

    await createProjectService(options).deleteProject(projectId);

    const projectState = await createProjectService(options).getProjectState();
    const fallbackProject = projectState.projects[0];
    const fallbackConversation = fallbackProject
      ? (await createConversationService(options).getConversationState(fallbackProject.id))
          .conversations[0]
      : undefined;

    return context.json({
      href: buildWorkspaceHref({
        conversationId: fallbackConversation?.id,
        projectId: fallbackProject?.id,
      }),
    });
  });

  app.post('/api/projects/:projectId/conversations', async (context) => {
    const projectId = context.req.param('projectId');
    const services = createOwnDesignServices(options);
    const settings = await services.settingsService.getSettings();
    const conversation = await services.conversationService.createConversation(
      projectId,
      getDefaultConversationTitle(settings.interfaceLanguage),
    );

    return context.json({
      href: buildWorkspaceHref({
        conversationId: conversation.id,
        projectId,
      }),
    });
  });

  app.post('/api/projects/:projectId/conversations/:conversationId/select', async (context) => {
    const projectId = context.req.param('projectId');
    const conversationId = context.req.param('conversationId');

    await createConversationService(options).switchConversation(projectId, conversationId);

    return context.json({
      href: buildWorkspaceHref({
        conversationId,
        projectId,
      }),
    });
  });

  app.patch('/api/projects/:projectId/conversations/:conversationId', async (context) => {
    const projectId = context.req.param('projectId');
    const conversationId = context.req.param('conversationId');
    const body = await context.req.json();
    const trimmedTitle = asNonEmptyString(body.title);

    if (!trimmedTitle) {
      return context.json({}, 400);
    }

    await createConversationService(options).renameConversation(projectId, conversationId, {
      title: trimmedTitle,
    });

    return context.json({});
  });

  app.delete('/api/projects/:projectId/conversations/:conversationId', async (context) => {
    const projectId = context.req.param('projectId');
    const conversationId = context.req.param('conversationId');
    const currentConversationId = context.req.query('currentConversationId');
    const services = createOwnDesignServices(options);
    const settings = await services.settingsService.getSettings();
    const remainingConversations = await services.conversationService.deleteConversation(
      projectId,
      conversationId,
      getDefaultConversationTitle(settings.interfaceLanguage),
    );
    const nextConversationId =
      currentConversationId === conversationId
        ? remainingConversations[0]?.id
        : currentConversationId;

    return context.json({
      href: buildWorkspaceHref({
        conversationId: nextConversationId,
        projectId,
      }),
    });
  });

  app.post('/api/chat', async (context) => {
    const body = (await context.req.json()) as ChatRequestBody;
    const projectId = asNonEmptyString(body.projectId);
    const conversationId = asNonEmptyString(body.conversationId);
    const requestedPreviewPath = asNonEmptyString(body.previewPath);
    const currentUserMessage = createCurrentUserMessage(body.message);

    if (!projectId || !conversationId || !currentUserMessage) {
      return context.text('Invalid chat request.', 400);
    }

    const workspaceStore = createWorkspaceStore(options);
    const project = await workspaceStore.getProject(projectId);
    const previewPath = await resolveExistingPreviewPath(
      workspaceStore,
      projectId,
      requestedPreviewPath,
    );

    if (chatRunManager.getActiveRun(projectId)) {
      return context.text('当前项目已有任务正在执行。', 409);
    }

    await workspaceStore.createCheckpoint({
      id: createCheckpointId(),
      conversationId,
      createdAt: new Date().toISOString(),
      projectId,
      userMessageId: currentUserMessage.id,
      userPrompt: getUIMessageText(currentUserMessage),
    });
    let conversation = await workspaceStore.getConversation(projectId, conversationId);
    const storedMessages = normalizeConversationMessages(
      conversation.messages,
    ) as DesignPageUIMessage[];
    let messages = [...storedMessages, currentUserMessage] as DesignPageUIMessage[];
    let agentContext;

    try {
      agentContext = await createDesignPageAgentContext({
        currentPreviewPath: previewPath,
        frontendTabId: asNonEmptyString(body.frontendTabId),
        modelConfigurationId: asNonEmptyString(body.modelConfigurationId),
        projectType: project.projectType ?? 'single_html',
        projectId,
        providerOptionsSelection: parseProviderOptionsSelection(body.providerOptionsSelection),
        settingsPath: options.settingsPath,
        workspaceStore,
      });
    } catch (error) {
      return context.text(
        error instanceof Error ? error.message : 'Invalid model configuration.',
        400,
      );
    }

    if (!conversation.agentInstructions) {
      conversation = await workspaceStore.updateConversation(projectId, conversationId, {
        ...conversation,
        agentInstructions: buildDesignPageConversationInstructions(agentContext.resources),
        agentPromptVersion: DESIGN_PAGE_AGENT_PROMPT_VERSION,
      });
    }

    agentContext.agentInstructions = conversation.agentInstructions;
    const agent = createDesignPageAgent(agentContext);
    let latestStepUsage: LanguageModelUsage | undefined;
    const runStartedAt = new Date().toISOString();

    const run = chatRunManager.startRun({
      conversationId,
      createStream: async (abortSignal) => {
        await createConversationService(options).saveUIMessageStream(
          projectId,
          conversationId,
          messages,
        );

        return createAgentUIStream({
          abortSignal,
          agent,
          uiMessages: messages,
          originalMessages: messages,
          sendReasoning: true,
          onStepFinish: (step) => {
            latestStepUsage = step.usage;
          },
          messageMetadata: ({ part }) => {
            if (part.type !== 'finish') {
              return undefined;
            }

            const completedAt = new Date().toISOString();
            const metadata: Record<string, unknown> = {
              taskTiming: {
                completedAt,
                elapsedMs: Math.max(0, Date.parse(completedAt) - Date.parse(runStartedAt)),
                startedAt: runStartedAt,
              },
            };

            if (latestStepUsage) {
              metadata.contextUsage = {
                inputTokens: latestStepUsage.inputTokens,
                outputTokens: latestStepUsage.outputTokens,
                totalTokens: latestStepUsage.totalTokens,
                reasoningTokens:
                  latestStepUsage.outputTokenDetails?.reasoningTokens ??
                  latestStepUsage.reasoningTokens,
                cachedInputTokens:
                  latestStepUsage.inputTokenDetails?.cacheReadTokens ??
                  latestStepUsage.cachedInputTokens,
              };
            }

            return metadata;
          },
          onError: (error) =>
            error instanceof Error ? `生成失败：${error.message}` : '生成失败：Unknown error',
        });
      },
      initialMessages: messages,
      onFinish: async (finishedMessages) => {
        await createConversationService(options).saveUIMessageStream(
          projectId,
          conversationId,
          finishedMessages as DesignPageUIMessage[],
        );
      },
      projectId,
    });

    if (!run.ok) {
      return context.text('当前项目已有任务正在执行。', 409);
    }

    return createChatRunStreamResponse(run.stream);
  });

  app.get('/api/projects/:projectId/checkpoints', async (context) => {
    const workspaceStore = createWorkspaceStore(options);
    const projectId = context.req.param('projectId');

    await workspaceStore.getProject(projectId);

    return context.json(await workspaceStore.listCheckpoints(projectId));
  });

  app.post('/api/projects/:projectId/checkpoints/:checkpointId/restore', async (context) => {
    const workspaceStore = createWorkspaceStore(options);
    const projectId = context.req.param('projectId');
    const checkpointId = context.req.param('checkpointId');
    const body = await readJson(context.req.raw);
    const mode = parseCheckpointRestoreMode(body?.mode);

    if (!mode) {
      return context.text('Invalid checkpoint restore request.', 400);
    }

    if (chatRunManager.getActiveRun(projectId)) {
      return context.text('当前项目已有任务正在执行。', 409);
    }

    try {
      const checkpoint =
        mode === 'conversation'
          ? await workspaceStore.readCheckpoint(projectId, checkpointId)
          : await workspaceStore.restoreCheckpointFiles(projectId, checkpointId);

      if (mode === 'conversation' || mode === 'both') {
        await restoreCheckpointConversation({
          options,
          workspaceStore,
          checkpoint,
        });
      }

      return context.json({
        href: buildWorkspaceHref({
          conversationId: checkpoint.conversationId,
          projectId,
        }),
      });
    } catch (error) {
      if (isMissingPathError(error)) {
        return context.text('Checkpoint not found.', 404);
      }

      return context.text(
        error instanceof Error ? error.message : 'Checkpoint restore failed.',
        400,
      );
    }
  });

  app.get('/api/projects/:projectId/runs/active', async (context) => {
    const activeRun = chatRunManager.getActiveRun(context.req.param('projectId'));

    if (!activeRun) {
      return new Response(null, { status: 204 });
    }

    return context.json(activeRun);
  });

  app.delete('/api/projects/:projectId/runs/active', async (context) => {
    const activeRun = chatRunManager.cancelActiveRun(context.req.param('projectId'));

    if (!activeRun) {
      return new Response(null, { status: 204 });
    }

    return context.json(activeRun);
  });

  app.get(
    '/api/projects/:projectId/conversations/:conversationId/runs/active/stream',
    async (context) => {
      const afterChunkIndex = Number.parseInt(context.req.query('after') ?? '0', 10);
      const stream = chatRunManager.subscribeActiveRun(
        context.req.param('projectId'),
        context.req.param('conversationId'),
        Number.isFinite(afterChunkIndex) ? afterChunkIndex : 0,
      );

      if (!stream) {
        return new Response(null, { status: 204 });
      }

      return createChatRunStreamResponse(stream);
    },
  );

  app.get(
    '/api/projects/:projectId/conversations/:conversationId/runs/active/snapshot',
    async (context) => {
      const snapshot = chatRunManager.getActiveRunSnapshot(
        context.req.param('projectId'),
        context.req.param('conversationId'),
      );

      if (!snapshot) {
        return new Response(null, { status: 204 });
      }

      return context.json(snapshot);
    },
  );

  app.post('/api/projects/:projectId/preview-session', async (context) => {
    const body = await readJson(context.req.raw);
    const clientId = asNonEmptyString(body?.clientId);

    if (!clientId) {
      return context.text('Invalid preview session request.', 400);
    }

    const workspaceStore = createWorkspaceStore(options);
    const manager = getPreviewServerManager(workspaceStore);
    const session = await manager.ensure(
      context.req.param('projectId'),
      clientId,
      asNonEmptyString(body?.previewPath),
    );

    return context.json(session);
  });

  app.delete('/api/projects/:projectId/preview-session', async (context) => {
    const body = await readJson(context.req.raw);
    const clientId = asNonEmptyString(body?.clientId);

    if (!clientId) {
      return context.text('Invalid preview session request.', 400);
    }

    const workspaceStore = createWorkspaceStore(options);
    const manager = getPreviewServerManager(workspaceStore);

    await manager.release(context.req.param('projectId'), clientId);

    return new Response(null, { status: 204 });
  });

  app.post('/api/projects/:projectId/preview-session/heartbeat', async (context) => {
    const body = await readJson(context.req.raw);
    const clientId = asNonEmptyString(body?.clientId);

    if (!clientId) {
      return context.text('Invalid preview heartbeat request.', 400);
    }

    const workspaceStore = createWorkspaceStore(options);
    const manager = getPreviewServerManager(workspaceStore);
    const session = await manager.heartbeat(
      context.req.param('projectId'),
      clientId,
      asNonEmptyString(body?.previewPath),
    );

    return context.json(session);
  });

  app.get('/api/projects/:projectId/frontend-capabilities/stream', async (context) => {
    const projectId = context.req.param('projectId');
    const tabId = context.req.query('tabId')?.trim();

    if (!tabId) {
      return context.text('Invalid frontend capability stream request.', 400);
    }

    await createWorkspaceStore(options).getProject(projectId);

    context.header('Cache-Control', 'no-cache, no-transform');
    context.header('Connection', 'keep-alive');
    context.header('Content-Type', 'text/event-stream; charset=utf-8');

    return stream(context, async (streamApi) => {
      const commandStream = registerFrontendConnection({
        frontendTabId: tabId,
        projectId,
        signal: context.req.raw.signal,
      });
      const reader = commandStream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          await streamApi.write(value);
        }
      } finally {
        reader.releaseLock();
      }
    });
  });

  app.get('/api/projects/:projectId/download', async (context) => {
    const workspaceStore = createWorkspaceStore(options);
    const projectId = context.req.param('projectId');
    const kind = context.req.query('kind');

    if (kind === 'current-html') {
      return downloadCurrentHtml(
        workspaceStore,
        projectId,
        context.req.query('previewPath') ?? null,
      );
    }

    if (kind === 'workspace-zip') {
      return downloadWorkspaceZip(workspaceStore, projectId);
    }

    if (kind === 'current-screenshot') {
      const route = parseScreenshotRoute(context.req.query('route'));

      if (!route.ok) {
        return context.text('Invalid download request.', 400);
      }

      return downloadCurrentScreenshot(
        workspaceStore,
        projectId,
        context.req.query('previewPath') ?? null,
        parseScreenshotDevice(context.req.query('device')),
        route.value,
      );
    }

    return context.text('Invalid download request.', 400);
  });

  registerStaticHosting(app, options.staticRoot);

  return app;
}

function registerStaticHosting(app: Hono, staticRoot: string | undefined) {
  const indexPath = resolveStaticIndexPath(staticRoot);

  if (!indexPath || !staticRoot) {
    return;
  }

  const serveStaticFile = serveStatic({ root: staticRoot });

  app.use('*', async (context, next) => {
    if (isApiPath(context.req.path)) {
      return next();
    }

    const staticResponse = await serveStaticFile(context, async () => {});

    if (staticResponse || context.finalized) {
      return staticResponse;
    }

    if (!shouldServeSpaIndex(context.req.raw, context.req.path)) {
      return next();
    }

    return htmlResponse(await readFile(indexPath, 'utf8'));
  });
}

function resolveStaticIndexPath(staticRoot: string | undefined) {
  if (!staticRoot) {
    return undefined;
  }

  try {
    const rootStats = statSync(staticRoot);
    const indexPath = path.join(staticRoot, 'index.html');
    const indexStats = statSync(indexPath);

    if (!rootStats.isDirectory() || !indexStats.isFile()) {
      return undefined;
    }

    return indexPath;
  } catch {
    return undefined;
  }
}

function isApiPath(requestPath: string) {
  return requestPath === '/api' || requestPath.startsWith('/api/');
}

function shouldServeSpaIndex(request: Request, requestPath: string) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  if (path.extname(requestPath)) {
    return false;
  }

  const accept = request.headers.get('Accept');

  return !accept || accept.includes('text/html') || accept.includes('*/*');
}

function htmlResponse(html: string) {
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function downloadCurrentHtml(
  workspaceStore: ReturnType<typeof createWorkspaceStore>,
  projectId: string,
  previewPath: string | null,
) {
  if (!previewPath?.trim() || !previewPath.toLowerCase().endsWith('.html')) {
    return new Response('Invalid download request.', { status: 400 });
  }

  try {
    const content = await workspaceStore.readProjectWorkspaceFileBuffer(projectId, previewPath);

    return new Response(new Uint8Array(content), {
      headers: {
        'Content-Disposition': createAttachmentDisposition(path.basename(previewPath)),
        'Content-Type': 'text/html; charset=utf-8',
      },
      status: 200,
    });
  } catch (error) {
    return mapWorkspaceErrorToResponse(error);
  }
}

async function downloadWorkspaceZip(
  workspaceStore: ReturnType<typeof createWorkspaceStore>,
  projectId: string,
) {
  let tempDirectory: string | undefined;

  try {
    const project = await workspaceStore.getProject(projectId);
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'owndesign-project-download-'));
    const zipPath = path.join(tempDirectory, 'workspace.zip');

    await writeWorkspaceZip(workspaceStore, projectId, zipPath);

    const [zipStats, zipBuffer] = await Promise.all([stat(zipPath), readFile(zipPath)]);

    await rm(tempDirectory, { force: true, recursive: true });
    tempDirectory = undefined;

    return new Response(zipBuffer, {
      headers: {
        'Content-Disposition': createAttachmentDisposition(
          `${sanitizeDownloadFilename(project.name) || projectId}-workspace.zip`,
        ),
        'Content-Length': String(zipStats.size),
        'Content-Type': 'application/zip',
      },
      status: 200,
    });
  } catch (error) {
    if (tempDirectory) {
      await rm(tempDirectory, { force: true, recursive: true }).catch(() => {});
    }

    return mapWorkspaceErrorToResponse(error);
  }
}

async function downloadCurrentScreenshot(
  workspaceStore: ReturnType<typeof createWorkspaceStore>,
  projectId: string,
  previewPath: string | null,
  device: ScreenshotDevice | undefined,
  route: string | undefined,
) {
  if (!previewPath?.trim() || !previewPath.toLowerCase().endsWith('.html') || !device) {
    return new Response('Invalid download request.', { status: 400 });
  }

  const clientId = `screenshot-${randomUUID()}`;
  const previewManager = getPreviewServerManager(workspaceStore);

  try {
    await workspaceStore.readProjectWorkspaceFileBuffer(projectId, previewPath);
    const session = await previewManager.ensure(projectId, clientId, previewPath);

    if (!session.activePath || session.activePath !== previewPath) {
      return new Response('Project file not found.', { status: 404 });
    }

    const content = await captureProjectScreenshot({
      device,
      url: buildScreenshotUrl(session.url, route),
    });

    return new Response(new Uint8Array(content), {
      headers: {
        'Content-Disposition': createAttachmentDisposition(
          createScreenshotDownloadFilename(previewPath, route),
        ),
        'Content-Type': 'image/png',
      },
      status: 200,
    });
  } catch (error) {
    if (error instanceof ScreenshotBrowserUnavailableError) {
      return new Response(error.message, { status: 503 });
    }

    try {
      return mapWorkspaceErrorToResponse(error);
    } catch {
      return new Response('Screenshot capture failed.', { status: 500 });
    }
  } finally {
    await previewManager.release(projectId, clientId).catch(() => {});
  }
}

async function writeWorkspaceZip(
  workspaceStore: ReturnType<typeof createWorkspaceStore>,
  projectId: string,
  zipPath: string,
) {
  const zipFile = new ZipFile();
  const output = createWriteStream(zipPath);
  const entries = await workspaceStore.listProjectWorkspace(projectId);

  const done = new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    zipFile.outputStream.on('error', reject);
  });

  zipFile.outputStream.pipe(output);

  for (const entry of entries) {
    if (entry.type !== 'file') {
      continue;
    }

    const content = await workspaceStore.readProjectWorkspaceFileBuffer(projectId, entry.path);
    zipFile.addBuffer(content, entry.path);
  }

  zipFile.end();
  await done;
}

function createAttachmentDisposition(filename: string) {
  const fallbackFilename = createAsciiFilenameFallback(filename);
  const encodedFilename = encodeRFC5987Value(filename);

  return `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`;
}

function parseScreenshotDevice(value: string | undefined): ScreenshotDevice | undefined {
  return value === 'desktop' || value === 'mobile' ? value : undefined;
}

function parseScreenshotRoute(value: string | undefined) {
  if (value === undefined || value === '') {
    return { ok: true as const, value: undefined };
  }

  if (!value.startsWith('#') || hasControlCharacter(value)) {
    return { ok: false as const };
  }

  return { ok: true as const, value };
}

function hasControlCharacter(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;

    if (codePoint <= 0x1f || codePoint === 0x7f) {
      return true;
    }
  }

  return false;
}

function buildScreenshotUrl(url: string, route: string | undefined) {
  if (!route) {
    return url;
  }

  const screenshotUrl = new URL(url);
  screenshotUrl.hash = route;

  return screenshotUrl.toString();
}

function createScreenshotDownloadFilename(previewPath: string, route: string | undefined) {
  const extension = path.extname(previewPath);
  const basename = path.basename(previewPath, extension) || 'screenshot';

  if (!route) {
    return `${basename}.png`;
  }

  const routeSlug = route
    .slice(1)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${basename}${routeSlug ? `-${routeSlug}` : ''}.png`;
}

function sanitizeDownloadFilename(value: string | undefined) {
  return (
    value
      // eslint-disable-next-line no-control-regex
      ?.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
      .replace(/[.\s]+$/g, '')
      .trim()
  );
}

function createAsciiFilenameFallback(filename: string) {
  const extension = path.extname(filename);
  const basename = extension ? filename.slice(0, -extension.length) : filename;
  const safeBasename = basename
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '-')
    .replace(/["\\]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  const safeExtension = extension.replace(/[^\x20-\x7E]/g, '');
  const combined = `${safeBasename || 'download'}${safeExtension}`;

  return combined || 'download';
}

function encodeRFC5987Value(value: string) {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function mapWorkspaceErrorToResponse(error: unknown) {
  if (isMissingPathError(error)) {
    return new Response('Project file not found.', { status: 404 });
  }

  if (
    error instanceof Error &&
    (error.message.includes('must be relative') ||
      error.message.includes('escapes workspace') ||
      error.message.includes('symlinks are not supported') ||
      error.message.includes('is not a file'))
  ) {
    return new Response('Invalid download request.', { status: 400 });
  }

  throw error;
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function getChatRunManagerKey(options: OwnDesignServerOptions) {
  return JSON.stringify({
    settingsPath: options.settingsPath ?? '',
    workspaceRoot: options.workspaceRoot ?? '',
  });
}

async function readJson(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function createCurrentUserMessage(value: unknown): UIMessage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = asNonEmptyString(value.id);
  const text = typeof value.text === 'string' ? value.text : '';
  const files = Array.isArray(value.files) ? value.files.filter(isFileUIPart) : [];
  const parts: UIMessage['parts'] = [...(text ? [{ text, type: 'text' as const }] : []), ...files];

  if (!id || parts.length === 0) {
    return undefined;
  }

  return {
    id,
    parts,
    role: 'user',
  };
}

function isFileUIPart(value: unknown): value is UIMessage['parts'][number] {
  return isRecord(value) && value.type === 'file';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function resolveExistingPreviewPath(
  workspaceStore: ReturnType<typeof createWorkspaceStore>,
  projectId: string,
  previewPath?: string,
) {
  if (!previewPath) {
    return undefined;
  }

  const htmlFiles = await workspaceStore.listProjectHtmlFiles(projectId);

  return htmlFiles.includes(previewPath) ? previewPath : undefined;
}

function asNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseProjectType(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return 'single_html' as const;
  }

  if (value === 'single_html' || value === 'react') {
    return value;
  }

  return undefined;
}

function parseCheckpointRestoreMode(value: unknown): CheckpointRestoreMode | undefined {
  return value === 'files' || value === 'conversation' || value === 'both' ? value : undefined;
}

function parseProviderOptionsSelection(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  const deepseek = parseDeepSeekThinkingMode(value.deepseek);
  const anthropic = parseAnthropicEffort(value.anthropic);

  if (!deepseek && !anthropic) {
    return undefined;
  }

  return {
    ...(anthropic ? { anthropic } : {}),
    ...(deepseek ? { deepseek } : {}),
  };
}

function createCheckpointId() {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `cp_${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

async function restoreCheckpointConversation({
  checkpoint,
  options,
  workspaceStore,
}: {
  checkpoint: {
    conversationId: string;
    projectId: string;
    userMessageId: string;
  };
  options: OwnDesignServerOptions;
  workspaceStore: ReturnType<typeof createWorkspaceStore>;
}) {
  const conversation = await workspaceStore.getConversation(
    checkpoint.projectId,
    checkpoint.conversationId,
  );
  const messages = normalizeConversationMessages(conversation.messages);
  const targetIndex = messages.findIndex((message) => message.id === checkpoint.userMessageId);

  if (targetIndex < 0) {
    throw new Error('Checkpoint user message was not found in the conversation.');
  }

  const nextMessages = messages.slice(0, targetIndex);
  const settings = await createOwnDesignServices(options).settingsService.getSettings();
  const timestamp = new Date().toISOString();
  const lastMessage = nextMessages.at(-1);

  await workspaceStore.updateConversation(checkpoint.projectId, checkpoint.conversationId, {
    ...conversation,
    lastMessageAt: lastMessage ? timestamp : undefined,
    messages: nextMessages,
    title:
      !conversation.titleManuallySet && nextMessages.length === 0
        ? getDefaultConversationTitle(settings.interfaceLanguage)
        : conversation.title,
    updatedAt: timestamp,
  });
}
