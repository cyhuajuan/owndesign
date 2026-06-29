import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, useNavigate, useParams, Routes, Route } from 'react-router';

import { AppBrand } from '@/components/app-brand';
import { Separator } from '@/components/ui/separator';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiClientProvider, useApiClient } from '@/api/context';
import { InitialSetupGuide } from '@/features/onboarding/components/initial-setup-guide';
import { LanguageProvider, useI18n } from '@/features/i18n/context';
import { WorkspaceShell } from '@/features/workspace/components/workspace-shell';
import type { WorkspaceShellSlots } from '@/features/workspace/components/workspace-shell';
import type { WorkspaceState } from '@/api/client';
import { buildWorkspaceHref } from '@owndesign/core/navigation';

export type OwnDesignAppProps = {
  apiBaseUrl?: string;
  shellSlots?: WorkspaceShellSlots;
};

export function OwnDesignApp({ apiBaseUrl = '', shellSlots }: OwnDesignAppProps) {
  return (
    <ApiClientProvider baseUrl={apiBaseUrl}>
      <BrowserRouter>
        <TooltipProvider>
          <LanguageProvider>
            <Routes>
              <Route path="/" element={<WorkspaceRoute shellSlots={shellSlots} />} />
              <Route
                path="/projects/:projectId"
                element={<WorkspaceRoute shellSlots={shellSlots} />}
              />
              <Route
                path="/projects/:projectId/conversations/:conversationId"
                element={<WorkspaceRoute shellSlots={shellSlots} />}
              />
              <Route path="*" element={<WorkspaceRoute shellSlots={shellSlots} />} />
            </Routes>
          </LanguageProvider>
        </TooltipProvider>
      </BrowserRouter>
    </ApiClientProvider>
  );
}

function WorkspaceRoute({ shellSlots }: { shellSlots?: WorkspaceShellSlots }) {
  const api = useApiClient();
  const { t } = useI18n();
  const navigate = useNavigate();
  const params = useParams();
  const [state, setState] = useState<WorkspaceState>();
  const [error, setError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);
  const projectId = params.projectId;
  const conversationId = params.conversationId;
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    const handleRefresh = () => refresh();

    window.addEventListener('owndesign:workspace-refresh', handleRefresh);

    return () => {
      window.removeEventListener('owndesign:workspace-refresh', handleRefresh);
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
          setError(loadError instanceof Error ? loadError.message : 'Workspace load failed.');
        }
      });

    return () => {
      isActive = false;
    };
  }, [api, conversationId, projectId, refreshKey]);

  useEffect(() => {
    if (!state?.activeRun) {
      return;
    }

    const timer = window.setInterval(() => {
      refresh();
    }, 2_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [refresh, state?.activeRun]);

  const actions = useMemo(() => {
    const activeProjectId = state?.activeProject?.id;

    return {
      onCreateConversation: () =>
        activeProjectId ? api.createConversation(activeProjectId) : undefined,
      onCreateProject: (name: string, description?: string, designDocument?: string | null) =>
        api.createProject(name, description, designDocument, 'single_html'),
      onDeleteConversation: (targetConversationId: string) =>
        activeProjectId
          ? api.deleteConversation(
              activeProjectId,
              targetConversationId,
              state?.activeConversationId,
            )
          : undefined,
      onDeleteProject: async (targetProjectId: string) => {
        const result = await api.deleteProject(targetProjectId);

        if (targetProjectId !== activeProjectId) {
          refresh();
          return undefined;
        }

        return result;
      },
      onRenameConversation: (targetConversationId: string, title: string) =>
        activeProjectId
          ? api.renameConversation(activeProjectId, targetConversationId, title)
          : undefined,
      onRenameProject: (
        targetProjectId: string,
        name: string,
        description?: string,
        designDocument?: string | null,
      ) => api.renameProject(targetProjectId, name, description, designDocument),
      onSelectConversation: (targetConversationId: string) =>
        activeProjectId ? api.selectConversation(activeProjectId, targetConversationId) : undefined,
      onSelectProject: (targetProjectId: string) => ({
        href: buildWorkspaceHref({ projectId: targetProjectId }),
      }),
    };
  }, [api, refresh, state?.activeConversationId, state?.activeProject?.id]);

  if (error) {
    return renderStandaloneRouteContent(
      <div className="flex min-h-screen items-center justify-center bg-background p-8 text-destructive">
        {error}
      </div>,
      shellSlots,
    );
  }

  if (!state) {
    return renderStandaloneRouteContent(
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        {t('app.loading')}
      </div>,
      shellSlots,
    );
  }

  if (state.projects.length === 0 && state.settings.modelConfigurations.length === 0) {
    return renderStandaloneRouteContent(
      <InitialSetupGuide
        onComplete={async (input) => {
          const result = await api.sendInitialSetup(input);

          if (result?.href) {
            navigate(result.href);
          } else {
            refresh();
          }
        }}
      />,
      shellSlots,
    );
  }

  return (
    <WorkspaceShell
      activeConversationId={state.activeConversationId}
      activeProject={state.activeProject}
      activeRun={state.activeRun}
      conversations={state.conversations}
      key={state.activeProject?.id ?? 'empty-workspace'}
      projects={state.projects}
      shellSlots={shellSlots}
      {...actions}
    />
  );
}

function renderStandaloneRouteContent(content: ReactNode, shellSlots?: WorkspaceShellSlots) {
  if (!shellSlots) {
    return content;
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card py-0 pl-3 pr-0">
        <AppBrand />
        <Separator orientation="vertical" className="h-5" />
        {shellSlots.topBarDragRegion ?? <div className="flex-1" />}
        {shellSlots.topBarTrailing}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{content}</div>
    </div>
  );
}
