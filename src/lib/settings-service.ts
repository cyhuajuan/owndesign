import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const SETTINGS_UPDATED_EVENT = "hjdesign:settings-updated";

export type InterfaceLanguage = "zh-CN" | "en-US";
export type ModelProvider = "deepseek" | "openai-compatible";
export type DeepSeekThinkingMode = "disabled" | "high" | "max";

export type ModelProviderOptions = {
  deepseek?: {
    thinkingMode: DeepSeekThinkingMode;
  };
};

export type ModelConfiguration = {
  id: string;
  provider: ModelProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
  providerOptions?: ModelProviderOptions;
};

export type PublicModelConfiguration = Omit<ModelConfiguration, "apiKey"> & {
  apiKey: "";
  hasApiKey: boolean;
};

export type ResourceLibrary = {
  id: string;
  name: string;
  cdn: string;
  isDefault: boolean;
};

export type ResourceSettings = {
  fontLibraries: ResourceLibrary[];
  iconLibraries: ResourceLibrary[];
  tailwind: {
    enabled: boolean;
    cdnUrl: string;
  };
};

export type AppSettings = {
  defaultModelId: string | null;
  interfaceLanguage: InterfaceLanguage;
  modelConfigurations: ModelConfiguration[];
  resources: ResourceSettings;
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
  resources: {
    fontLibraries: [
      {
        id: "font-1",
        name: "Google Fonts",
        cdn: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Noto+Sans+SC:wght@100..900&display=swap",
        isDefault: true,
      },
    ],
    iconLibraries: [
      {
        id: "icon-1",
        name: "Lucide Icons",
        cdn: "https://unpkg.com/lucide@latest/dist/umd/lucide.js",
        isDefault: true,
      },
    ],
    tailwind: {
      enabled: false,
      cdnUrl: "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
    },
  },
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
      providerOptions: configuration.providerOptions,
      apiKey: "",
      hasApiKey: Boolean(configuration.apiKey),
    })),
    resources: settings.resources,
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
    resources: parseStoredResourceSettings(value.resources),
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
    resources: parseInputResourceSettings(value.resources, previous.resources),
  };
}

function parseStoredModelConfiguration(
  value: unknown,
): ModelConfiguration | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const provider = parseModelProvider(value.provider);
  const model = asTrimmedString(value.model);

  if (!provider || !model) {
    return undefined;
  }

  const providerOptions = parseProviderOptions(value.providerOptions, provider);

  return {
    id: asTrimmedString(value.id) || randomUUID(),
    provider,
    model,
    baseUrl: asTrimmedString(value.baseUrl),
    apiKey: asTrimmedString(value.apiKey),
    ...(providerOptions ? { providerOptions } : {}),
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

  const providerOptions = parseProviderOptions(value.providerOptions, provider);

  return {
    id,
    provider,
    model,
    baseUrl,
    apiKey,
    ...(providerOptions ? { providerOptions } : {}),
  };
}

function normalizeSettings(settings: AppSettings): AppSettings {
  const modelConfigurations = settings.modelConfigurations.map((configuration) => {
    const providerOptions = normalizeProviderOptions(
      configuration.providerOptions,
      configuration.provider,
    );

    return {
      id: configuration.id,
      provider: configuration.provider,
      baseUrl: configuration.baseUrl.trim(),
      model: configuration.model.trim(),
      apiKey: configuration.apiKey.trim(),
      ...(providerOptions ? { providerOptions } : {}),
    };
  });
  const defaultModelId = modelConfigurations.some(
    (configuration) => configuration.id === settings.defaultModelId,
  )
    ? settings.defaultModelId
    : modelConfigurations[0]?.id ?? null;

  return {
    defaultModelId,
    interfaceLanguage: settings.interfaceLanguage,
    modelConfigurations,
    resources: normalizeResourceSettings(settings.resources),
  };
}

