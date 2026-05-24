import { useCallback, useEffect, useState } from "react";
import {
  BrowserRouter,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiClientProvider, useApiClient } from "@/api/context";
import { InitialSetupGuide } from "@/features/onboarding/components/initial-setup-guide";
import { WorkspaceShell } from "@/features/workspace/components/workspace-shell";
import type { WorkspaceState } from "@/api/client";

export function OwnDesignApp({ apiBaseUrl = "" }: { apiBaseUrl?: string }) {
  return (
    <ApiClientProvider baseUrl={apiBaseUrl}>
      <BrowserRouter>
        <TooltipProvider>
          <WorkspaceRoute />
        </TooltipProvider>
      </BrowserRouter>
    </ApiClientProvider>
  );
}

function WorkspaceRoute() {
  const api = useApiClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<WorkspaceState>();
  const [error, setError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);
  const projectId = searchParams.get("projectId") ?? undefined;
  const conversationId = searchParams.get("conversationId") ?? undefined;
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    const handleRefresh = () => refresh();

    window.addEventListener("owndesign:workspace-refresh", handleRefresh);

    return () => {
      window.removeEventListener("owndesign:workspace-refresh", handleRefresh);
    };
  }, [refresh]);

  useEffect(() => {
    let isActive = true;

    api
      .loadWorkspace(projectId, conversationId)
      .then((workspaceState) => {
        if (isActive) {
          setState(workspaceState);
          setError(undefined);
        }
      })
      .catch((loadError: unknown) => {
        if (isActive) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Workspace load failed.",
          );
        }
      });

    return () => {
      isActive = false;
    };
  }, [api, conversationId, projectId, refreshKey]);

  const actions = {
    onCreateConversation: () =>
      state?.activeProject
        ? api.createConversation(state.activeProject.id)
        : undefined,
    onCreateProject: api.createProject,
    onDeleteConversation: (targetConversationId: string) =>
      state?.activeProject
        ? api.deleteConversation(
            state.activeProject.id,
            targetConversationId,
            state.activeConversationId,
          )
        : undefined,
    onDeleteProject: api.deleteProject,
    onRenameConversation: (targetConversationId: string, title: string) =>
      state?.activeProject
        ? api.renameConversation(
            state.activeProject.id,
            targetConversationId,
            title,
          )
        : undefined,
    onRenameProject: api.renameProject,
    onSelectConversation: (targetConversationId: string) =>
      state?.activeProject
        ? api.selectConversation(state.activeProject.id, targetConversationId)
        : undefined,
    onSelectProject: api.selectProject,
  };

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8 text-destructive">
        {error}
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (
    state.projects.length === 0 &&
    state.settings.modelConfigurations.length === 0
  ) {
    return (
      <InitialSetupGuide
        onComplete={async (input) => {
          const result = await api.sendInitialSetup(input);

          if (result?.href) {
            navigate(result.href);
          } else {
            refresh();
          }
        }}
      />
    );
  }

  return (
    <WorkspaceShell
      activeConversationId={state.activeConversationId}
      activeProject={state.activeProject}
      conversations={state.conversations}
      key={location.key}
      projects={state.projects}
      {...actions}
    />
  );
}
