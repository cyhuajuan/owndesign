import { ConversationService } from "./conversation-service";
import { ProjectService } from "./project-service";
import { WorkspaceStore } from "./workspace-store";

export function createWorkspaceStore() {
  return new WorkspaceStore();
}

export function createProjectService() {
  return new ProjectService({
    workspaceStore: createWorkspaceStore(),
  });
}

export function createConversationService() {
  return new ConversationService({
    workspaceStore: createWorkspaceStore(),
  });
}
