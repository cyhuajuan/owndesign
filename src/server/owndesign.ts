import { ConversationService } from "@/server/conversations/conversation-service";
import { getPreviewServerManager } from "@/server/preview/preview-server-manager";
import { ProjectService } from "@/server/projects/project-service";
import { WorkspaceStore } from "@/server/workspace-store";

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
