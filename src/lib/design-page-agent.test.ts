import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AiSdkDesignPageAgent,
  createDesignPageAgentContext,
  buildProviderOptions,
} from "./design-page-agent";
import { createWorkspaceToolRegistry } from "./agent-tools/core";
import { createProjectWorkspaceToolDefinitions } from "./agent-tools/project-workspace-tools";
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
    createDeepSeek: vi.fn(() =>
      vi.fn((modelId: string) => ({ modelId, provider: "deepseek" })),
    ),
    createOpenAICompatible: vi.fn(() =>
      vi.fn((modelId: string) => ({
        modelId,
        provider: "openai-compatible",
      })),
    ),
    generate,
    getSettings: vi.fn(),
    resolveModelConfiguration: vi.fn(),
    sendFrontendCommand: vi.fn(),
    toolLoopAgent,
  };
});

vi.mock("@ai-sdk/deepseek", () => ({
  createDeepSeek: aiMocks.createDeepSeek,
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: aiMocks.createOpenAICompatible,
}));

vi.mock("./settings-service", () => ({
  createSettingsService: () => ({
    getSettings: aiMocks.getSettings,
    resolveModelConfiguration: aiMocks.resolveModelConfiguration,
  }),
}));

vi.mock("@/lib/frontend-command-bus", () => ({
  sendFrontendCommand: aiMocks.sendFrontendCommand,
}));

vi.mock("ai", () => ({
  jsonSchema: vi.fn((schema: unknown) => schema),
  stepCountIs: vi.fn((count: number) => ({ count, type: "stepCountIs" })),
  tool: vi.fn((config: unknown) => config),
  ToolLoopAgent: aiMocks.toolLoopAgent,
}));

const tempRoots: string[] = [];

const defaultResources = {
  fontLibraries: [
    {
      id: "font-1",
      name: "Configured Font",
      cdn: "https://cdn.example.com/font.css",
      isDefault: true,
    },
    {
      id: "font-2",
      name: "Alt Font",
      cdn: "",
      isDefault: false,
    },
  ],
  iconLibraries: [
    {
      id: "icon-1",
      name: "Configured Icons",
      cdn: "https://cdn.example.com/icons.js",
      isDefault: true,
    },
  ],
};

