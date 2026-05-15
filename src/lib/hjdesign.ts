import { ConversationService } from "./conversation-service";
import { getPreviewServerManager } from "./preview-server-manager";
import { ProjectService } from "./project-service";
import { WorkspaceStore } from "./workspace-store";

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
