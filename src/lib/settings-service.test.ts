import { mkdtemp, rm } from "node:fs/promises";
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
});

async function createService() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "hjdesign-settings-"));
  tempRoots.push(tempRoot);

  return new SettingsService({
    settingsPath: path.join(tempRoot, ".hjdesign", "settings.json"),
  });
}
