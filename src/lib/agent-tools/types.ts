import type { WorkspaceStore } from "@/lib/workspace-store";
import type { ResourceSettings } from "@/lib/settings-service";

export type ProjectWorkspaceToolContext = {
  approvedCdnUrls?: string[];
  projectId: string;
  resources: ResourceSettings;
  workspaceStore: WorkspaceStore;
};

export type CreateHtmlInput = {
  fontLibraryName?: string;
  iconLibraryName?: string;
  path: string;
  title?: string;
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
        operation: "add" | "write";
        path: string;
      }
    | {
        newString: string;
        oldString: string;
        operation: "edit";
        path: string;
        replaceAll?: boolean;
      }
    | {
        operation: "delete";
        path: string;
      }
  >;
};

export type ReadInput = {
  limit?: number;
  offset?: number;
  path: string;
};

export type SwitchPreviewInput = {
  path: string;
};

export type WriteInput = {
  content: string;
  path: string;
};
