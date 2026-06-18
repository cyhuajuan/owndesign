import type { WorkspaceStore } from '@owndesign/core/workspace-store';
import type { ResourceSettings } from '@owndesign/core/settings/settings-service';

export type ProjectWorkspaceToolContext = {
  frontendTabId?: string;
  projectId: string;
  resources: ResourceSettings;
  workspaceStore: WorkspaceStore;
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

export type ReadInput = {
  limit?: number;
  offset?: number;
  path: string;
};

export type WriteInput = {
  content: string;
  path: string;
};
