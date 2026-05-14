import {
  ConversationRecord,
  ProjectRecord,
  WorkspaceState,
  WorkspaceStore,
} from "./workspace-store";

type CreateProjectInput = {
  name: string;
  description?: string;
};

type RenameProjectInput = {
  name: string;
  description?: string;
};

type ProjectServiceOptions = {
  workspaceStore: WorkspaceStore;
  now?: () => string;
  createId?: () => string;
};

type ProjectState = {
  activeProjectId?: string;
  activeConversationId?: string;
  projects: ProjectRecord[];
};

export class ProjectService {
  private readonly workspaceStore: WorkspaceStore;
  private readonly now: () => string;
  private readonly createId: () => string;

  constructor(options: ProjectServiceOptions) {
    this.workspaceStore = options.workspaceStore;
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  async createProject(input: CreateProjectInput) {
    const timestamp = this.now();
    const project: ProjectRecord = {
      id: this.createId(),
      name: input.name,
      description: input.description,
      outputType: "html",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const conversation: ConversationRecord = {
      id: this.createId(),
      projectId: project.id,
      title: "新建会话",
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };

    await this.workspaceStore.createProject(project);
    await this.workspaceStore.createConversation(conversation);
    await this.workspaceStore.writeWorkspaceState({
      activeProjectId: project.id,
      activeConversationId: conversation.id,
    });

    return project;
  }

  async renameProject(projectId: string, input: RenameProjectInput) {
    const existingProject = await this.workspaceStore.getProject(projectId);
    const renamedProject: ProjectRecord = {
      ...existingProject,
      name: input.name,
      description: input.description,
      updatedAt: this.now(),
    };

    return this.workspaceStore.updateProject(projectId, renamedProject);
  }

  async switchProject(projectId: string) {
    const conversations = await this.workspaceStore.listConversations(projectId);
    const activeConversationId = conversations[0]?.id;

    await this.workspaceStore.writeWorkspaceState({
      activeProjectId: projectId,
      activeConversationId,
    });
  }

  async deleteProject(projectId: string) {
    const currentState = await this.workspaceStore.readWorkspaceState();

    await this.workspaceStore.deleteProject(projectId);

    const remainingProjects = await this.workspaceStore.listProjects();
    const fallbackProject = remainingProjects[0];

    if (currentState.activeProjectId === projectId) {
      await this.workspaceStore.writeWorkspaceState(
        await this.buildStateForProject(fallbackProject?.id),
      );
    }
  }

  async getProjectState(): Promise<ProjectState> {
    const projects = await this.workspaceStore.listProjects();
    const storedState = await this.workspaceStore.readWorkspaceState();

    return {
      activeProjectId: storedState.activeProjectId,
      activeConversationId: storedState.activeConversationId,
      projects,
    };
  }

  private async buildStateForProject(
    projectId: string | undefined,
  ): Promise<WorkspaceState> {
    if (!projectId) {
      return {};
    }

    const conversations = await this.workspaceStore.listConversations(projectId);

    return {
      activeProjectId: projectId,
      activeConversationId: conversations[0]?.id,
    };
  }
}
