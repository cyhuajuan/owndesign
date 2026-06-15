import type { WorkspaceStore } from '@owndesign/core/workspace-store';
import type { ResourceSettings } from '@owndesign/core/settings/settings-service';
import type { LanguageModel, ToolLoopAgentSettings } from 'ai';

export type ProjectWorkspaceToolContext = {
  frontendTabId?: string;
  projectId: string;
  resources: ResourceSettings;
  workspaceStore: WorkspaceStore;
};

export type DesignWorkspaceToolContext = ProjectWorkspaceToolContext & {
  model: LanguageModel;
  providerOptions?: ToolLoopAgentSettings['providerOptions'];
};

export type ComponentAuditInput = {
  completedWorkSummary?: string;
  taskSummary?: string;
};

export type CreateHtmlInput = {
  path: string;
  title?: string;
};

export type CopyFileInput = {
  sourcePath: string;
  targetPath: string;
};

export type DeleteInput = {
  path: string;
};

export type EditInput = {
  newString: string;
  oldString: string;
  path: string;
  replaceAll?: boolean;
};

export type GlobInput = {
  path?: string;
  pattern: string;
};

export type GrepInput = {
  include?: string;
  path?: string;
  pattern: string;
};

export type PatchInput = {
  changes: Array<
    | {
        content: string;
        operation: 'add' | 'write';
        path: string;
      }
    | {
        newString: string;
        oldString: string;
        operation: 'edit';
        path: string;
        replaceAll?: boolean;
      }
    | {
        operation: 'delete';
        path: string;
      }
  >;
};

export type ReadInput = {
  limit?: number;
  offset?: number;
  path: string;
};

export type SyncSharedComponentInput = {
  content?: string;
  description?: string;
  name: string;
  tagName?: string;
  usedBy?: string[];
};

export type WriteInput = {
  content: string;
  path: string;
};
