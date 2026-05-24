import { ConversationService } from "@owndesign/core/conversations/conversation-service";
import { getPreviewServerManager } from "@owndesign/core/preview/preview-server-manager";
import { ProjectService } from "@owndesign/core/projects/project-service";
import { WorkspaceStore } from "@owndesign/core/workspace-store";

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
