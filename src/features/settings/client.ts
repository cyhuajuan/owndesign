import type {
  InterfaceLanguage,
  ModelConfigurationForm,
  PublicSettings,
  ResourceSettings,
} from "@/features/settings/types";

export async function saveSettings(settings: {
  defaultModelId: string | null;
  interfaceLanguage: InterfaceLanguage;
  modelConfigurations: ModelConfigurationForm[];
  resources: ResourceSettings;
}) {
  const defaultModelId =
    settings.defaultModelId &&
    settings.modelConfigurations.some(
      (configuration) => configuration.id === settings.defaultModelId,
    )
      ? settings.defaultModelId
      : settings.modelConfigurations[0]?.id ?? null;
  const response = await fetch("/api/settings", {
    body: JSON.stringify({
      defaultModelId,
      interfaceLanguage: settings.interfaceLanguage,
      modelConfigurations: settings.modelConfigurations.map((configuration) => ({
        apiKey: configuration.apiKey,
        baseUrl: configuration.baseUrl,
        id: configuration.id,
        model: configuration.model,
        contextSizeK: configuration.contextSizeK,
        providerOptions: configuration.providerOptions,
        provider: configuration.provider,
      })),
      resources: settings.resources,
    }),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });

  if (!response.ok) {
    window.alert(await response.text());
    return false;
  }

  return true;
}

export async function loadSettings() {
  const response = await fetch("/api/settings");

  return response.json() as Promise<PublicSettings>;
}
