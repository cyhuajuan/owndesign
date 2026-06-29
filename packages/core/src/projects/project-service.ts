import {
  ConversationRecord,
  ProjectRecord,
  type ProjectType,
  WorkspaceStore,
} from '@owndesign/core/workspace-store';
import { normalizeDefaultConversationTitle } from '@owndesign/core/conversations/default-title';
import { buildSingleHtmlTemplate } from '@owndesign/core/templates/single-html';

type CreateProjectInput = {
  defaultConversationTitle?: string;
  name: string;
  description?: string;
  designDocument?: string;
  projectType?: ProjectType;
};

type RenameProjectInput = {
  name: string;
  description?: string;
  designDocument?: string;
};

type ProjectServiceOptions = {
  workspaceStore: WorkspaceStore;
  now?: () => string;
  createId?: () => string;
  previewServerManager?: {
    stop: (projectId: string) => Promise<void>;
  };
};

type ProjectState = {
  projects: ProjectRecord[];
};

export class ProjectService {
  private readonly workspaceStore: WorkspaceStore;
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly previewServerManager: { stop: (projectId: string) => Promise<void> } | undefined;

  constructor(options: ProjectServiceOptions) {
    this.workspaceStore = options.workspaceStore;
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.previewServerManager = options.previewServerManager;
  }

  async createProject(input: CreateProjectInput) {
    const projectType = input.projectType ?? 'single_html';

    if (projectType === 'react') {
      throw new Error('React project type is reserved but not supported yet.');
    }

    const timestamp = this.now();
    const project: ProjectRecord = {
      id: this.createId(),
      name: input.name,
      description: input.description,
      designDocument: normalizeDesignDocument(input.designDocument),
      projectType,
      outputType: 'html',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const conversation: ConversationRecord = {
      id: this.createId(),
      projectId: project.id,
      title: normalizeDefaultConversationTitle(input.defaultConversationTitle),
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };

    await this.workspaceStore.createProject(project);
    await this.workspaceStore.writeProjectWorkspaceFile(
      project.id,
      'index.html',
      buildSingleHtmlTemplate({ title: input.name }),
    );
    await this.workspaceStore.createConversation(conversation);

    return { conversation, project };
  }

  async renameProject(projectId: string, input: RenameProjectInput) {
    const existingProject = await this.workspaceStore.getProject(projectId);
    const renamedProject: ProjectRecord = {
      ...existingProject,
      name: input.name,
      description: input.description,
      designDocument: normalizeDesignDocument(input.designDocument),
      updatedAt: this.now(),
    };

    return this.workspaceStore.updateProject(projectId, renamedProject);
  }

  async deleteProject(projectId: string) {
    await this.previewServerManager?.stop(projectId);
    await this.workspaceStore.deleteProject(projectId);
  }

  async getProjectState(): Promise<ProjectState> {
    const projects = await this.workspaceStore.listProjects();

    return {
      projects,
    };
  }
}

function normalizeDesignDocument(value: string | undefined) {
  return value?.trim() ? value : undefined;
}
