import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AiSdkDesignPageAgent,
  buildProviderOptions,
} from "./design-page-agent";
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
  tailwind: {
    enabled: false,
    cdnUrl: "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
  },
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
    id: "model-1",
    model: "deepseek-v4-flash",
    provider: "deepseek",
  });
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

  it("configures the agent to ask follow-up questions when design details are missing", async () => {
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
          "ask concise follow-up questions instead of modifying files",
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
  });

  it("does not require approval for configured CDN resources", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        addCdnResource: {
          needsApproval: (input: { url: string }) => boolean;
        };
      };
    };
    expect(
      config.tools.addCdnResource.needsApproval({
        url: "https://cdn.example.com/font.css",
      }),
    ).toBe(false);
    expect(
      config.tools.addCdnResource.needsApproval({
        url: "https://cdn.example.com/other.css",
      }),
    ).toBe(true);
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
      config.tools.createHtml.execute({
        path: "index.html",
        title: "CRM Dashboard",
      }),
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
      tailwindEnabled: false,
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

  it("creates HTML with explicit resource selections and Tailwind", async () => {
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
        tailwind: {
          enabled: false,
          cdnUrl: "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
        },
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
            tailwindEnabled?: boolean;
          }) => Promise<unknown>;
        };
      };
    };
    await expect(
      config.tools.createHtml.execute({
        fontLibraryName: "Display Font",
        iconLibraryName: "Font Awesome",
        path: "pages/detail.html",
        tailwindEnabled: true,
      }),
    ).resolves.toMatchObject({
      fontLibrary: { cdn: "", name: "Display Font" },
      iconLibrary: {
        cdn: "https://cdn.example.com/font-awesome.css",
        name: "Font Awesome",
      },
      path: "pages/detail.html",
      tailwindEnabled: true,
    });

    const html = await workspaceStore.readProjectWorkspaceFile(
      "project-1",
      "pages/detail.html",
    );
    expect(html).not.toContain("default-font.css");
    expect(html).not.toContain("Display Font");
    expect(html).toContain("https://cdn.example.com/font-awesome.css");
    expect(html).toContain("https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4");
  });

  it("allows explicit resource disabling during HTML creation", async () => {
    aiMocks.getSettings.mockResolvedValueOnce({
      resources: {
        ...defaultResources,
        tailwind: {
          enabled: true,
          cdnUrl: "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
        },
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
            tailwindEnabled?: boolean;
          }) => Promise<unknown>;
        };
      };
    };
    await config.tools.createHtml.execute({
      fontLibraryName: "",
      iconLibraryName: "",
      path: "index.html",
      tailwindEnabled: false,
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
    await expect(
      config.tools.createHtml.execute({ path: "index.html" }),
    ).rejects.toThrow("already exists");
    await expect(
      config.tools.createHtml.execute({ path: "notes.txt" }),
    ).rejects.toThrow("must end with .html");
    await expect(
      config.tools.createHtml.execute({ path: "../escape.html" }),
    ).rejects.toThrow("escapes workspace");
    await expect(
      config.tools.createHtml.execute({
        fontLibraryName: "Missing Font",
        path: "new.html",
      }),
    ).rejects.toThrow("Configured font library was not found");
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
      config.tools.read.execute({ limit: 1, offset: 2, path: "index.html" }),
    ).resolves.toMatchObject({
      content: "2:   <h1>CRM Dashboard</h1>",
      path: "index.html",
      startLine: 2,
      type: "file",
    });
    await expect(
      config.tools.glob.execute({ pattern: "**/*.css" }),
    ).resolves.toMatchObject({
      matches: [
        expect.objectContaining({
          path: "assets/app.css",
          type: "file",
        }),
      ],
    });
    await expect(
      config.tools.grep.execute({ include: "*.html", pattern: "CRM\\s+Dashboard" }),
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
    await expect(
      config.tools.edit.execute({
        newString: "Submit",
        oldString: "Save",
        path: "index.html",
      }),
    ).rejects.toThrow("oldString appears more than once");
    await expect(
      config.tools.edit.execute({
        newString: "Submit",
        oldString: "Save",
        path: "index.html",
        replaceAll: true,
      }),
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
    await expect(
      config.tools.patch.execute({
        changes: [
          {
            content: "bad",
            operation: "write",
            path: "../escape.html",
          },
        ],
      }),
    ).rejects.toThrow("escapes workspace");
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
            resourceType: "script" | "style-import" | "stylesheet";
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
            resourceType: "script" | "style-import" | "stylesheet";
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

  it("adds approved CDN resources to a named HTML page", async () => {
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      "project-1",
      "settings.html",
      "<!doctype html><html><head></head><body></body></html>",
    );
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      tools: {
        addCdnResource: {
          execute: (input: {
            path?: string;
            resourceType: "script" | "style-import" | "stylesheet";
            url: string;
          }) => Promise<unknown>;
        };
      };
    };
    await expect(
      config.tools.addCdnResource.execute({
        path: "settings.html",
        resourceType: "style-import",
        url: "https://cdn.example.com/font.css",
      }),
    ).resolves.toMatchObject({
      added: true,
      path: "settings.html",
    });

    await expect(
      workspaceStore.readProjectWorkspaceFile("project-1", "settings.html"),
    ).resolves.toContain(
      "<style data-hjdesign-approved-cdn=\"true\">\n@import url('https://cdn.example.com/font.css');\n</style>",
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
            resourceType: "script" | "style-import" | "stylesheet";
            url: string;
          }) => Promise<unknown>;
        };
        write: {
          execute: (input: { content: string; path: string }) => Promise<unknown>;
        };
      };
    };
    await config.tools.addCdnResource.execute({
      resourceType: "script",
      url: "https://cdn.example.com/approved.js",
    });
    await config.tools.write.execute({
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

  it("rejects direct unapproved CDN additions through write", async () => {
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
      config.tools.write.execute({
        content:
          '<!doctype html><html><head><link rel="stylesheet" href="https://cdn.example.com/raw.css"></head><body></body></html>',
        path: "index.html",
      }),
    ).rejects.toThrow("must be approved with addCdnResource");
  });

  it("rejects direct unapproved CDN additions through edit", async () => {
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
    await expect(
      config.tools.edit.execute({
        newString:
          '<script src="https://cdn.example.com/raw.js"></script></body>',
        oldString: "</body>",
        path: "index.html",
      }),
    ).rejects.toThrow("must be approved with addCdnResource");
  });

  it("rejects direct unapproved CSS imports through write", async () => {
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
      config.tools.write.execute({
        content:
          "<!doctype html><html><head><style>@import url('https://cdn.example.com/raw-font.css');</style></head><body></body></html>",
        path: "index.html",
      }),
    ).rejects.toThrow("must be approved with addCdnResource");
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
      config.tools.write.execute({
        content:
          "<!doctype html><html><head><style>@import url('https://cdn.example.com/font.css');</style></head><body></body></html>",
        path: "index.html",
      }),
    ).resolves.toMatchObject({
      path: "index.html",
    });
  });

  it("normalizes model-chosen font and Tailwind CDNs to configured CDNs through write", async () => {
    const configuredFontCdn =
      "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Noto+Sans+SC:wght@100..900&display=swap";
    const configuredTailwindCdn =
      "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4";
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
        tailwind: {
          enabled: true,
          cdnUrl: configuredTailwindCdn,
        },
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
      config.tools.write.execute({
        content:
          "<!doctype html><html><head><script src=\"https://cdn.tailwindcss.com/\"></script><style>@import url('https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Noto+Sans+SC:wght@100..900&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap');</style></head><body></body></html>",
        path: "index.html",
      }),
    ).resolves.toMatchObject({
      path: "index.html",
    });

    const html = await workspaceStore.readProjectWorkspaceFile(
      "project-1",
      "index.html",
    );
    expect(html).toContain(configuredTailwindCdn);
    expect(html).toContain(configuredFontCdn);
    expect(html).not.toContain("https://cdn.tailwindcss.com/");
    expect(html).not.toContain("Playfair+Display");
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
      config.tools.write.execute({
        content: '<script src="https://cdn.example.com/raw.js"></script>',
        path: "notes.txt",
      }),
    ).resolves.toMatchObject({
      path: "notes.txt",
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
            resourceType: "script" | "style-import" | "stylesheet";
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
            resourceType: "script" | "style-import" | "stylesheet";
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
    expect(config.instructions).toContain("previewable UI prototype");
    expect(config.instructions).toContain("local UI state");
    expect(config.instructions).toContain("clipboard");
    expect(config.instructions).toContain("network");
    expect(config.instructions).toContain("storage");
    expect(config.instructions).toContain("real submit");
    expect(config.instructions).toContain("never use emoji as icons");
    expect(config.instructions).toContain("Project Workspace tools");
    expect(config.instructions).toContain("first decide whether the user wants");
    expect(config.instructions).toContain("relative paths ending in `.html`");
    expect(config.instructions).toContain("default to `index.html`");
    expect(config.instructions).toContain("must call `createHtml` first");
    expect(config.instructions).toContain(
      "omit them so the tool reads configured defaults",
    );
    expect(config.instructions).toContain(
      "After `createHtml` succeeds, use `edit` or `patch`",
    );
    expect(config.instructions).toContain("semantic `.html` file");
    expect(config.instructions).toContain("do not overwrite `index.html`");
    expect(config.instructions).toContain("Only add external CDNs through");
    expect(config.instructions).toContain("Configured Font");
    expect(config.instructions).toContain("Configured Icons");
    expect(config.instructions).toContain("https://cdn.example.com/font.css");
    expect(config.instructions).toContain(
      "Tailwind CSS: disabled; CDN=https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
    );
    expect(config.instructions).toContain(
      "Use regular inline CSS as the primary styling method",
    );
    expect(config.instructions).toContain("preserve any existing");
    expect(config.instructions).toContain("`index.html`");
    expect(config.instructions).not.toContain(
      "When the user expects a previewable page, write or update `index.html`",
    );
    expect(config.instructions).not.toContain("Do not:\n- use external CDNs");
    expect(config.instructions).not.toContain("writeHtmlFile");
    expect(config.instructions).not.toContain("Project One");
    expect(config.instructions).not.toContain("project-1");
    expect(config.instructions).not.toContain("conversation-1");
    expect(aiMocks.generate).toHaveBeenCalledWith({
      prompt: "设计一个 CRM 仪表盘的界面",
    });
  });

  it("instructs the agent to use Tailwind when enabled", async () => {
    aiMocks.getSettings.mockResolvedValueOnce({
      resources: {
        ...defaultResources,
        tailwind: {
          enabled: true,
          cdnUrl: "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
        },
      },
    });
    const workspaceStore = await createWorkspaceStore();
    await createProject(workspaceStore);
    const agent = new AiSdkDesignPageAgent(workspaceStore);
    aiMocks.generate.mockResolvedValueOnce({ text: "" });

    await agent.generateProjectOutput(buildInput());

    const config = aiMocks.toolLoopAgent.mock.calls[0]?.[0] as {
      instructions: string;
    };
    expect(config.instructions).toContain(
      "Tailwind CSS: enabled; CDN=https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
    );
    expect(config.instructions).toContain(
      "You must use Tailwind CSS utility classes for styling",
    );
    expect(config.instructions).toContain(
      "Do not use regular CSS unless Tailwind cannot express the required behavior",
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
