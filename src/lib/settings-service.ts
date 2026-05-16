import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const SETTINGS_UPDATED_EVENT = "hjdesign:settings-updated";

export type InterfaceLanguage = "zh-CN" | "en-US";
export type ModelProvider = "deepseek" | "openai-compatible";

export type ModelConfiguration = {
  id: string;
  provider: ModelProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
};

export type PublicModelConfiguration = Omit<ModelConfiguration, "apiKey"> & {
  apiKey: "";
  hasApiKey: boolean;
};

export type AppSettings = {
  defaultModelId: string | null;
  interfaceLanguage: InterfaceLanguage;
  modelConfigurations: ModelConfiguration[];
};

export type PublicAppSettings = Omit<AppSettings, "modelConfigurations"> & {
  modelConfigurations: PublicModelConfiguration[];
};

type SettingsServiceOptions = {
  settingsPath?: string;
};

const DEFAULT_SETTINGS: AppSettings = {
  defaultModelId: null,
  interfaceLanguage: "zh-CN",
  modelConfigurations: [],
};

export class SettingsService {
  private readonly settingsPath: string;

  constructor(options: SettingsServiceOptions = {}) {
    this.settingsPath =
      options.settingsPath ?? path.join(os.homedir(), ".hjdesign", "settings.json");
  }

  async getSettings() {
    const settings = await this.readSettings();
    const normalized = normalizeSettings(settings);

    if (JSON.stringify(settings) !== JSON.stringify(normalized)) {
      await this.writeSettings(normalized);
    }

    return normalized;
  }

  async getPublicSettings() {
    return toPublicSettings(await this.getSettings());
  }

  async updateSettings(input: unknown) {
    const previous = await this.readSettings();
    const next = normalizeSettings(parseSettingsInput(input, previous));

    await this.writeSettings(next);

    return next;
  }

  async updatePublicSettings(input: unknown) {
    return toPublicSettings(await this.updateSettings(input));
  }

  async resolveModelConfiguration(modelConfigurationId?: string | null) {
    const settings = await this.getSettings();
    const selectedId = modelConfigurationId || settings.defaultModelId;
    const configuration =
      settings.modelConfigurations.find((model) => model.id === selectedId) ??
      settings.modelConfigurations[0];

    if (!configuration) {
      throw new Error("请先在设置中添加 AI 模型配置。");
    }

    return configuration;
  }

  private async readSettings() {
    try {
      const content = await readFile(this.settingsPath, "utf8");

      return parseStoredSettings(JSON.parse(content));
    } catch (error) {
      if (isMissingPathError(error)) {
        return DEFAULT_SETTINGS;
      }

      throw error;
    }
  }

  private async writeSettings(settings: AppSettings) {
    await mkdir(path.dirname(this.settingsPath), { recursive: true });
    await writeFile(
      this.settingsPath,
      `${JSON.stringify(settings, null, 2)}\n`,
      "utf8",
    );
  }
}

export function createSettingsService(options?: SettingsServiceOptions) {
  return new SettingsService(options);
}

export function toPublicSettings(settings: AppSettings): PublicAppSettings {
  return {
    defaultModelId: settings.defaultModelId,
    interfaceLanguage: settings.interfaceLanguage,
    modelConfigurations: settings.modelConfigurations.map((configuration) => ({
      id: configuration.id,
      provider: configuration.provider,
      model: configuration.model,
      baseUrl: configuration.baseUrl,
      apiKey: "",
      hasApiKey: Boolean(configuration.apiKey),
    })),
  };
}

function parseStoredSettings(value: unknown): AppSettings {
  if (!isRecord(value)) {
    return DEFAULT_SETTINGS;
  }

  return {
    defaultModelId:
      typeof value.defaultModelId === "string" ? value.defaultModelId : null,
    interfaceLanguage: parseInterfaceLanguage(value.interfaceLanguage),
    modelConfigurations: Array.isArray(value.modelConfigurations)
      ? value.modelConfigurations
          .map((configuration) => parseStoredModelConfiguration(configuration))
          .filter((configuration): configuration is ModelConfiguration =>
            Boolean(configuration),
          )
      : [],
  };
}

function parseSettingsInput(value: unknown, previous: AppSettings): AppSettings {
  if (!isRecord(value)) {
    throw new Error("Invalid settings payload.");
  }

  const modelConfigurations = Array.isArray(value.modelConfigurations)
    ? value.modelConfigurations.map((configuration) =>
        parseInputModelConfiguration(configuration, previous),
      )
    : [];

  return {
    defaultModelId:
      typeof value.defaultModelId === "string" ? value.defaultModelId : null,
    interfaceLanguage: parseInterfaceLanguage(value.interfaceLanguage),
    modelConfigurations,
  };
}

function parseStoredModelConfiguration(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  const provider = parseModelProvider(value.provider);
  const model = asTrimmedString(value.model);

  if (!provider || !model) {
    return undefined;
  }

  return {
    id: asTrimmedString(value.id) || randomUUID(),
    provider,
    model,
    baseUrl: asTrimmedString(value.baseUrl),
    apiKey: asTrimmedString(value.apiKey),
  };
}

function parseInputModelConfiguration(
  value: unknown,
  previous: AppSettings,
): ModelConfiguration {
  if (!isRecord(value)) {
    throw new Error("Invalid model configuration.");
  }

  const id = asTrimmedString(value.id) || randomUUID();
  const provider = parseModelProvider(value.provider);
  const model = asTrimmedString(value.model);
  const baseUrl = asTrimmedString(value.baseUrl);
  const incomingApiKey = asTrimmedString(value.apiKey);
  const previousApiKey =
    previous.modelConfigurations.find((configuration) => configuration.id === id)
      ?.apiKey ?? "";
  const apiKey = incomingApiKey || previousApiKey;

  if (!provider) {
    throw new Error("Provider is required.");
  }

  if (!model) {
    throw new Error("Model is required.");
  }

  if (provider === "openai-compatible" && !baseUrl) {
    throw new Error("Base URL is required.");
  }

  if (!apiKey) {
    throw new Error("API Key is required.");
  }

  return {
    id,
    provider,
    model,
    baseUrl,
    apiKey,
  };
}

function normalizeSettings(settings: AppSettings): AppSettings {
  const modelConfigurations = settings.modelConfigurations.map((configuration) => ({
    ...configuration,
    baseUrl: configuration.baseUrl.trim(),
    model: configuration.model.trim(),
    apiKey: configuration.apiKey.trim(),
  }));
  const defaultModelId = modelConfigurations.some(
    (configuration) => configuration.id === settings.defaultModelId,
  )
    ? settings.defaultModelId
    : modelConfigurations[0]?.id ?? null;

  return {
    defaultModelId,
    interfaceLanguage: settings.interfaceLanguage,
    modelConfigurations,
  };
}

function parseInterfaceLanguage(value: unknown): InterfaceLanguage {
  return value === "en-US" || value === "en" ? "en-US" : "zh-CN";
}

function parseModelProvider(value: unknown): ModelProvider | undefined {
  if (value === "deepseek" || value === "DeepSeek") {
    return "deepseek";
  }

  if (
    value === "openai-compatible" ||
    value === "OpenAI Compatible" ||
    value === "OpenAI"
  ) {
    return "openai-compatible";
  }

  return undefined;
}

function asTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissingPathError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
