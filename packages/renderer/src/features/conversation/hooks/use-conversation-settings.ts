"use client";

import { useCallback, useEffect, useState } from "react";

import { SETTINGS_UPDATED_EVENT } from "@/features/settings/components/settings-control";
import type {
  DeepSeekThinkingMode,
  PublicSettings,
} from "@/features/conversation/types";
import { updateDefaultModel } from "@/features/conversation/utils/model-selection";

export function useConversationSettings() {
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
      await saveSettings(nextSettings);
    },
    [settings],
  );

  useEffect(() => {
    let isMounted = true;
    const loadSettings = async () => {
      const response = await fetch("/api/settings");
      const nextSettings = (await response.json()) as PublicSettings;

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
  }, []);

  return {
    handleModelSelect,
    selectedModel,
    selectedModelId,
    settings,
  };
}

async function saveSettings(settings: PublicSettings) {
  await fetch("/api/settings", {
    body: JSON.stringify({
      ...settings,
      modelConfigurations: settings.modelConfigurations.map((configuration) => ({
        id: configuration.id,
        provider: configuration.provider,
        model: configuration.model,
        baseUrl: configuration.baseUrl,
        contextSizeK: configuration.contextSizeK,
        providerOptions: configuration.providerOptions,
        apiKey: "",
      })),
    }),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
}
