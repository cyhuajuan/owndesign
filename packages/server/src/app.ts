import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import { Hono } from "hono";
import { ZipFile } from "yazl";
import {
  createAgentUIStreamResponse,
  type InferAgentUIMessage,
  type LanguageModelUsage,
} from "ai";

import { normalizeConversationMessages } from "@owndesign/core/conversations/chat-messages";
import {
  createDesignPageAgent,
  createDesignPageAgentContext,
} from "@owndesign/core/agent/design-page-agent";
import { getPreviewServerManager } from "@owndesign/core/preview/preview-server-manager";
import { registerFrontendConnection } from "@owndesign/core/realtime/frontend-command-bus";
import {
  parseDeepSeekThinkingMode,
} from "@owndesign/core/settings/settings-service";
import { buildWorkspaceHref } from "@owndesign/core/navigation";

import {
  createConversationService,
  createOwnDesignServices,
  createProjectService,
  createWorkspaceStore,
  type OwnDesignServerOptions,
} from "./services";

type ChatRequestBody = {
  conversationId?: unknown;
  frontendTabId?: unknown;
  messages?: unknown;
  modelConfigurationId?: unknown;
  previewPath?: unknown;
  projectId?: unknown;
  providerOptionsSelection?: unknown;
};

type DesignPageUIMessage = InferAgentUIMessage<
  ReturnType<typeof createDesignPageAgent>
>;

