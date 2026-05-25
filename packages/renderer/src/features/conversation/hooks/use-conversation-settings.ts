"use client";

import { useCallback, useEffect, useState } from "react";

import { SETTINGS_UPDATED_EVENT } from "@/features/settings/components/settings-control";
import type {
  DeepSeekThinkingMode,
  PublicSettings,
} from "@/features/conversation/types";
import { updateDefaultModel } from "@/features/conversation/utils/model-selection";
import { useApiClient } from "@/api/context";
import type { ApiClient } from "@/api/client";

export function useConversationSettings() {
  const api = useApiClient();
  const [settings, setSettings] = useState<PublicSettings>();
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const selectedModel = settings?.modelConfigurations.find(
    (configuration) => configuration.id === selectedModelId,
  );
  const handleModelSelect = useCallback(
    async (modelId: string, thinkingMode?: DeepSeekThinkingMode) => {
      if (!settings) {
        return;
      }

      const nextSettings = updateDefaultModel(settings, modelId, thinkingMode);

      setSelectedModelId(modelId);
      setSettings(nextSettings);
      await saveSettings(api, nextSettings);
    },
    [api, settings],
  );

  useEffect(() => {
    let isMounted = true;
    const loadSettings = async () => {
      const nextSettings = await api.loadSettings();

      if (!isMounted) {
        return;
      }

      setSettings(nextSettings);
      setSelectedModelId(
        nextSettings.defaultModelId ??
          nextSettings.modelConfigurations[0]?.id ??
          null,
      );
    };

    void loadSettings();
    window.addEventListener(SETTINGS_UPDATED_EVENT, loadSettings);

    return () => {
      isMounted = false;
      window.removeEventListener(SETTINGS_UPDATED_EVENT, loadSettings);
    };
  }, [api]);

  return {
    handleModelSelect,
    selectedModel,
    selectedModelId,
    settings,
  };
}

async function saveSettings(
  api: ApiClient,
  settings: PublicSettings,
) {
  await api.saveSettings({
    defaultModelId: settings.defaultModelId,
    interfaceLanguage: settings.interfaceLanguage,
    resources: settings.resources,
    modelConfigurations: settings.modelConfigurations.map((configuration) => ({
      id: configuration.id,
      provider: configuration.provider,
      model: configuration.model,
      baseUrl: configuration.baseUrl,
      contextSizeK: String(configuration.contextSizeK),
      providerOptions: configuration.providerOptions,
      apiKey: "",
      collapsed: true,
    })),
  });
}
