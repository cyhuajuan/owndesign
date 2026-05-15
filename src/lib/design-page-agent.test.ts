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
  it("writes Project Workspace files when the model calls writeFile", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockImplementationOnce(async function (this: {
      config: {
        tools: {
          writeFile: {
            execute: (input: { content: string; path: string }) => Promise<unknown>;
          };
        };
      };
    }) {
      await this.config.tools.writeFile.execute({
        content: "<!doctype html><html><body><main>CRM Dashboard</main></body></html>",
        path: "index.html",
      });

      return { text: "已生成 HTML 页面。" };
    });

    const result = await agent.generateProjectOutput(buildInput());

    expect(result).toEqual({ content: "已生成 HTML 页面。" });
    await expect(
      readFile(
        path.join(
          workspaceStore.getWorkspaceRoot(),
          "projects",
          "project-1",
          "workspace",
          "index.html",
        ),
        "utf8",
      ),
    ).resolves.toContain("CRM Dashboard");
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
          "ask concise follow-up questions instead of modifying files",
        ),
      }),
    );
  });

  it("registers Project Workspace file tools", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: Record<string, unknown>;
    };
    expect(Object.keys(config.tools).sort()).toEqual([
      "addCdnResource",
      "deletePath",
      "editFile",
      "listFiles",
      "readFile",
      "searchFiles",
      "writeFile",
    ]);
    expect(config.tools).not.toHaveProperty("writeHtmlFile");
  });

  it("requires approval before adding CDN resources", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        addCdnResource: {
          needsApproval: boolean;
        };
      };
    };
    expect(config.tools.addCdnResource.needsApproval).toBe(true);
  });

  it("adds approved CDN stylesheets and scripts to index.html", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      "project-1",
      "index.html",
      "<!doctype html><html><head><title>Demo</title></head><body><main></main></body></html>",
    );
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        addCdnResource: {
          execute: (input: {
            crossorigin?: string;
            integrity?: string;
            resourceType: "script" | "stylesheet";
            url: string;
          }) => Promise<unknown>;
        };
      };
    };
    await expect(
      config.tools.addCdnResource.execute({
        integrity: "sha384-demo",
        resourceType: "stylesheet",
        url: "https://cdn.example.com/app.css",
      }),
    ).resolves.toMatchObject({
      added: true,
      path: "index.html",
      resourceType: "stylesheet",
    });
    await expect(
      config.tools.addCdnResource.execute({
        crossorigin: "anonymous",
        resourceType: "script",
        url: "https://cdn.example.com/app.js",
      }),
    ).resolves.toMatchObject({
      added: true,
      path: "index.html",
      resourceType: "script",
    });

    const html = await workspaceStore.readProjectWorkspaceFile(
      "project-1",
      "index.html",
    );
    expect(html).toContain(
      '<link rel="stylesheet" href="https://cdn.example.com/app.css" data-hjdesign-approved-cdn="true" integrity="sha384-demo">',
    );
    expect(html.indexOf("https://cdn.example.com/app.css")).toBeLessThan(
      html.indexOf("</head>"),
    );
    expect(html).toContain(
      '<script src="https://cdn.example.com/app.js" data-hjdesign-approved-cdn="true" crossorigin="anonymous"></script>',
    );
    expect(html.indexOf("https://cdn.example.com/app.js")).toBeLessThan(
      html.indexOf("</body>"),
    );
  });

  it("creates index.html when an approved CDN is added before the page exists", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        addCdnResource: {
          execute: (input: {
            resourceType: "script" | "stylesheet";
            url: string;
          }) => Promise<unknown>;
        };
      };
    };
    await expect(
      config.tools.addCdnResource.execute({
        resourceType: "stylesheet",
        url: "https://cdn.example.com/early.css",
      }),
    ).resolves.toMatchObject({
      added: true,
      createdIndexHtml: true,
      path: "index.html",
    });

    const html = await workspaceStore.readProjectWorkspaceFile(
      "project-1",
      "index.html",
    );
    expect(html).toContain("<!doctype html>");
    expect(html).toContain(
      '<link rel="stylesheet" href="https://cdn.example.com/early.css" data-hjdesign-approved-cdn="true">',
    );
  });

  it("preserves approved CDN tags when index.html is overwritten", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      "project-1",
      "index.html",
      "<!doctype html><html><head></head><body></body></html>",
    );
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        addCdnResource: {
          execute: (input: {
            resourceType: "script" | "stylesheet";
            url: string;
          }) => Promise<unknown>;
        };
        writeFile: {
          execute: (input: { content: string; path: string }) => Promise<unknown>;
        };
      };
    };
    await config.tools.addCdnResource.execute({
      resourceType: "script",
      url: "https://cdn.example.com/approved.js",
    });
    await config.tools.writeFile.execute({
      content:
        "<!doctype html><html><head><title>Next</title></head><body><main>Updated</main></body></html>",
      path: "index.html",
    });

    const html = await workspaceStore.readProjectWorkspaceFile(
      "project-1",
      "index.html",
    );
    expect(html).toContain("<main>Updated</main>");
    expect(html).toContain(
      '<script src="https://cdn.example.com/approved.js" data-hjdesign-approved-cdn="true"></script>',
    );
  });

  it("rejects direct unapproved CDN additions through writeFile", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        writeFile: {
          execute: (input: { content: string; path: string }) => Promise<unknown>;
        };
      };
    };
    await expect(
      config.tools.writeFile.execute({
        content:
          '<!doctype html><html><head><link rel="stylesheet" href="https://cdn.example.com/raw.css"></head><body></body></html>',
        path: "index.html",
      }),
    ).rejects.toThrow("must be approved with addCdnResource");
  });

  it("rejects direct unapproved CDN additions through editFile", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      "project-1",
      "index.html",
      "<!doctype html><html><head></head><body></body></html>",
    );
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        editFile: {
          execute: (input: {
            newText: string;
            oldText: string;
            path: string;
          }) => Promise<unknown>;
        };
      };
    };
    await expect(
      config.tools.editFile.execute({
        newText:
          '<script src="https://cdn.example.com/raw.js"></script></body>',
        oldText: "</body>",
        path: "index.html",
      }),
    ).rejects.toThrow("must be approved with addCdnResource");
  });

  it("does not apply CDN guards to non-index files", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        writeFile: {
          execute: (input: { content: string; path: string }) => Promise<unknown>;
        };
      };
    };
    await expect(
      config.tools.writeFile.execute({
        content: '<script src="https://cdn.example.com/raw.js"></script>',
        path: "notes.html",
      }),
    ).resolves.toMatchObject({
      path: "notes.html",
    });
  });

  it("does not add the same CDN URL twice", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      "project-1",
      "index.html",
      '<!doctype html><html><head><link rel="stylesheet" href="https://cdn.example.com/app.css"></head><body></body></html>',
    );
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        addCdnResource: {
          execute: (input: {
            resourceType: "script" | "stylesheet";
            url: string;
          }) => Promise<unknown>;
        };
      };
    };
    await expect(
      config.tools.addCdnResource.execute({
        resourceType: "stylesheet",
        url: "https://cdn.example.com/app.css",
      }),
    ).resolves.toMatchObject({
      added: false,
      reason: "already-exists",
    });

    const html = await workspaceStore.readProjectWorkspaceFile(
      "project-1",
      "index.html",
    );
    expect(html.match(/cdn\.example\.com\/app\.css/g)).toHaveLength(1);
  });

  it("rejects non-HTTPS CDN URLs", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      "project-1",
      "index.html",
      "<!doctype html><html><head></head><body></body></html>",
    );
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        addCdnResource: {
          execute: (input: {
            resourceType: "script" | "stylesheet";
            url: string;
          }) => Promise<unknown>;
        };
      };
    };
    await expect(
      config.tools.addCdnResource.execute({
        resourceType: "script",
        url: "http://cdn.example.com/app.js",
      }),
    ).rejects.toThrow("CDN URL must use HTTPS");
  });

  it("builds instructions from the core markdown prompt and dynamic Project Output prompt", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      instructions: string;
    };
    expect(config.instructions).toContain("# Design Page Agent");
    expect(config.instructions).toContain(
      "You design and build previewable product pages",
    );
    expect(config.instructions).toContain("## Project Output");
    expect(config.instructions).toContain("Project Output Type: html.");
    expect(config.instructions).toContain("Project Workspace file tools");
    expect(config.instructions).toContain("Only add external CDNs through");
    expect(config.instructions).toContain("preserve any existing");
    expect(config.instructions).toContain("`index.html`");
    expect(config.instructions).not.toContain("Do not:\n- use external CDNs");
    expect(config.instructions).not.toContain("writeHtmlFile");
    expect(config.instructions).not.toContain("Project One");
    expect(config.instructions).not.toContain("project-1");
    expect(config.instructions).not.toContain("conversation-1");
    expect(aiMocks.generate).toHaveBeenCalledWith({
      prompt: "设计一个 CRM 仪表盘的界面",
    });
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
    outputType: "html" as const,
    projectId: "project-1",
  };
}
