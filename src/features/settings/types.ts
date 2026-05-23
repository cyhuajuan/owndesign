import type {
  InterfaceLanguage,
  ModelProviderOptions,
  PublicAppSettings,
  ResourceLibrary,
  ResourceSettings,
} from "@/server/settings/settings-service";
import type { ModelProvider } from "@/features/settings/model-utils";

export type {
  InterfaceLanguage,
  ModelProviderOptions,
  ResourceLibrary,
  ResourceSettings,
};

export type SettingsSection = "general" | "resources" | "ai";

export type ModelConfigurationForm = {
  id: string;
  provider: ModelProvider | "";
  model: string;
  baseUrl: string;
  apiKey: string;
  contextSizeK: string;
  providerOptions?: ModelProviderOptions;
  collapsed: boolean;
};

export type PublicSettings = PublicAppSettings;
