import type { UIMessage } from "ai";

import type { InitialSetupInput } from "@/features/onboarding/components/initial-setup-guide";
import type {
  ConversationRecord,
  ProjectRecord,
} from "@owndesign/core/server/workspace-store";
import type { PublicAppSettings } from "@owndesign/core/server/settings/settings-service";
import type {
  InterfaceLanguage,
  ModelConfigurationForm,
  ResourceSettings,
} from "@/features/settings/types";

type ActionResult = { href?: string } | undefined | void;

export type WorkspaceState = {
  activeConversationId?: string;
  activeProject?: ProjectRecord;
  conversations: ConversationRecord[];
  projects: ProjectRecord[];
  settings: PublicAppSettings;
};

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(baseUrl = "") {
  const url = (path: string) => `${baseUrl}${path}`;

  async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url(path), init);

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return response.json() as Promise<T>;
  }

  return {
    buildUrl: url,
    createConversation(projectId: string) {
      return requestJson<ActionResult>(
        `/api/projects/${encodeURIComponent(projectId)}/conversations`,
        { method: "POST" },
      );
    },
    createProject(name: string, description?: string) {
      return requestJson<ActionResult>("/api/projects", {
        body: JSON.stringify({ description, name }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    },
    deleteConversation(
      projectId: string,
      conversationId: string,
      currentConversationId?: string,
    ) {
      const params = new URLSearchParams();

      if (currentConversationId) {
        params.set("currentConversationId", currentConversationId);
      }

      return requestJson<ActionResult>(
        `/api/projects/${encodeURIComponent(
          projectId,
        )}/conversations/${encodeURIComponent(conversationId)}?${params.toString()}`,
        { method: "DELETE" },
      );
    },
    deleteProject(projectId: string) {
      return requestJson<ActionResult>(
        `/api/projects/${encodeURIComponent(projectId)}`,
        { method: "DELETE" },
      );
    },
    loadSettings() {
      return requestJson<PublicAppSettings>("/api/settings");
    },
    loadWorkspace(projectId?: string, conversationId?: string) {
      const params = new URLSearchParams();

      if (projectId) {
        params.set("projectId", projectId);
      }

      if (conversationId) {
        params.set("conversationId", conversationId);
      }

      return requestJson<WorkspaceState>(`/api/workspace?${params.toString()}`);
    },
    renameConversation(projectId: string, conversationId: string, title: string) {
      return requestJson<ActionResult>(
        `/api/projects/${encodeURIComponent(
          projectId,
        )}/conversations/${encodeURIComponent(conversationId)}`,
        {
          body: JSON.stringify({ title }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        },
      );
    },
    renameProject(projectId: string, name: string, description?: string) {
      return requestJson<ActionResult>(
        `/api/projects/${encodeURIComponent(projectId)}`,
        {
          body: JSON.stringify({ description, name }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        },
      );
    },
    saveSettings(settings: {
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

      return requestJson<PublicAppSettings>("/api/settings", {
        body: JSON.stringify({
          defaultModelId,
          interfaceLanguage: settings.interfaceLanguage,
          modelConfigurations: settings.modelConfigurations.map(
            (configuration) => ({
              apiKey: configuration.apiKey,
              baseUrl: configuration.baseUrl,
              id: configuration.id,
              model: configuration.model,
              contextSizeK: configuration.contextSizeK,
              providerOptions: configuration.providerOptions,
              provider: configuration.provider,
            }),
          ),
          resources: settings.resources,
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
    },
    sendInitialSetup(input: InitialSetupInput) {
      return requestJson<ActionResult>("/api/initial-setup", {
        body: JSON.stringify(input),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    },
    selectConversation(projectId: string, conversationId: string) {
      return requestJson<ActionResult>(
        `/api/projects/${encodeURIComponent(
          projectId,
        )}/conversations/${encodeURIComponent(conversationId)}/select`,
        { method: "POST" },
      );
    },
    selectProject(projectId: string) {
      return requestJson<ActionResult>(
        `/api/projects/${encodeURIComponent(projectId)}/select`,
        { method: "POST" },
      );
    },
    streamChatUrl() {
      return url("/api/chat");
    },
  };
}

export type ConversationUpdatePayload = {
  id: string;
  lastMessageAt: string;
  messages: UIMessage[];
  title: string;
  updatedAt: string;
};
