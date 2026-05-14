import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConversationService } from "./conversation-service";
import type { DesignPageAgent } from "./design-page-agent";
import { ProjectService } from "./project-service";
import { WorkspaceStore } from "./workspace-store";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (tempRoot) => {
      await rm(tempRoot, { force: true, recursive: true });
    }),
  );
});

async function createWorkspaceStore() {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "hjdesign-conversation-service-"),
  );
  tempRoots.push(tempRoot);

  return new WorkspaceStore({
    workspaceRoot: path.join(tempRoot, ".hjdesign"),
    moveToTrash: async (targetPath) => {
      await rm(targetPath, { force: true, recursive: true });
    },
  });
}

describe("ConversationService", () => {
  it("creates a Conversation file and activates it", async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({
      workspaceStore,
      createId: sequenceIds("project-1", "conversation-1", "conversation-2"),
      now: fixedNow("2026-05-14T10:00:00.000Z"),
    });
    const project = await projectService.createProject({ name: "Project One" });
    const conversationService = new ConversationService({
      workspaceStore,
      createId: sequenceIds("conversation-2"),
      now: fixedNow("2026-05-14T10:05:00.000Z"),
    });

    const createdConversation = await conversationService.createConversation(
      project.id,
    );
    const state = await conversationService.getConversationState(project.id);

    expect(createdConversation.id).toBe("conversation-2");
    expect(state.activeConversationId).toBe("conversation-2");
    expect(state.conversations.map((conversation) => conversation.id)).toEqual([
      "conversation-2",
      "conversation-1",
    ]);

    const storedConversation = JSON.parse(
      await readFile(
        path.join(
          workspaceStore.getWorkspaceRoot(),
          "projects",
          project.id,
          "conversations",
          "conversation-2.json",
        ),
        "utf8",
      ),
    );

    expect(storedConversation.title).toBe("新建会话");
    expect(storedConversation.messages).toEqual([]);
  });

  it("switches the active Conversation and restores it after reload", async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({
      workspaceStore,
      createId: sequenceIds("project-1", "conversation-1"),
      now: fixedNow("2026-05-14T10:00:00.000Z"),
    });
    const project = await projectService.createProject({ name: "Project One" });
    const conversationService = new ConversationService({
      workspaceStore,
      createId: sequenceIds("conversation-2"),
      now: fixedNow("2026-05-14T10:05:00.000Z"),
    });

    await conversationService.createConversation(project.id);
    await conversationService.switchConversation(project.id, "conversation-1");

    const reloadedService = new ConversationService({ workspaceStore });
    const state = await reloadedService.getConversationState(project.id);

    expect(state.activeConversationId).toBe("conversation-1");
  });

  it("sends a user message, appends the agent reply, and auto-generates the title from the first user message", async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({
      workspaceStore,
      createId: sequenceIds("project-1", "conversation-1"),
      now: fixedNow("2026-05-14T10:00:00.000Z"),
    });
    const project = await projectService.createProject({ name: "Project One" });
    const conversationService = new ConversationService({
      designPageAgent: buildFakeDesignPageAgent(),
      workspaceStore,
      now: fixedNow("2026-05-14T10:10:00.000Z"),
    });

    const updatedConversation = await conversationService.sendUserMessage(
      project.id,
      "conversation-1",
      "Build a clean dashboard landing page for a design tool",
    );

    expect(updatedConversation.title).toBe(
      "Build a clean dashboard landing page for a design tool",
    );
    expect(updatedConversation.lastMessageAt).toBe("2026-05-14T10:10:00.000Z");
    expect(updatedConversation.messages).toEqual([
      {
        content: "Build a clean dashboard landing page for a design tool",
        createdAt: "2026-05-14T10:10:00.000Z",
        role: "user",
      },
      {
        content:
          "已生成测试 HTML：Build a clean dashboard landing page for a design tool",
        createdAt: "2026-05-14T10:10:00.000Z",
        role: "assistant",
      },
    ]);
  });

  it("keeps a manually renamed title when sending the first user message", async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({
      workspaceStore,
      createId: sequenceIds("project-1", "conversation-1"),
      now: fixedNow("2026-05-14T10:00:00.000Z"),
    });
    const project = await projectService.createProject({ name: "Project One" });
    const conversationService = new ConversationService({
      designPageAgent: buildFakeDesignPageAgent(),
      workspaceStore,
      now: fixedNow("2026-05-14T10:10:00.000Z"),
    });

    await conversationService.renameConversation(project.id, "conversation-1", {
      title: "Hero concepts",
    });
    const updatedConversation = await conversationService.sendUserMessage(
      project.id,
      "conversation-1",
      "Build a clean dashboard landing page for a design tool",
    );

    expect(updatedConversation.title).toBe("Hero concepts");
  });

  it("keeps Conversation ordering based on the latest message timestamp after sending a message", async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({
      workspaceStore,
      createId: sequenceIds("project-1", "conversation-1", "conversation-2"),
      now: fixedNow("2026-05-14T10:00:00.000Z"),
    });
    const project = await projectService.createProject({ name: "Project One" });
    const conversationService = new ConversationService({
      workspaceStore,
      createId: sequenceIds("conversation-2"),
      now: fixedNow("2026-05-14T10:05:00.000Z"),
    });

    await conversationService.createConversation(project.id);

    const laterConversationService = new ConversationService({
      designPageAgent: buildFakeDesignPageAgent(),
      workspaceStore,
      now: fixedNow("2026-05-14T10:15:00.000Z"),
    });
    await laterConversationService.sendUserMessage(
      project.id,
      "conversation-1",
      "Refresh the main product marketing page",
    );

    const state = await laterConversationService.getConversationState(project.id);

    expect(state.conversations.map((conversation) => conversation.id)).toEqual([
      "conversation-1",
      "conversation-2",
    ]);
    expect(state.conversations[0]?.lastMessageAt).toBe(
      "2026-05-14T10:15:00.000Z",
    );
  });

  it("stores a visible failure message when the design agent throws", async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({
      workspaceStore,
      createId: sequenceIds("project-1", "conversation-1"),
      now: fixedNow("2026-05-14T10:00:00.000Z"),
    });
    const project = await projectService.createProject({ name: "Project One" });
    const conversationService = new ConversationService({
      designPageAgent: buildThrowingDesignPageAgent(),
      workspaceStore,
      now: fixedNow("2026-05-14T10:20:00.000Z"),
    });

    const updatedConversation = await conversationService.sendUserMessage(
      project.id,
      "conversation-1",
      "设计一个 CRM 仪表盘的界面",
    );

    expect(updatedConversation.messages.at(-1)).toEqual({
      content: "生成失败：DeepSeek request failed",
      createdAt: "2026-05-14T10:20:00.000Z",
      role: "assistant",
    });
  });

  it("deleting the active last Conversation immediately replaces it with a new default Conversation", async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({
      workspaceStore,
      createId: sequenceIds("project-1", "conversation-1"),
      now: fixedNow("2026-05-14T10:00:00.000Z"),
    });
    const project = await projectService.createProject({ name: "Project One" });
    const conversationService = new ConversationService({
      workspaceStore,
      createId: sequenceIds("conversation-2"),
      now: fixedNow("2026-05-14T10:15:00.000Z"),
    });

    await conversationService.deleteConversation(project.id, "conversation-1");
    const state = await conversationService.getConversationState(project.id);

    expect(state.activeConversationId).toBe("conversation-2");
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0]?.title).toBe("新建会话");
  });
});

function fixedNow(timestamp: string) {
  return () => timestamp;
}

function sequenceIds(...values: string[]) {
  let index = 0;

  return () => {
    const value = values[index];

    if (!value) {
      throw new Error("No more ids in sequence");
    }

    index += 1;
    return value;
  };
}

function buildFakeDesignPageAgent(): DesignPageAgent {
  return {
    async generateProjectOutput(input) {
      return {
        content: `已生成测试 HTML：${input.content}`,
      };
    },
  };
}

function buildThrowingDesignPageAgent(): DesignPageAgent {
  return {
    async generateProjectOutput() {
      throw new Error("DeepSeek request failed");
    },
  };
}
