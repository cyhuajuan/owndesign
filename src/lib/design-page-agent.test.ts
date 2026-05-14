import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiSdkDesignPageAgent } from "./design-page-agent";
import { WorkspaceStore } from "./workspace-store";

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
    deepseek: vi.fn((modelId: string) => ({ modelId, provider: "deepseek" })),
    generate,
    toolLoopAgent,
  };
});

vi.mock("@ai-sdk/deepseek", () => ({
  deepseek: aiMocks.deepseek,
}));

vi.mock("ai", () => ({
  jsonSchema: vi.fn((schema: unknown) => schema),
  stepCountIs: vi.fn((count: number) => ({ count, type: "stepCountIs" })),
  tool: vi.fn((config: unknown) => config),
  ToolLoopAgent: aiMocks.toolLoopAgent,
}));

const tempRoots: string[] = [];

beforeEach(() => {
  aiMocks.deepseek.mockClear();
  aiMocks.generate.mockReset();
  aiMocks.toolLoopAgent.mockClear();
});

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (tempRoot) => {
      await rm(tempRoot, { force: true, recursive: true });
    }),
  );
});

describe("AiSdkDesignPageAgent", () => {
  it("writes Project Output only when the model calls writeHtmlFile", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockImplementationOnce(async function (this: {
      config: {
        tools: {
          writeHtmlFile: {
            execute: (input: { html: string }) => Promise<unknown>;
          };
        };
      };
    }) {
      await this.config.tools.writeHtmlFile.execute({
        html: "<html><body><main>CRM Dashboard</main></body></html>",
      });

      return { text: "已生成 HTML 页面。" };
    });

    const result = await agent.generateProjectOutput(buildInput());

    expect(result.content).toBe("已生成 HTML 页面。");
    expect(result.outputPath).toBe(
      path.join(
        workspaceStore.getWorkspaceRoot(),
        "projects",
        "project-1",
        "workspace",
        "index.html",
      ),
    );
    await expect(
      readFile(result.outputPath!, "utf8"),
    ).resolves.toMatch(/^<!doctype html>\n<html>/);
  });

  it("allows normal assistant messages without writing Project Output", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({
      text: "需要确认：这是后台管理界面还是营销落地页？",
    });

    const result = await agent.generateProjectOutput(buildInput());

    expect(result).toEqual({
      content: "需要确认：这是后台管理界面还是营销落地页？",
      outputPath: undefined,
    });
    await expect(
      workspaceStore.readProjectOutput("project-1", "html"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("configures the agent to ask follow-up questions when design details are missing", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    expect(aiMocks.deepseek).toHaveBeenCalledWith("deepseek-v4-flash");
    expect(aiMocks.toolLoopAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining(
          "respond with a normal assistant message that asks concise follow-up questions",
        ),
      }),
    );
  });
});

async function createWorkspaceStore() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "hjdesign-agent-"));
  tempRoots.push(tempRoot);

  return new WorkspaceStore({
    workspaceRoot: path.join(tempRoot, ".hjdesign"),
    moveToTrash: async (targetPath) => {
      await rm(targetPath, { force: true, recursive: true });
    },
  });
}

async function createProject(workspaceStore: WorkspaceStore) {
  await workspaceStore.createProject({
    id: "project-1",
    name: "Project One",
    outputType: "html",
    createdAt: "2026-05-14T10:00:00.000Z",
    updatedAt: "2026-05-14T10:00:00.000Z",
  });
}

function buildInput() {
  return {
    content: "设计一个 CRM 仪表盘的界面",
    conversationId: "conversation-1",
    outputType: "html" as const,
    projectId: "project-1",
    projectName: "Project One",
  };
}
