import { createApiClient } from "@/api/client";
import type {
  InterfaceLanguage,
  ModelConfigurationForm,
  ResourceSettings,
} from "@/features/settings/types";

const api = createApiClient();

export async function saveSettings(settings: {
  defaultModelId: string | null;
  interfaceLanguage: InterfaceLanguage;
  modelConfigurations: ModelConfigurationForm[];
  resources: ResourceSettings;
}) {
  try {
    await api.saveSettings(settings);
    return true;
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "Invalid settings payload.");
    return false;
  }
}

export function loadSettings() {
  return api.loadSettings();
}
