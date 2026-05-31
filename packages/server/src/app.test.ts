import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";

const aiMocks = vi.hoisted(() => ({
  createAgentUIStream: vi.fn(),
  toolLoopAgent: vi.fn(function (
    this: { config?: unknown; stream?: unknown },
    config: unknown,
  ) {
    this.config = config;
    this.stream = vi.fn();
  }),
}));

vi.mock("ai", () => ({
  createAgentUIStream: aiMocks.createAgentUIStream,
  createUIMessageStreamResponse: vi.fn(() => new Response("")),
  jsonSchema: vi.fn((schema: unknown) => schema),
  readUIMessageStream: vi.fn(async function* () {}),
  stepCountIs: vi.fn((count: number) => ({ count, type: "stepCountIs" })),
  tool: vi.fn((config: unknown) => config),
  ToolLoopAgent: aiMocks.toolLoopAgent,
}));

vi.mock("@ai-sdk/deepseek", () => ({
  createDeepSeek: vi.fn(() =>
    vi.fn((modelId: string) => ({ modelId, provider: "deepseek" })),
  ),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(() =>
    vi.fn((modelId: string) => ({
      modelId,
      provider: "openai-compatible",
    })),
  ),
}));

import {
  createOwnDesignApp,
  injectTransientMessagesBeforeLastUserMessage,
  mergeStoredAndIncomingMessages,
} from "./app";
import { createWorkspaceStore } from "./services";

const tempRoots: string[] = [];

afterEach(async () => {
  aiMocks.createAgentUIStream.mockReset();
  aiMocks.createAgentUIStream.mockResolvedValue(new ReadableStream({
    start(controller) {
      controller.close();
    },
  }));
  aiMocks.toolLoopAgent.mockClear();
  await Promise.all(
    tempRoots.splice(0).map((tempRoot) =>
      rm(tempRoot, { force: true, recursive: true }),
    ),
  );
});

aiMocks.createAgentUIStream.mockResolvedValue(new ReadableStream({
  start(controller) {
    controller.close();
  },
}));

