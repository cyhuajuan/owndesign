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