export function createOwnDesignApp(options: OwnDesignServerOptions = {}) {
  const app = new Hono();

  app.use(
    "/api/*",
    cors({
      allowHeaders: ["Content-Type"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      exposeHeaders: ["Content-Disposition", "Content-Length", "Content-Type"],
      origin: options.corsOrigin ?? "*",
    }),
  );

  app.get("/api/workspace", async (context) => {
    const services = createOwnDesignServices(options);
    const projectState = await services.projectService.getProjectState();
    const settings = await services.settingsService.getPublicSettings();
    const requestedProjectId = context.req.query("projectId");
    const requestedConversationId = context.req.query("conversationId");
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
      conversations: conversationState.conversations,
      projects: projectState.projects,
      settings,
    });
  });

  app.get("/api/settings", async (context) => {
    return context.json(
      await createOwnDesignServices(options).settingsService.getPublicSettings(),
    );
  });

  app.put("/api/settings", async (context) => {
    try {
      const body = await context.req.json();

      return context.json(
        await createOwnDesignServices(options).settingsService.updatePublicSettings(
          body,
        ),
      );
    } catch (error) {
      return context.text(
        error instanceof Error ? error.message : "Invalid settings payload.",
        400,
      );
    }
  });

  app.post("/api/initial-setup", async (context) => {
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
      name: "helloworld",
    });

    return context.json({
      href: buildWorkspaceHref({
        conversationId: result.conversation.id,
        projectId: result.project.id,
      }),
    });
  });

  app.post("/api/projects", async (context) => {
    const body = await context.req.json();
    const trimmedName = asNonEmptyString(body.name);

    if (!trimmedName) {
      return context.json({}, 400);
    }

    const result = await createProjectService(options).createProject({
      name: trimmedName,
      description: asNonEmptyString(body.description),
    });

    return context.json({
      href: buildWorkspaceHref({
        conversationId: result.conversation.id,
        projectId: result.project.id,
      }),
    });
  });

  app.patch("/api/projects/:projectId", async (context) => {
    const projectId = context.req.param("projectId");
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

  app.delete("/api/projects/:projectId", async (context) => {
    const projectId = context.req.param("projectId");

    await createProjectService(options).deleteProject(projectId);

    const projectState = await createProjectService(options).getProjectState();
    const fallbackProject = projectState.projects[0];
    const fallbackConversation = fallbackProject
      ? (await createConversationService(options).getConversationState(
          fallbackProject.id,
        )).conversations[0]
      : undefined;

    return context.json({
      href: buildWorkspaceHref({
        conversationId: fallbackConversation?.id,
        projectId: fallbackProject?.id,
      }),
    });
  });

  app.post("/api/projects/:projectId/select", async (context) => {
    const projectId = context.req.param("projectId");
    const conversationState =
      await createConversationService(options).getConversationState(projectId);
    const activeConversation = conversationState.conversations[0];

    return context.json({
      href: buildWorkspaceHref({
        conversationId: activeConversation?.id,
        projectId,
      }),
    });
  });

  app.post("/api/projects/:projectId/conversations", async (context) => {
    const projectId = context.req.param("projectId");
    const conversation =
      await createConversationService(options).createConversation(projectId);

    return context.json({
      href: buildWorkspaceHref({
        conversationId: conversation.id,
        projectId,
      }),
    });
  });

  app.post(
    "/api/projects/:projectId/conversations/:conversationId/select",
    async (context) => {
      const projectId = context.req.param("projectId");
      const conversationId = context.req.param("conversationId");

      await createConversationService(options).switchConversation(
        projectId,
        conversationId,
      );

      return context.json({
        href: buildWorkspaceHref({
          conversationId,
          projectId,
        }),
      });
    },
  );

  app.patch(
    "/api/projects/:projectId/conversations/:conversationId",
    async (context) => {
      const projectId = context.req.param("projectId");
      const conversationId = context.req.param("conversationId");
      const body = await context.req.json();
      const trimmedTitle = asNonEmptyString(body.title);

      if (!trimmedTitle) {
        return context.json({}, 400);
      }

      await createConversationService(options).renameConversation(
        projectId,
        conversationId,
        { title: trimmedTitle },
      );

      return context.json({});
    },
  );

  app.delete(
    "/api/projects/:projectId/conversations/:conversationId",
    async (context) => {
      const projectId = context.req.param("projectId");
      const conversationId = context.req.param("conversationId");
      const currentConversationId = context.req.query("currentConversationId");
      const remainingConversations =
        await createConversationService(options).deleteConversation(
          projectId,
          conversationId,
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
    },
  );

  app.post("/api/chat", async (context) => {
    const body = (await context.req.json()) as ChatRequestBody;
    const projectId = asNonEmptyString(body.projectId);
    const conversationId = asNonEmptyString(body.conversationId);
    const previewPath = asNonEmptyString(body.previewPath);

    if (!projectId || !conversationId || !Array.isArray(body.messages)) {
      return context.text("Invalid chat request.", 400);
    }

    const workspaceStore = createWorkspaceStore(options);
    const project = await workspaceStore.getProject(projectId);

    const messages = normalizeConversationMessages(
      body.messages,
    ) as DesignPageUIMessage[];
    let agentContext;

    try {
      agentContext = await createDesignPageAgentContext({
        currentPreviewPath: previewPath,
        frontendTabId: asNonEmptyString(body.frontendTabId),
        modelConfigurationId: asNonEmptyString(body.modelConfigurationId),
        outputType: project.outputType,
        projectId,
        providerOptionsSelection: parseDeepSeekProviderOptionsSelection(
          body.providerOptionsSelection,
        ),
        workspaceStore,
      });
    } catch (error) {
      return context.text(
        error instanceof Error ? error.message : "Invalid model configuration.",
        400,
      );
    }

    const agent = createDesignPageAgent(agentContext);
    let latestStepUsage: LanguageModelUsage | undefined;

    return createAgentUIStreamResponse({
      agent,
      uiMessages: messages,
      originalMessages: messages,
      sendReasoning: true,
      onStepFinish: (step) => {
        latestStepUsage = step.usage;
      },
      messageMetadata: ({ part }) => {
        if (part.type !== "finish" || !latestStepUsage) {
          return undefined;
        }

        return {
          contextUsage: {
            inputTokens: latestStepUsage.inputTokens,
            outputTokens: latestStepUsage.outputTokens,
            totalTokens: latestStepUsage.totalTokens,
            reasoningTokens:
              latestStepUsage.outputTokenDetails?.reasoningTokens ??
              latestStepUsage.reasoningTokens,
            cachedInputTokens:
              latestStepUsage.inputTokenDetails?.cacheReadTokens ??
              latestStepUsage.cachedInputTokens,
          },
        };
      },
      onError: (error) =>
        error instanceof Error
          ? `生成失败：${error.message}`
          : "生成失败：Unknown error",
      onFinish: async ({ messages: finishedMessages }) => {
        await createConversationService(options).saveUIMessageStream(
          projectId,
          conversationId,
          finishedMessages,
        );
      },
    });
  });

  app.post("/api/projects/:projectId/preview-session", async (context) => {
    const body = await readJson(context.req.raw);
    const clientId = asNonEmptyString(body?.clientId);

    if (!clientId) {
      return context.text("Invalid preview session request.", 400);
    }

    const workspaceStore = createWorkspaceStore(options);
    const manager = getPreviewServerManager(workspaceStore);
    const session = await manager.ensure(
      context.req.param("projectId"),
      clientId,
      asNonEmptyString(body?.previewPath),
    );

    return context.json(session);
  });

  app.delete("/api/projects/:projectId/preview-session", async (context) => {
    const body = await readJson(context.req.raw);
    const clientId = asNonEmptyString(body?.clientId);

    if (!clientId) {
      return context.text("Invalid preview session request.", 400);
    }

    const workspaceStore = createWorkspaceStore(options);
    const manager = getPreviewServerManager(workspaceStore);

    await manager.release(context.req.param("projectId"), clientId);

    return new Response(null, { status: 204 });
  });

  app.post(
    "/api/projects/:projectId/preview-session/heartbeat",
    async (context) => {
      const body = await readJson(context.req.raw);
      const clientId = asNonEmptyString(body?.clientId);

      if (!clientId) {
        return context.text("Invalid preview heartbeat request.", 400);
      }

      const workspaceStore = createWorkspaceStore(options);
      const manager = getPreviewServerManager(workspaceStore);
      const session = await manager.heartbeat(
        context.req.param("projectId"),
        clientId,
        asNonEmptyString(body?.previewPath),
      );

      return context.json(session);
    },
  );

  app.get(
    "/api/projects/:projectId/frontend-capabilities/stream",
    async (context) => {
      const projectId = context.req.param("projectId");
      const tabId = context.req.query("tabId")?.trim();

      if (!tabId) {
        return context.text("Invalid frontend capability stream request.", 400);
      }

      await createWorkspaceStore(options).getProject(projectId);

      context.header("Cache-Control", "no-cache, no-transform");
      context.header("Connection", "keep-alive");
      context.header("Content-Type", "text/event-stream; charset=utf-8");

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
    },
  );

  app.get("/api/projects/:projectId/download", async (context) => {
    const workspaceStore = createWorkspaceStore(options);
    const projectId = context.req.param("projectId");
    const kind = context.req.query("kind");

    if (kind === "current-html") {
      return downloadCurrentHtml(
        workspaceStore,
        projectId,
        context.req.query("previewPath") ?? null,
      );
    }

    if (kind === "workspace-zip") {
      return downloadWorkspaceZip(workspaceStore, projectId);
    }

    return context.text("Invalid download request.", 400);
  });

  return app;
}

async function downloadCurrentHtml(
  workspaceStore: ReturnType<typeof createWorkspaceStore>,
  projectId: string,
  previewPath: string | null,
) {
  if (!previewPath?.trim() || !previewPath.toLowerCase().endsWith(".html")) {
    return new Response("Invalid download request.", { status: 400 });
  }

  try {
    const content = await workspaceStore.readProjectWorkspaceFileBuffer(
      projectId,
      previewPath,
    );

    return new Response(content, {
      headers: {
        "Content-Disposition": createAttachmentDisposition(
          path.basename(previewPath),
        ),
        "Content-Type": "text/html; charset=utf-8",
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
    tempDirectory = await mkdtemp(
      path.join(os.tmpdir(), "owndesign-project-download-"),
    );
    const zipPath = path.join(tempDirectory, "workspace.zip");

    await writeWorkspaceZip(workspaceStore, projectId, zipPath);

    const [zipStats, zipBuffer] = await Promise.all([
      stat(zipPath),
      readFile(zipPath),
    ]);

    await rm(tempDirectory, { force: true, recursive: true });
    tempDirectory = undefined;

    return new Response(zipBuffer, {
      headers: {
        "Content-Disposition": createAttachmentDisposition(
          `${sanitizeDownloadFilename(project.name) || projectId}-workspace.zip`,
        ),
        "Content-Length": String(zipStats.size),
        "Content-Type": "application/zip",
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

async function writeWorkspaceZip(
  workspaceStore: ReturnType<typeof createWorkspaceStore>,
  projectId: string,
  zipPath: string,
) {
  const zipFile = new ZipFile();
  const output = createWriteStream(zipPath);
  const entries = await workspaceStore.listProjectWorkspace(projectId);

  const done = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    zipFile.outputStream.on("error", reject);
  });

  zipFile.outputStream.pipe(output);

  for (const entry of entries) {
    if (entry.type !== "file") {
      continue;
    }

    const content = await workspaceStore.readProjectWorkspaceFileBuffer(
      projectId,
      entry.path,
    );
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

function sanitizeDownloadFilename(value: string | undefined) {
  return value
    // eslint-disable-next-line no-control-regex
    ?.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/[.\s]+$/g, "")
    .trim();
}

function createAsciiFilenameFallback(filename: string) {
  const extension = path.extname(filename);
  const basename = extension ? filename.slice(0, -extension.length) : filename;
  const safeBasename = basename
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "-")
    .replace(/["\\]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  const safeExtension = extension.replace(/[^\x20-\x7E]/g, "");
  const combined = `${safeBasename || "download"}${safeExtension}`;

  return combined || "download";
}

function encodeRFC5987Value(value: string) {
  return encodeURIComponent(value).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function mapWorkspaceErrorToResponse(error: unknown) {
  if (isMissingPathError(error)) {
    return new Response("Project file not found.", { status: 404 });
  }

  if (
    error instanceof Error &&
    (error.message.includes("must be relative") ||
      error.message.includes("escapes workspace") ||
      error.message.includes("symlinks are not supported") ||
      error.message.includes("is not a file"))
  ) {
    return new Response("Invalid download request.", { status: 400 });
  }

  throw error;
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function readJson(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseDeepSeekProviderOptionsSelection(value: unknown) {
  if (!value || typeof value !== "object" || !("deepseek" in value)) {
    return undefined;
  }

  return parseDeepSeekThinkingMode(value.deepseek);
}