function parseStoredResourceSettings(value: unknown): ResourceSettings {
  if (!isRecord(value)) {
    return DEFAULT_SETTINGS.resources;
  }

  return {
    fontLibraries: Array.isArray(value.fontLibraries)
      ? value.fontLibraries
          .map(parseResourceLibrary)
          .filter((library): library is ResourceLibrary => Boolean(library))
      : DEFAULT_SETTINGS.resources.fontLibraries,
    iconLibraries: Array.isArray(value.iconLibraries)
      ? value.iconLibraries
          .map(parseResourceLibrary)
          .filter((library): library is ResourceLibrary => Boolean(library))
      : DEFAULT_SETTINGS.resources.iconLibraries,
    tailwind: parseTailwindSettings(value.tailwind),
  };
}

function parseInputResourceSettings(
  value: unknown,
  previous: ResourceSettings,
): ResourceSettings {
  if (!isRecord(value)) {
    return previous;
  }

  return {
    fontLibraries: Array.isArray(value.fontLibraries)
      ? value.fontLibraries.map(parseInputResourceLibrary)
      : previous.fontLibraries,
    iconLibraries: Array.isArray(value.iconLibraries)
      ? value.iconLibraries.map(parseInputResourceLibrary)
      : previous.iconLibraries,
    tailwind: parseTailwindSettings(value.tailwind, previous.tailwind),
  };
}

function parseResourceLibrary(value: unknown): ResourceLibrary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const name = asTrimmedString(value.name);

  if (!name) {
    return undefined;
  }

  return {
    id: asTrimmedString(value.id) || randomUUID(),
    name,
    cdn: asTrimmedString(value.cdn),
    isDefault: value.isDefault === true,
  };
}

function parseInputResourceLibrary(value: unknown): ResourceLibrary {
  const library = parseResourceLibrary(value);

  if (!library) {
    throw new Error("Resource name is required.");
  }

  return library;
}

function parseTailwindSettings(
  value: unknown,
  fallback = DEFAULT_SETTINGS.resources.tailwind,
): ResourceSettings["tailwind"] {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    enabled: value.enabled === true,
    cdnUrl:
      asTrimmedString(value.cdnUrl) ||
      "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
  };
}

function normalizeResourceSettings(settings: ResourceSettings): ResourceSettings {
  return {
    fontLibraries: normalizeResourceLibraries(settings.fontLibraries),
    iconLibraries: normalizeResourceLibraries(settings.iconLibraries),
    tailwind: {
      enabled: settings.tailwind.enabled,
      cdnUrl:
        settings.tailwind.cdnUrl.trim() ||
        "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
    },
  };
}

function normalizeResourceLibraries(libraries: ResourceLibrary[]) {
  const normalized = libraries
    .map((library) => ({
      id: library.id || randomUUID(),
      name: library.name.trim(),
      cdn: library.cdn.trim(),
      isDefault: library.isDefault,
    }))
    .filter((library) => library.name);

  const firstDefaultIndex = normalized.findIndex((library) => library.isDefault);

  return normalized.map((library, index) => ({
    ...library,
    isDefault:
      firstDefaultIndex >= 0 ? index === firstDefaultIndex : index === 0,
  }));
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

function parseProviderOptions(
  value: unknown,
  provider: ModelProvider,
): ModelProviderOptions | undefined {
  if (provider !== "deepseek") {
    return undefined;
  }

  if (!isRecord(value) || !isRecord(value.deepseek)) {
    return { deepseek: { thinkingMode: "high" } };
  }

  const thinkingMode = parseDeepSeekThinkingMode(value.deepseek.thinkingMode);

  if (!thinkingMode) {
    throw new Error("Invalid DeepSeek thinking mode.");
  }

  return { deepseek: { thinkingMode } };
}

function normalizeProviderOptions(
  value: ModelProviderOptions | undefined,
  provider: ModelProvider,
): ModelProviderOptions | undefined {
  if (provider !== "deepseek") {
    return undefined;
  }

  return {
    deepseek: {
      thinkingMode: value?.deepseek?.thinkingMode ?? "high",
    },
  };
}

export function parseDeepSeekThinkingMode(
  value: unknown,
): DeepSeekThinkingMode | undefined {
  return value === "disabled" || value === "high" || value === "max"
    ? value
    : undefined;
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
