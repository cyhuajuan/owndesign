import { getPreviewServerManager } from "@owndesign/core/server/preview/preview-server-manager";
import { ConversationService } from "@owndesign/core/server/conversations/conversation-service";
import { ProjectService } from "@owndesign/core/server/projects/project-service";
import { createSettingsService } from "@owndesign/core/server/settings/settings-service";
import { WorkspaceStore } from "@owndesign/core/server/workspace-store";

export type OwnDesignServerOptions = {
  settingsPath?: string;
  workspaceRoot?: string;
};

export function createWorkspaceStore(options: OwnDesignServerOptions = {}) {
  return new WorkspaceStore({ workspaceRoot: options.workspaceRoot });
}

export function createProjectService(options: OwnDesignServerOptions = {}) {
  const workspaceStore = createWorkspaceStore(options);

  return new ProjectService({
    previewServerManager: getPreviewServerManager(workspaceStore),
    workspaceStore,
  });
}

export function createConversationService(options: OwnDesignServerOptions = {}) {
  return new ConversationService({
    workspaceStore: createWorkspaceStore(options),
  });
}

export function createOwnDesignServices(options: OwnDesignServerOptions = {}) {
  return {
    conversationService: createConversationService(options),
    projectService: createProjectService(options),
    settingsService: createSettingsService({ settingsPath: options.settingsPath }),
    workspaceStore: createWorkspaceStore(options),
  };
}
