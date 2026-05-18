import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SettingsService } from "./settings-service";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (tempRoot) => {
      await rm(tempRoot, { force: true, recursive: true });
    }),
  );
});

describe("SettingsService", () => {
  it("returns default settings when settings.json is missing", async () => {
    const service = await createService();

    await expect(service.getSettings()).resolves.toEqual({
      defaultModelId: null,
      interfaceLanguage: "zh-CN",
      modelConfigurations: [],
      resources: expect.objectContaining({
        fontLibraries: [
          expect.objectContaining({
            cdn: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Noto+Sans+SC:wght@100..900&display=swap",
            isDefault: true,
            name: "Google Fonts",
          }),
        ],
        iconLibraries: [
          expect.objectContaining({ isDefault: true, name: "Lucide Icons" }),
        ],
      }),
    });
  });

  it("backfills resources for stored settings that do not have them", async () => {
    const { service, settingsPath } = await createServiceWithPath();
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(
      settingsPath,
      JSON.stringify({
        defaultModelId: null,
        interfaceLanguage: "zh-CN",
        modelConfigurations: [],
      }),
      "utf8",
    );

    await expect(service.getSettings()).resolves.toMatchObject({
      resources: {
        fontLibraries: [
          expect.objectContaining({
            cdn: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Noto+Sans+SC:wght@100..900&display=swap",
            isDefault: true,
            name: "Google Fonts",
          }),
        ],
        iconLibraries: [
          expect.objectContaining({ isDefault: true, name: "Lucide Icons" }),
        ],
      },
    });
  });

  it("saves multiple model configurations and auto-selects the first model", async () => {
    const service = await createService();
    const settings = await service.updateSettings({
      defaultModelId: null,
      interfaceLanguage: "en-US",
      modelConfigurations: [
        {
          apiKey: "deepseek-key",
          baseUrl: "",
          id: "deepseek-1",
          model: "deepseek-chat",
          provider: "deepseek",
        },
        {
          apiKey: "openai-compatible-key",
          baseUrl: "https://api.example.com/v1",
          id: "compatible-1",
          model: "gpt-4o",
          provider: "openai-compatible",
        },
      ],
    });

    expect(settings.defaultModelId).toBe("deepseek-1");
    expect(settings.modelConfigurations[0]).toMatchObject({
      providerOptions: { deepseek: { thinkingMode: "high" } },
    });
    await expect(service.getSettings()).resolves.toMatchObject({
      defaultModelId: "deepseek-1",
      interfaceLanguage: "en-US",
      modelConfigurations: [
        expect.objectContaining({ apiKey: "deepseek-key" }),
        expect.objectContaining({ apiKey: "openai-compatible-key" }),
      ],
    });
  });

  it("does not expose api keys in public settings", async () => {
    const service = await createService();
    await service.updateSettings({
      defaultModelId: "deepseek-1",
      interfaceLanguage: "zh-CN",
      modelConfigurations: [
        {
          apiKey: "secret-key",
          baseUrl: "",
          id: "deepseek-1",
          model: "deepseek-chat",
          provider: "deepseek",
        },
      ],
    });

    await expect(service.getPublicSettings()).resolves.toEqual(
      expect.objectContaining({
        modelConfigurations: [
          expect.objectContaining({
            apiKey: "",
            hasApiKey: true,
          }),
        ],
      }),
    );
  });

  it("keeps existing api keys when update payload leaves apiKey empty", async () => {
    const service = await createService();
    await service.updateSettings({
      defaultModelId: "deepseek-1",
      interfaceLanguage: "zh-CN",
      modelConfigurations: [
        {
          apiKey: "secret-key",
          baseUrl: "",
          id: "deepseek-1",
          model: "deepseek-chat",
          provider: "deepseek",
        },
      ],
    });

    await service.updateSettings({
      defaultModelId: "deepseek-1",
      interfaceLanguage: "zh-CN",
      modelConfigurations: [
        {
          apiKey: "",
          baseUrl: "",
          id: "deepseek-1",
          model: "deepseek-reasoner",
          provider: "deepseek",
        },
      ],
    });

    await expect(service.getSettings()).resolves.toMatchObject({
      modelConfigurations: [
        {
          apiKey: "secret-key",
          model: "deepseek-reasoner",
        },
      ],
    });
  });

  it("requires baseUrl for OpenAI Compatible models", async () => {
    const service = await createService();

    await expect(
      service.updateSettings({
        defaultModelId: null,
        interfaceLanguage: "zh-CN",
        modelConfigurations: [
          {
            apiKey: "key",
            baseUrl: "",
            id: "compatible-1",
            model: "gpt-4o",
            provider: "openai-compatible",
          },
        ],
      }),
    ).rejects.toThrow("Base URL is required.");
  });

  it("requires apiKey for new model configurations", async () => {
    const service = await createService();

    await expect(
      service.updateSettings({
        defaultModelId: null,
        interfaceLanguage: "zh-CN",
        modelConfigurations: [
          {
            apiKey: "",
            baseUrl: "",
            id: "deepseek-1",
            model: "deepseek-chat",
            provider: "deepseek",
          },
        ],
      }),
    ).rejects.toThrow("API Key is required.");
  });

  it("saves DeepSeek thinking mode provider options", async () => {
    const service = await createService();

    await service.updateSettings({
      defaultModelId: "deepseek-1",
      interfaceLanguage: "zh-CN",
      modelConfigurations: [
        {
          apiKey: "key",
          baseUrl: "",
          id: "deepseek-1",
          model: "deepseek-chat",
          provider: "deepseek",
          providerOptions: {
            deepseek: { thinkingMode: "max" },
          },
        },
      ],
    });

    await expect(service.getPublicSettings()).resolves.toMatchObject({
      modelConfigurations: [
        {
          providerOptions: {
            deepseek: { thinkingMode: "max" },
          },
        },
      ],
    });
  });

  it("drops DeepSeek provider options for OpenAI Compatible models", async () => {
    const service = await createService();

    const settings = await service.updateSettings({
      defaultModelId: "compatible-1",
      interfaceLanguage: "zh-CN",
      modelConfigurations: [
        {
          apiKey: "key",
          baseUrl: "https://api.example.com/v1",
          id: "compatible-1",
          model: "gpt-4o",
          provider: "openai-compatible",
          providerOptions: {
            deepseek: { thinkingMode: "max" },
          },
        },
      ],
    });

    expect(settings.modelConfigurations[0]?.providerOptions).toBeUndefined();
  });

  it("rejects invalid DeepSeek thinking mode provider options", async () => {
    const service = await createService();

    await expect(
      service.updateSettings({
        defaultModelId: null,
        interfaceLanguage: "zh-CN",
        modelConfigurations: [
          {
            apiKey: "key",
            baseUrl: "",
            id: "deepseek-1",
            model: "deepseek-chat",
            provider: "deepseek",
            providerOptions: {
              deepseek: { thinkingMode: "medium" },
            },
          },
        ],
      }),
    ).rejects.toThrow("Invalid DeepSeek thinking mode.");
  });

  it("saves resource settings and exposes them publicly", async () => {
    const service = await createService();

    await service.updateSettings({
      defaultModelId: null,
      interfaceLanguage: "zh-CN",
      modelConfigurations: [],
      resources: {
        fontLibraries: [
          {
            cdn: "",
            id: "font-custom",
            isDefault: true,
            name: "Custom Font",
          },
        ],
        iconLibraries: [
          {
            cdn: "https://cdn.example.com/icons.js",
            id: "icon-custom",
            isDefault: true,
            name: "Custom Icons",
          },
        ],
      },
    });

    await expect(service.getSettings()).resolves.toMatchObject({
      resources: {
        fontLibraries: [
          {
            cdn: "",
            id: "font-custom",
            isDefault: true,
            name: "Custom Font",
          },
        ],
        iconLibraries: [
          {
            cdn: "https://cdn.example.com/icons.js",
            id: "icon-custom",
            isDefault: true,
            name: "Custom Icons",
          },
        ],
      },
    });
    await expect(service.getPublicSettings()).resolves.toMatchObject({
      resources: {
        fontLibraries: [expect.objectContaining({ name: "Custom Font" })],
        iconLibraries: [expect.objectContaining({ name: "Custom Icons" })],
      },
    });
  });

  it("ignores legacy Tailwind resource settings", async () => {
    const service = await createService();

    const settings = await service.updateSettings({
      defaultModelId: null,
      interfaceLanguage: "zh-CN",
      modelConfigurations: [],
      resources: {
        fontLibraries: [],
        iconLibraries: [],
        tailwind: {
          cdnUrl: "https://cdn.example.com/tailwind.js",
          enabled: true,
        },
      },
    });

    expect(settings.resources).not.toHaveProperty("tailwind");
    await expect(service.getPublicSettings()).resolves.toMatchObject({
      resources: expect.not.objectContaining({
        tailwind: expect.anything(),
      }),
    });
  });

  it("keeps only the first default resource and falls back to the first item", async () => {
    const service = await createService();
    const settings = await service.updateSettings({
      defaultModelId: null,
      interfaceLanguage: "zh-CN",
      modelConfigurations: [],
      resources: {
        fontLibraries: [
          {
            cdn: "https://cdn.example.com/a.css",
            id: "font-a",
            isDefault: true,
            name: "Font A",
          },
          {
            cdn: "https://cdn.example.com/b.css",
            id: "font-b",
            isDefault: true,
            name: "Font B",
          },
        ],
        iconLibraries: [
          {
            cdn: "https://cdn.example.com/icons-a.js",
            id: "icon-a",
            isDefault: false,
            name: "Icon A",
          },
          {
            cdn: "https://cdn.example.com/icons-b.js",
            id: "icon-b",
            isDefault: false,
            name: "Icon B",
          },
        ],
      },
    });

    expect(settings.resources.fontLibraries.map((library) => library.isDefault))
      .toEqual([true, false]);
    expect(settings.resources.iconLibraries.map((library) => library.isDefault))
      .toEqual([true, false]);
    expect(settings.resources).not.toHaveProperty("tailwind");
  });

  it("rejects input resource libraries without names", async () => {
    const service = await createService();

    await expect(
      service.updateSettings({
        defaultModelId: null,
        interfaceLanguage: "zh-CN",
        modelConfigurations: [],
        resources: {
          fontLibraries: [{ cdn: "https://cdn.example.com/font.css", name: " " }],
          iconLibraries: [],
        },
      }),
    ).rejects.toThrow("Resource name is required.");
  });
});

async function createService() {
  const { service } = await createServiceWithPath();

  return service;
}

async function createServiceWithPath() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "hjdesign-settings-"));
  tempRoots.push(tempRoot);
  const settingsPath = path.join(tempRoot, ".hjdesign", "settings.json");

  return {
    service: new SettingsService({ settingsPath }),
    settingsPath,
  };
}