describe("createOwnDesignApp static hosting", () => {
  it("serves index and static assets from the configured static root", async () => {
    const { app } = await createAppWithStaticRoot();

    const indexResponse = await app.fetch(new Request("http://localhost/"));
    const assetResponse = await app.fetch(
      new Request("http://localhost/assets/app.js"),
    );

    expect(indexResponse.status).toBe(200);
    expect(indexResponse.headers.get("Content-Type")).toContain("text/html");
    expect(await indexResponse.text()).toContain("OwnDesign static shell");
    expect(assetResponse.status).toBe(200);
    expect(await assetResponse.text()).toBe('console.log("asset");');
  });

  it("falls back to index for HTML navigation routes", async () => {
    const { app } = await createAppWithStaticRoot();

    const response = await app.fetch(
      new Request("http://localhost/workspace/project-1", {
        headers: { Accept: "text/html" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("OwnDesign static shell");
  });

  it("returns 404 for missing static assets", async () => {
    const { app } = await createAppWithStaticRoot();

    const response = await app.fetch(
      new Request("http://localhost/assets/missing.js"),
    );

    expect(response.status).toBe(404);
  });

  it("keeps API routes ahead of static hosting", async () => {
    const { app } = await createAppWithStaticRoot();

    const response = await app.fetch(new Request("http://localhost/api/workspace"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty("settings");
  });

  it("does not expose the removed project select route", async () => {
    const { app } = await createAppWithTempOptions();

    const response = await app.fetch(
      new Request("http://localhost/api/projects/project-1/select", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
  });

  it("rejects invalid page edit mode in chat requests", async () => {
    const { app } = await createAppWithTempOptions();

    const response = await app.fetch(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          conversationId: "conversation-1",
          messages: [],
          pageEditMode: "replace_everything",
          projectId: "project-1",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid page edit mode.");
  });

  it("rejects direct page edit mode without a current preview page", async () => {
    const { app } = await createAppWithTempOptions();
    const setupResponse = await app.fetch(
      new Request("http://localhost/api/initial-setup", {
        body: JSON.stringify({
          interfaceLanguage: "zh-CN",
          modelConfigurations: [
            {
              apiKey: "secret",
              baseUrl: "https://example.test/v1",
              contextSizeK: 1000,
              id: "model-1",
              model: "mock-model",
              provider: "openai-compatible",
            },
          ],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const setupBody = (await setupResponse.json()) as { href: string };
    const match = /\/projects\/([^/]+)\/conversations\/([^/?]+)/.exec(
      setupBody.href,
    );

    const response = await app.fetch(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          conversationId: match?.[2],
          messages: [],
          pageEditMode: "direct_edit",
          projectId: match?.[1],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      'Page edit mode "direct_edit" requires a current preview page.',
    );
  });

  it("persists conversation instructions on first chat and sends runtime context transiently", async () => {
    const { app, root } = await createAppWithTempOptions();
    const workspaceRoot = path.join(root, "workspace");
    const { conversationId, projectId } = await setupProject(app);
    const userMessage = createUserMessage("user-1", "设计一个 CRM 仪表盘");

    const response = await app.fetch(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          conversationId,
          messages: [userMessage],
          pageEditMode: "auto",
          previewPath: "dashboard.html",
          projectId,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    await response.text();

    expect(response.status).toBe(200);
    await waitFor(() => expect(aiMocks.createAgentUIStream).toHaveBeenCalled());

    const workspaceStore = createWorkspaceStore({ workspaceRoot });
    const conversation = await workspaceStore.getConversation(
      projectId,
      conversationId,
    );
    const streamInput = aiMocks.createAgentUIStream.mock.calls[0]?.[0] as {
      originalMessages: UIMessage[];
      uiMessages: UIMessage[];
    };

    expect(conversation.agentPromptVersion).toBe(1);
    expect(conversation.agentInstructions).toContain("<design_agent_core>");
    expect(conversation.agentInstructions).toContain("<resource_policy>");
    expect(conversation.agentInstructions).not.toContain("<runtime_context>");
    expect(conversation.agentInstructions).not.toContain(
      "<page_edit_mode_policy>",
    );
    expect(conversation.messages).toEqual([userMessage]);
    expect(streamInput.originalMessages).toEqual([userMessage]);
    expect(streamInput.uiMessages).toHaveLength(2);
    expect(streamInput.uiMessages[0]).toMatchObject({ role: "system" });
    expect(getMessageText(streamInput.uiMessages[0])).toContain(
      "Current preview page: dashboard.html.",
    );
    expect(getMessageText(streamInput.uiMessages[0])).toContain("Mode: auto.");
    expect(streamInput.uiMessages[1]).toEqual(userMessage);
  });

  it("reuses persisted conversation instructions on later chats while refreshing runtime context", async () => {
    const { app, root } = await createAppWithTempOptions();
    const workspaceRoot = path.join(root, "workspace");
    const { conversationId, projectId } = await setupProject(app);
    const workspaceStore = createWorkspaceStore({ workspaceRoot });
    const conversation = await workspaceStore.getConversation(
      projectId,
      conversationId,
    );

    await workspaceStore.updateConversation(projectId, conversationId, {
      ...conversation,
      agentInstructions: "persisted instructions",
      agentPromptVersion: 1,
    });

    const userMessage = createUserMessage("user-1", "改当前页顶部");
    const response = await app.fetch(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          conversationId,
          messages: [userMessage],
          pageEditMode: "auto",
          previewPath: "settings.html",
          projectId,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    await response.text();

    expect(response.status).toBe(200);
    await waitFor(() => expect(aiMocks.createAgentUIStream).toHaveBeenCalled());

    const storedConversation = await workspaceStore.getConversation(
      projectId,
      conversationId,
    );
    const agentConfig = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      instructions: string;
    };
    const streamInput = aiMocks.createAgentUIStream.mock.calls[0]?.[0] as {
      uiMessages: UIMessage[];
    };

    expect(storedConversation.agentInstructions).toBe("persisted instructions");
    expect(agentConfig.instructions).toBe("persisted instructions");
    expect(getMessageText(streamInput.uiMessages[0])).toContain(
      "Current preview page: settings.html.",
    );
    expect(storedConversation.messages).toEqual([userMessage]);
  });

  it("sanitizes conversation messages in workspace responses without changing local records", async () => {
    const { app, root } = await createAppWithTempOptions();
    const workspaceRoot = path.join(root, "workspace");
    const setupResponse = await app.fetch(
      new Request("http://localhost/api/initial-setup", {
        body: JSON.stringify({
          interfaceLanguage: "zh-CN",
          modelConfigurations: [
            {
              apiKey: "secret",
              baseUrl: "https://example.test/v1",
              contextSizeK: 1000,
              id: "model-1",
              model: "mock-model",
              provider: "openai-compatible",
            },
          ],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const setupBody = (await setupResponse.json()) as { href: string };
    const match = /\/projects\/([^/]+)\/conversations\/([^/?]+)/.exec(
      setupBody.href,
    );
    const projectId = match?.[1] ?? "";
    const conversationId = match?.[2] ?? "";
    const workspaceStore = createWorkspaceStore({ workspaceRoot });
    const conversation = await workspaceStore.getConversation(
      projectId,
      conversationId,
    );

    await workspaceStore.updateConversation(projectId, conversationId, {
      ...conversation,
      messages: [
        {
          id: "assistant-1",
          parts: [
            { text: "private reasoning", type: "reasoning" },
            {
              input: { path: "index.html", replace: "private input" },
              output: { content: "private output", path: "index.html" },
              state: "output-available",
              toolCallId: "call-1",
              type: "tool-edit",
            },
            {
              input: { path: "broken.html", replace: "private input" },
              output: {
                error: "private output error",
                ok: false,
                wallTimeMs: 1,
              },
              state: "output-available",
              toolCallId: "call-2",
              type: "tool-write",
            },
          ],
          role: "assistant",
        },
      ],
    });

    const response = await app.fetch(
      new Request(
        `http://localhost/api/workspace?projectId=${projectId}&conversationId=${conversationId}`,
      ),
    );
    const body = (await response.json()) as {
      conversations: Array<{ messages: Array<{ parts: unknown[] }> }>;
    };

    expect(body.conversations[0]?.messages[0]?.parts).toEqual([
      {
        input: { path: "index.html" },
        output: { path: "index.html" },
        state: "output-available",
        toolCallId: "call-1",
        type: "tool-edit",
      },
      {
        input: { path: "broken.html" },
        output: { ok: false },
        state: "output-available",
        toolCallId: "call-2",
        type: "tool-write",
      },
    ]);

    const storedConversation = await workspaceStore.getConversation(
      projectId,
      conversationId,
    );

    expect(storedConversation.messages).toEqual([
      {
        id: "assistant-1",
        parts: [
          { text: "private reasoning", type: "reasoning" },
          {
            input: { path: "index.html", replace: "private input" },
            output: { content: "private output", path: "index.html" },
            state: "output-available",
            toolCallId: "call-1",
            type: "tool-edit",
          },
          {
            input: { path: "broken.html", replace: "private input" },
            output: {
              error: "private output error",
              ok: false,
              wallTimeMs: 1,
            },
            state: "output-available",
            toolCallId: "call-2",
            type: "tool-write",
          },
        ],
        role: "assistant",
      },
    ]);
  });

  it("starts without static hosting when the static root is missing", async () => {
    const { app, root } = await createAppWithTempOptions();

    const response = await app.fetch(new Request("http://localhost/api/settings"));
    const staticResponse = await app.fetch(
      new Request("http://localhost/workspace/project-1"),
    );

    expect(root).toBeDefined();
    expect(response.status).toBe(200);
    expect(staticResponse.status).toBe(404);
  });
});

describe("mergeStoredAndIncomingMessages", () => {
  it("keeps complete stored messages when the frontend sends sanitized history", () => {
    const storedMessages: UIMessage[] = [
      {
        id: "assistant-1",
        parts: [
          { text: "private reasoning", type: "reasoning" },
          {
            input: { path: "index.html", replace: "private input" },
            output: { content: "private output", path: "index.html" },
            state: "output-available",
            toolCallId: "call-1",
            type: "tool-edit",
          },
        ],
        role: "assistant",
      },
    ];
    const incomingMessages: UIMessage[] = [
      {
        id: "assistant-1",
        parts: [
          {
            input: { path: "index.html" },
            output: { path: "index.html" },
            state: "output-available",
            toolCallId: "call-1",
            type: "tool-edit",
          },
        ],
        role: "assistant",
      },
      {
        id: "user-2",
        parts: [{ text: "继续修改", type: "text" }],
        role: "user",
      },
    ];

    expect(
      mergeStoredAndIncomingMessages(storedMessages, incomingMessages),
    ).toEqual([...storedMessages, incomingMessages[1]]);
  });
});

describe("injectTransientMessagesBeforeLastUserMessage", () => {
  it("keeps transient context out of persisted message order inputs", () => {
    const assistantMessage: UIMessage = {
      id: "assistant-1",
      parts: [{ text: "上一轮", type: "text" }],
      role: "assistant",
    };
    const userMessage = createUserMessage("user-2", "继续");
    const transientMessage: UIMessage = {
      id: "runtime",
      parts: [{ text: "runtime", type: "text" }],
      role: "system",
    };

    expect(
      injectTransientMessagesBeforeLastUserMessage(
        [assistantMessage, userMessage],
        [transientMessage],
      ),
    ).toEqual([assistantMessage, transientMessage, userMessage]);
  });
});

async function createAppWithStaticRoot() {
  const root = await createTempRoot();
  const staticRoot = path.join(root, "web");

  await mkdir(path.join(staticRoot, "assets"), { recursive: true });
  await writeFile(
    path.join(staticRoot, "index.html"),
    "<!doctype html><html><body>OwnDesign static shell</body></html>",
  );
  await writeFile(path.join(staticRoot, "assets", "app.js"), 'console.log("asset");');

  return {
    app: createOwnDesignApp({
      settingsPath: path.join(root, "settings.json"),
      staticRoot,
      workspaceRoot: path.join(root, "workspace"),
    }),
    root,
  };
}

async function createAppWithTempOptions() {
  const root = await createTempRoot();

  return {
    app: createOwnDesignApp({
      settingsPath: path.join(root, "settings.json"),
      staticRoot: path.join(root, "missing-web"),
      workspaceRoot: path.join(root, "workspace"),
    }),
    root,
  };
}

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "owndesign-server-test-"));
  tempRoots.push(root);

  return root;
}

async function setupProject(app: ReturnType<typeof createOwnDesignApp>) {
  const setupResponse = await app.fetch(
    new Request("http://localhost/api/initial-setup", {
      body: JSON.stringify({
        interfaceLanguage: "zh-CN",
        modelConfigurations: [
          {
            apiKey: "secret",
            baseUrl: "https://example.test/v1",
            contextSizeK: 1000,
            id: "model-1",
            model: "mock-model",
            provider: "openai-compatible",
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
  const setupBody = (await setupResponse.json()) as { href: string };
  const match = /\/projects\/([^/]+)\/conversations\/([^/?]+)/.exec(
    setupBody.href,
  );

  return {
    conversationId: match?.[2] ?? "",
    projectId: match?.[1] ?? "",
  };
}

function createUserMessage(id: string, text: string): UIMessage {
  return {
    id,
    parts: [{ text, type: "text" }],
    role: "user",
  };
}

function getMessageText(message: UIMessage | undefined) {
  return message?.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("") ?? "";
}

async function waitFor(assertion: () => void) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  throw lastError;
}
