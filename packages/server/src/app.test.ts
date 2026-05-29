import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import { createOwnDesignApp, mergeStoredAndIncomingMessages } from "./app";
import { createWorkspaceStore } from "./services";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((tempRoot) =>
      rm(tempRoot, { force: true, recursive: true }),
    ),
  );
});

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