beforeEach(() => {
  aiMocks.createDeepSeek.mockClear();
  aiMocks.createOpenAICompatible.mockClear();
  aiMocks.generate.mockReset();
  aiMocks.getSettings.mockReset();
  aiMocks.getSettings.mockResolvedValue({
    resources: defaultResources,
  });
  aiMocks.resolveModelConfiguration.mockReset();
  aiMocks.resolveModelConfiguration.mockResolvedValue({
    apiKey: "secret",
    baseUrl: "https://api.deepseek.com",
    contextSizeK: 1000,
    id: "model-1",
    model: "deepseek-v4-flash",
    provider: "deepseek",
  });
  aiMocks.sendFrontendCommand.mockReset();
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
  it("writes Project Workspace files when the model calls write", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockImplementationOnce(async function (this: {
      config: {
        tools: {
          write: {
            execute: (input: { content: string; path: string }) => Promise<unknown>;
          };
        };
      };
    }) {
      await this.config.tools.write.execute({
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

  it("configures the agent to ask follow-up questions only when page target remains ambiguous", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    expect(aiMocks.createDeepSeek).toHaveBeenCalledWith({
      apiKey: "secret",
      baseURL: "https://api.deepseek.com",
    });
    expect(aiMocks.toolLoopAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: expect.stringContaining(
          "Ask a follow-up question only when the target page remains ambiguous",
        ),
        providerOptions: {
          deepseek: {
            thinking: { type: "enabled" },
            reasoningEffort: "high",
          },
        },
      }),
    );
  });

  it("maps DeepSeek thinking modes to provider options", () => {
    const configuration = {
      apiKey: "secret",
      baseUrl: "",
      contextSizeK: 1000,
      id: "model-1",
      model: "deepseek-chat",
      provider: "deepseek" as const,
    };

    expect(buildProviderOptions(configuration, "disabled")).toEqual({
      deepseek: {
        thinking: { type: "disabled" },
      },
    });
    expect(buildProviderOptions(configuration, "max")).toEqual({
      deepseek: {
        thinking: { type: "enabled" },
        reasoningEffort: "max",
      },
    });
  });

  it("creates a design agent context from settings, model selection, and preview state", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);

    const context = await createDesignPageAgentContext({
      currentPreviewPath: "dashboard.html",
      modelConfigurationId: "model-1",
      outputType: "html",
      projectId: "project-1",
      providerOptionsSelection: "max",
      workspaceStore,
    });

    expect(aiMocks.resolveModelConfiguration).toHaveBeenCalledWith("model-1");
    expect(context).toMatchObject({
      currentPreviewPath: "dashboard.html",
      outputType: "html",
      projectId: "project-1",
      providerOptions: {
        deepseek: {
          thinking: { type: "enabled" },
          reasoningEffort: "max",
        },
      },
      resources: defaultResources,
      workspaceStore,
    });
    expect(context.model).toEqual({
      modelId: "deepseek-v4-flash",
      provider: "deepseek",
    });
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
      "callFrontendCapability",
      "createHtml",
      "delete",
      "edit",
      "glob",
      "grep",
      "patch",
      "read",
      "write",
    ]);
    expect(config.tools).not.toHaveProperty("writeFile");
    expect(config.tools).not.toHaveProperty("addCdnResource");
  });

  it("builds Project Workspace tools from one registry with metadata", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        __metadata: Record<string, { parallelSafe: boolean }>;
        patch: { inputSchema: { properties: unknown } };
        read: { inputSchema: { required: string[] } };
      };
    };
    expect(config.tools.__metadata.read).toEqual({ parallelSafe: true });
    expect(config.tools.__metadata.patch).toEqual({ parallelSafe: false });
    expect(config.tools.read.inputSchema.required).toEqual(["path"]);
    expect(config.tools.patch.inputSchema.properties).toHaveProperty("changes");

    const definitions = createProjectWorkspaceToolDefinitions();
    expect(() =>
      createWorkspaceToolRegistry([definitions[0], definitions[0]], {
        projectId: "project-1",
        resources: defaultResources,
        workspaceStore,
      }),
    ).toThrow("already registered");
  });

  it("creates missing HTML from configured resource defaults", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        createHtml: {
          execute: (input: {
            path: string;
            title?: string;
          }) => Promise<unknown>;
        };
      };
    };
    await expect(
      expectWorkspaceToolOk(
        config.tools.createHtml.execute({
        path: "index.html",
        title: "CRM Dashboard",
        }),
      ),
    ).resolves.toMatchObject({
      fontLibrary: {
        cdn: "https://cdn.example.com/font.css",
        name: "Configured Font",
      },
      iconLibrary: {
        cdn: "https://cdn.example.com/icons.js",
        name: "Configured Icons",
      },
      path: "index.html",
      title: "CRM Dashboard",
    });

    const html = await workspaceStore.readProjectWorkspaceFile(
      "project-1",
      "index.html",
    );
    expect(html).toContain("<main id=\"app\"></main>");
    expect(html).toContain("@import url('https://cdn.example.com/font.css');");
    expect(html).toContain(
      '<script src="https://cdn.example.com/icons.js" data-hjdesign-approved-cdn="true"></script>',
    );
    expect(html).not.toContain("tailwindcss");
  });

  it("creates HTML with explicit resource selections", async () => {
    aiMocks.getSettings.mockResolvedValueOnce({
      resources: {
        fontLibraries: [
          {
            id: "font-1",
            name: "Default Font",
            cdn: "https://cdn.example.com/default-font.css",
            isDefault: true,
          },
          {
            id: "font-2",
            name: "Display Font",
            cdn: "",
            isDefault: false,
          },
        ],
        iconLibraries: [
          {
            id: "icon-1",
            name: "Default Icons",
            cdn: "https://cdn.example.com/default-icons.js",
            isDefault: true,
          },
          {
            id: "icon-2",
            name: "Font Awesome",
            cdn: "https://cdn.example.com/font-awesome.css",
            isDefault: false,
          },
        ],
      },
    });
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        createHtml: {
          execute: (input: {
            fontLibraryName?: string;
            iconLibraryName?: string;
            path: string;
          }) => Promise<unknown>;
        };
      };
    };
    await expect(
      expectWorkspaceToolOk(
        config.tools.createHtml.execute({
        fontLibraryName: "Display Font",
        iconLibraryName: "Font Awesome",
        path: "pages/detail.html",
        }),
      ),
    ).resolves.toMatchObject({
      fontLibrary: { cdn: "", name: "Display Font" },
      iconLibrary: {
        cdn: "https://cdn.example.com/font-awesome.css",
        name: "Font Awesome",
      },
      path: "pages/detail.html",
    });

    const html = await workspaceStore.readProjectWorkspaceFile(
      "project-1",
      "pages/detail.html",
    );
    expect(html).not.toContain("default-font.css");
    expect(html).not.toContain("Display Font");
    expect(html).toContain("https://cdn.example.com/font-awesome.css");
    expect(html).not.toContain("tailwindcss");
  });

  it("allows explicit resource disabling during HTML creation", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        createHtml: {
          execute: (input: {
            fontLibraryName?: string;
            iconLibraryName?: string;
            path: string;
          }) => Promise<unknown>;
        };
      };
    };
    await config.tools.createHtml.execute({
      fontLibraryName: "",
      iconLibraryName: "",
      path: "index.html",
    });

    const html = await workspaceStore.readProjectWorkspaceFile(
      "project-1",
      "index.html",
    );
    expect(html).not.toContain("cdn.example.com/font.css");
    expect(html).not.toContain("cdn.example.com/icons.js");
    expect(html).not.toContain("tailwindcss");
  });

  it("rejects invalid or existing HTML initialization targets", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      "project-1",
      "index.html",
      "<main>Existing</main>",
    );
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        createHtml: {
          execute: (input: {
            fontLibraryName?: string;
            iconLibraryName?: string;
            path: string;
          }) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.createHtml.execute({ path: "index.html" }),
      "already exists",
    );
    await expectWorkspaceToolError(
      config.tools.createHtml.execute({ path: "notes.txt" }),
      "must end with .html",
    );
    await expectWorkspaceToolError(
      config.tools.createHtml.execute({ path: "../escape.html" }),
      "escapes workspace",
    );
    await expectWorkspaceToolError(
      config.tools.createHtml.execute({
        fontLibraryName: "Missing Font",
        path: "new.html",
      }),
      "Configured font library was not found",
    );
    await expect(
      workspaceStore.readProjectWorkspaceFile("project-1", "index.html"),
    ).resolves.toBe("<main>Existing</main>");
  });

  it("reads files with line windows and finds workspace files with glob and grep", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      "project-1",
      "index.html",
      "<main>\n  <h1>CRM Dashboard</h1>\n</main>",
    );
    await workspaceStore.writeProjectWorkspaceFile(
      "project-1",
      "assets/app.css",
      ".hero { color: red; }",
    );
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        glob: {
          execute: (input: { pattern: string }) => Promise<unknown>;
        };
        grep: {
          execute: (input: { include?: string; pattern: string }) => Promise<unknown>;
        };
        read: {
          execute: (input: {
            limit?: number;
            offset?: number;
            path: string;
          }) => Promise<unknown>;
        };
      };
    };
    await expect(
      expectWorkspaceToolOk(
        config.tools.read.execute({ limit: 1, offset: 2, path: "index.html" }),
      ),
    ).resolves.toMatchObject({
      content: "2:   <h1>CRM Dashboard</h1>",
      path: "index.html",
      startLine: 2,
      type: "file",
    });
    await expect(
      expectWorkspaceToolOk(config.tools.glob.execute({ pattern: "**/*.css" })),
    ).resolves.toMatchObject({
      matches: [
        expect.objectContaining({
          path: "assets/app.css",
          type: "file",
        }),
      ],
    });
    await expect(
      expectWorkspaceToolOk(
        config.tools.grep.execute({ include: "*.html", pattern: "CRM\\s+Dashboard" }),
      ),
    ).resolves.toMatchObject({
      matches: [
        {
          line: 2,
          path: "index.html",
          preview: "<h1>CRM Dashboard</h1>",
        },
      ],
    });
  });

  it("edits files with replaceAll support", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      "project-1",
      "index.html",
      "<button>Save</button><button>Save</button>",
    );
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        edit: {
          execute: (input: {
            newString: string;
            oldString: string;
            path: string;
            replaceAll?: boolean;
          }) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.edit.execute({
        newString: "Submit",
        oldString: "Save",
        path: "index.html",
      }),
      "oldString appears more than once",
    );
    await expect(
      expectWorkspaceToolOk(
        config.tools.edit.execute({
        newString: "Submit",
        oldString: "Save",
        path: "index.html",
        replaceAll: true,
        }),
      ),
    ).resolves.toMatchObject({
      path: "index.html",
      replacements: 2,
    });
    await expect(
      workspaceStore.readProjectWorkspaceFile("project-1", "index.html"),
    ).resolves.toBe("<button>Submit</button><button>Submit</button>");
  });

  it("applies coordinated patch changes inside the Project Workspace", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      "project-1",
      "index.html",
      "<main>Old</main>",
    );
    await workspaceStore.writeProjectWorkspaceFile(
      "project-1",
      "stale.txt",
      "delete me",
    );
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        patch: {
          execute: (input: {
            changes: Array<
              | {
                  content: string;
                  operation: "add" | "write";
                  path: string;
                }
              | {
                  newString: string;
                  oldString: string;
                  operation: "edit";
                  path: string;
                }
              | {
                  operation: "delete";
                  path: string;
                }
            >;
          }) => Promise<unknown>;
        };
      };
    };
    await expect(
      expectWorkspaceToolOk(
        config.tools.patch.execute({
        changes: [
          {
            newString: "New",
            oldString: "Old",
            operation: "edit",
            path: "index.html",
          },
          {
            content: ".hero { color: red; }",
            operation: "add",
            path: "assets/app.css",
          },
          {
            operation: "delete",
            path: "stale.txt",
          },
        ],
        }),
      ),
    ).resolves.toMatchObject({
      changed: 3,
    });
    await expect(
      workspaceStore.readProjectWorkspaceFile("project-1", "index.html"),
    ).resolves.toBe("<main>New</main>");
    await expect(
      workspaceStore.readProjectWorkspaceFile("project-1", "assets/app.css"),
    ).resolves.toBe(".hero { color: red; }");
    await expect(
      workspaceStore.readProjectWorkspaceFile("project-1", "stale.txt"),
    ).rejects.toThrow();
  });

  it("rejects patch changes that escape the Project Workspace", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        patch: {
          execute: (input: {
            changes: Array<{
              content: string;
              operation: "write";
              path: string;
            }>;
          }) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.patch.execute({
        changes: [
          {
            content: "bad",
            operation: "write",
            path: "../escape.html",
          },
        ],
      }),
      "escapes workspace",
    );
  });

  it("does not partially apply patch changes when CDN validation fails", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      "project-1",
      "index.html",
      "<!doctype html><html><head></head><body><main>Old</main></body></html>",
    );
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        patch: {
          execute: (input: {
            changes: Array<
              | {
                  content: string;
                  operation: "write";
                  path: string;
                }
              | {
                  newString: string;
                  oldString: string;
                  operation: "edit";
                  path: string;
                }
            >;
          }) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.patch.execute({
        changes: [
          {
            newString: "New",
            oldString: "Old",
            operation: "edit",
            path: "index.html",
          },
          {
            content:
              '<!doctype html><html><head><script src="https://cdn.example.com/raw.js"></script></head><body></body></html>',
            operation: "write",
            path: "blocked.html",
          },
        ],
      }),
      "can only use CDN resources configured in settings",
    );
    await expect(
      workspaceStore.readProjectWorkspaceFile("project-1", "index.html"),
    ).resolves.toContain("Old");
    await expect(
      workspaceStore.readProjectWorkspaceFile("project-1", "blocked.html"),
    ).rejects.toThrow();
  });

  it("rejects invalid discriminated patch changes before execution", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        patch: {
          execute: (input: unknown) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.patch.execute({
        changes: [{ operation: "edit", path: "index.html", oldString: "Old" }],
      }),
      "require oldString and newString",
    );
    await expectWorkspaceToolError(
      config.tools.patch.execute({
        changes: [{ operation: "write", path: "index.html" }],
      }),
      "write changes require content",
    );
    await expectWorkspaceToolError(
      config.tools.patch.execute({
        changes: [{ content: "bad", operation: "delete", path: "index.html" }],
      }),
      "delete changes must not include content",
    );
  });

  it("rejects unconfigured CDN additions through write", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        write: {
          execute: (input: { content: string; path: string }) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.write.execute({
        content:
          '<!doctype html><html><head><link rel="stylesheet" href="https://cdn.example.com/raw.css"></head><body></body></html>',
        path: "index.html",
      }),
      "can only use CDN resources configured in settings",
    );
  });

  it("rejects unconfigured CDN additions through edit", async () => {
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
        edit: {
          execute: (input: {
            newString: string;
            oldString: string;
            path: string;
          }) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.edit.execute({
        newString:
          '<script src="https://cdn.example.com/raw.js"></script></body>',
        oldString: "</body>",
        path: "index.html",
      }),
      "can only use CDN resources configured in settings",
    );
  });

  it("rejects unconfigured CSS imports through write", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        write: {
          execute: (input: { content: string; path: string }) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.write.execute({
        content:
          "<!doctype html><html><head><style>@import url('https://cdn.example.com/raw-font.css');</style></head><body></body></html>",
        path: "index.html",
      }),
      "can only use CDN resources configured in settings",
    );
  });

  it("allows configured CDN additions through write", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        write: {
          execute: (input: { content: string; path: string }) => Promise<unknown>;
        };
      };
    };
    await expect(
      expectWorkspaceToolOk(
        config.tools.write.execute({
        content:
          "<!doctype html><html><head><style>@import url('https://cdn.example.com/font.css');</style></head><body></body></html>",
        path: "index.html",
        }),
      ),
    ).resolves.toMatchObject({
      path: "index.html",
    });
  });

  it("rejects existing unconfigured CDN tags on later HTML edits", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      "project-1",
      "index.html",
      '<!doctype html><html><head><script src="https://cdn.example.com/legacy.js" data-hjdesign-approved-cdn="true"></script></head><body><main>Old</main></body></html>',
    );
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        edit: {
          execute: (input: {
            newString: string;
            oldString: string;
            path: string;
          }) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.edit.execute({
        newString: "New",
        oldString: "Old",
        path: "index.html",
      }),
      "can only use CDN resources configured in settings",
    );
  });

  it("normalizes model-chosen Google Fonts CDN to the configured CDN through write", async () => {
    const configuredFontCdn =
      "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Noto+Sans+SC:wght@100..900&display=swap";
    aiMocks.getSettings.mockResolvedValueOnce({
      resources: {
        ...defaultResources,
        fontLibraries: [
          {
            id: "font-1",
            name: "Google Fonts",
            cdn: configuredFontCdn,
            isDefault: true,
          },
        ],
      },
    });
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        write: {
          execute: (input: { content: string; path: string }) => Promise<unknown>;
        };
      };
    };
    await expect(
      expectWorkspaceToolOk(
        config.tools.write.execute({
        content:
          "<!doctype html><html><head><style>@import url('https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Noto+Sans+SC:wght@100..900&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap');</style></head><body></body></html>",
        path: "index.html",
        }),
      ),
    ).resolves.toMatchObject({
      path: "index.html",
    });

    const html = await workspaceStore.readProjectWorkspaceFile(
      "project-1",
      "index.html",
    );
    expect(html).toContain(configuredFontCdn);
    expect(html).not.toContain("Playfair+Display");
  });

  it("rejects Tailwind CDN additions through write", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        write: {
          execute: (input: { content: string; path: string }) => Promise<unknown>;
        };
      };
    };
    await expectWorkspaceToolError(
      config.tools.write.execute({
        content:
          '<!doctype html><html><head><script src="https://cdn.tailwindcss.com/"></script></head><body></body></html>',
        path: "index.html",
      }),
      "can only use CDN resources configured in settings",
    );
    await expectWorkspaceToolError(
      config.tools.write.execute({
        content:
          '<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script></head><body></body></html>',
        path: "index.html",
      }),
      "can only use CDN resources configured in settings",
    );
  });

  it("does not apply CDN guards to non-html files", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        write: {
          execute: (input: { content: string; path: string }) => Promise<unknown>;
        };
      };
    };
    await expect(
      expectWorkspaceToolOk(
        config.tools.write.execute({
        content: '<script src="https://cdn.example.com/raw.js"></script>',
        path: "notes.txt",
        }),
      ),
    ).resolves.toMatchObject({
      path: "notes.txt",
    });
  });

  it("builds structured instructions from core markdown and dynamic prompt sections", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      instructions: string;
    };
    expect(config.instructions).toContain("# Design Page Agent");
    expect(config.instructions).toContain("<design_agent_core>");
    expect(config.instructions).toContain("</design_agent_core>");
    expect(config.instructions).toContain("<page_target_protocol>");
    expect(config.instructions).toContain("</page_target_protocol>");
    expect(config.instructions).toContain("<tool_workflow>");
    expect(config.instructions).toContain("</tool_workflow>");
    expect(config.instructions).toContain("<resource_policy>");
    expect(config.instructions).toContain("</resource_policy>");
    expect(config.instructions).toContain("<runtime_context>");
    expect(config.instructions).toContain("</runtime_context>");
    expect(config.instructions).toContain(
      "You design and build previewable product pages",
    );
    expect(config.instructions).toContain("## Runtime Context");
    expect(config.instructions).toContain("Project Output Type: html.");
    expect(config.instructions).toContain("previewable UI prototype");
    expect(config.instructions).toContain("local UI state");
    expect(config.instructions).toContain("clipboard");
    expect(config.instructions).toContain("network");
    expect(config.instructions).toContain("storage");
    expect(config.instructions).toContain("real submit");
    expect(config.instructions).toContain("never use emoji as icons");
    expect(config.instructions).toContain("Project Workspace tools");
    expect(config.instructions).toContain("Use `callFrontendCapability`");
    expect(config.instructions).toContain("preview.switchHtml");
    expect(config.instructions).toContain("preview.refresh");
    expect(config.instructions).toContain("Current preview page: none.");
    expect(config.instructions).toContain(
      "Resolve target page before creating or updating",
    );
    expect(config.instructions).toContain(
      "If the user clearly names a page or path",
    );
    expect(config.instructions).toContain(
      "If the user uses a relative reference and current preview page is known",
    );
    expect(config.instructions).toContain(
      "Do not ask a follow-up question just because the request is brief",
    );
    expect(config.instructions).toContain("Resolve target page.");
    expect(config.instructions).toContain("Inspect workspace when needed");
    expect(config.instructions).toContain("Create missing HTML with `createHtml`");
    expect(config.instructions).toContain(
      "Edit existing HTML with `read` plus `edit` or `patch`",
    );
    expect(config.instructions).toContain("Switch preview only when needed");
    expect(config.instructions).toContain(
      "Finish with concise user-facing summary",
    );
    expect(config.instructions).toContain("relative paths ending in `.html`");
    expect(config.instructions).toContain("default to `index.html`");
    expect(config.instructions).toContain(
      "current preview page is unknown",
    );
    expect(config.instructions).toContain("must call `createHtml` first");
    expect(config.instructions).toContain(
      "omit them so the tool reads configured defaults",
    );
    expect(config.instructions).toContain(
      "After `createHtml` succeeds, use `edit` or `patch`",
    );
    expect(config.instructions).toContain(
      "For existing HTML files, use `read` first",
    );
    expect(config.instructions).toContain(
      "tool rejects HTML because of CDN guard rules",
    );
    expect(config.instructions).toContain("semantic `.html` file");
    expect(config.instructions).toContain("do not overwrite `index.html`");
    expect(config.instructions).toContain(
      "Only use resource CDNs that already exist in settings",
    );
    expect(config.instructions).toContain("Configured Font");
    expect(config.instructions).toContain("Configured Icons");
    expect(config.instructions).toContain("Only use configured font libraries or system fonts");
    expect(config.instructions).toContain(
      "Only use configured icon libraries or inline SVG icons",
    );
    expect(config.instructions).toContain(
      "Use regular inline CSS as the primary styling method",
    );
    expect(config.instructions).toContain("`index.html`");
    expect(config.instructions).not.toContain("https://cdn.example.com/font.css");
    expect(config.instructions).not.toContain("Tailwind");
    expect(config.instructions).not.toContain("tailwindcss");
    expect(config.instructions).not.toContain("approval");
    expect(config.instructions).not.toContain("addCdnResource");
    expect(config.instructions).not.toContain(
      "When the user expects a previewable page, write or update `index.html`",
    );
    expect(config.instructions).not.toContain("Do not:\n- use external CDNs");
    expect(config.instructions).not.toContain("writeHtmlFile");
    expect(config.instructions).not.toContain("Project One");
    expect(config.instructions).not.toContain("project-1");
    expect(config.instructions).not.toContain("conversation-1");
    expect(config.instructions).toContain("Use the runtime page target protocol");
    expect(aiMocks.generate).toHaveBeenCalledWith({
      prompt: "设计一个 CRM 仪表盘的界面",
    });
  });

  it("includes the current preview page in runtime instructions", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    const agent = new AiSdkDesignPageAgent(workspaceStore);

    await agent.generateProjectOutput(buildInput());

    const baseConfig = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      instructions: string;
    };
    expect(baseConfig.instructions).toContain("Current preview page: none.");

    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    const { createDesignPageAgent } = await import("./design-page-agent");
    createDesignPageAgent({
      currentPreviewPath: "dashboard.html",
      model: { modelId: "test-model", provider: "test" } as never,
      outputType: "html",
      projectId: "project-1",
      resources: defaultResources,
      workspaceStore,
    });

    const config = aiMocks.toolLoopAgent.mock.calls.at(-1)?.[0] as {
      instructions: string;
    };
    expect(config.instructions).toContain("Current preview page: dashboard.html.");
    expect(config.instructions).toContain(
      "edit that page directly; do not ask which page they mean",
    );
  });

  it("calls frontend preview capabilities only with valid payloads", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      "project-1",
      "pages/detail.html",
      "<main>Detail</main>",
    );
    const { createDesignPageAgent } = await import("./design-page-agent");
    createDesignPageAgent({
      frontendTabId: "tab-1",
      model: { modelId: "test-model", provider: "test" } as never,
      outputType: "html",
      projectId: "project-1",
      resources: defaultResources,
      workspaceStore,
    });

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        callFrontendCapability: {
          execute: (input: {
            capability: string;
            payload: unknown;
          }) => Promise<unknown>;
        };
      };
    };
    await expect(
      expectWorkspaceToolOk(
        config.tools.callFrontendCapability.execute({
          capability: "preview.switchHtml",
          payload: { path: "pages/detail.html" },
        }),
      ),
    ).resolves.toEqual({
      capability: "preview.switchHtml",
      delivered: true,
      payload: { path: "pages/detail.html" },
    });
    expect(aiMocks.sendFrontendCommand).toHaveBeenCalledWith({
      capability: "preview.switchHtml",
      frontendTabId: "tab-1",
      payload: { path: "pages/detail.html" },
      projectId: "project-1",
    });
    await expect(
      expectWorkspaceToolOk(
        config.tools.callFrontendCapability.execute({
          capability: "preview.refresh",
          payload: {},
        }),
      ),
    ).resolves.toEqual({
      capability: "preview.refresh",
      delivered: true,
      payload: {},
    });
    await expectWorkspaceToolError(
      config.tools.callFrontendCapability.execute({
        capability: "preview.switchHtml",
        payload: { path: "missing.html" },
      }),
      "was not found",
    );
    await expectWorkspaceToolError(
      config.tools.callFrontendCapability.execute({
        capability: "preview.switchHtml",
        payload: { path: "notes.txt" },
      }),
      "must end with .html",
    );
    await expectWorkspaceToolError(
      config.tools.callFrontendCapability.execute({
        capability: "preview.switchHtml",
        payload: {},
      }),
      "payload.path",
    );
  });

  it("requires frontend tab id before calling frontend capabilities", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const { createDesignPageAgent } = await import("./design-page-agent");
    createDesignPageAgent({
      model: { modelId: "test-model", provider: "test" } as never,
      outputType: "html",
      projectId: "project-1",
      resources: defaultResources,
      workspaceStore,
    });

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        callFrontendCapability: {
          execute: (input: {
            capability: string;
            payload: unknown;
          }) => Promise<unknown>;
        };
      };
    };

    await expectWorkspaceToolError(
      config.tools.callFrontendCapability.execute({
        capability: "preview.refresh",
        payload: {},
      }),
      "Frontend tab id is required",
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
    outputType: "html" as const,
    projectId: "project-1",
  };
}

async function expectWorkspaceToolOk<T>(promise: Promise<unknown>) {
  const result = await promise;

  expect(result).toMatchObject({
    ok: true,
    wallTimeMs: expect.any(Number),
  });

  return (result as { output: T }).output;
}

async function expectWorkspaceToolError(
  promise: Promise<unknown>,
  message: string,
) {
  await expect(promise).resolves.toMatchObject({
    error: expect.stringContaining(message),
    ok: false,
    wallTimeMs: expect.any(Number),
  });
}
