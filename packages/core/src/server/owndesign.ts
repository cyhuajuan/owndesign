import { ConversationService } from "@owndesign/core/server/conversations/conversation-service";
import { getPreviewServerManager } from "@owndesign/core/server/preview/preview-server-manager";
import { ProjectService } from "@owndesign/core/server/projects/project-service";
import { WorkspaceStore } from "@owndesign/core/server/workspace-store";

export function createWorkspaceStore() {
  return new WorkspaceStore();
}

export function createProjectService() {
  const workspaceStore = createWorkspaceStore();

  return new ProjectService({
    previewServerManager: getPreviewServerManager(workspaceStore),
    workspaceStore,
  });
}

export function createConversationService() {
  return new ConversationService({
    workspaceStore: createWorkspaceStore(),
  });
}
