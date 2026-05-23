import {
  createConversationService,
  createProjectService,
} from "@/server/owndesign";
import { createSettingsService } from "@/server/settings/settings-service";
import { InitialSetupGuide } from "@/features/onboarding/components/initial-setup-guide";
import { WorkspaceShell } from "@/features/workspace/components/workspace-shell";
import { getSearchParam } from "@/features/workspace/navigation";
import {
  completeInitialSetup,
  createConversationFromControlBar,
  createProjectFromControlBar,
  deleteConversationFromControlBar,
  deleteProjectFromControlBar,
  renameConversationFromControlBar,
  renameProjectFromControlBar,
  switchConversationFromControlBar,
  switchProjectFromControlBar,
} from "@/features/workspace/server-actions";

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = (await searchParams) ?? {};
  const requestedProjectId = getSearchParam(params.projectId);
  const requestedConversationId = getSearchParam(params.conversationId);
  const projectState = await createProjectService().getProjectState();
  const settings = await createSettingsService().getPublicSettings();

  if (
    projectState.projects.length === 0 &&
    settings.modelConfigurations.length === 0
  ) {
    return <InitialSetupGuide onComplete={completeInitialSetup} />;
  }

  const activeProject = projectState.projects.find(
    (project) => project.id === requestedProjectId,
  ) ?? projectState.projects[0];
  const conversationState = activeProject
    ? await createConversationService().getConversationState(activeProject.id)
    : { conversations: [] };
  const activeConversation = conversationState.conversations.find(
    (conversation) => conversation.id === requestedConversationId,
  ) ?? conversationState.conversations[0];

  return (
    <WorkspaceShell
      activeConversationId={activeConversation?.id}
      activeProject={activeProject}
      conversations={conversationState.conversations}
      onCreateConversation={async () => {
        "use server";

        return createConversationFromControlBar(activeProject?.id ?? "");
      }}
      onCreateProject={createProjectFromControlBar}
      onDeleteConversation={async (conversationId) => {
        "use server";

        return deleteConversationFromControlBar(
          activeProject?.id ?? "",
          conversationId,
          activeConversation?.id,
        );
      }}
      onDeleteProject={deleteProjectFromControlBar}
      onRenameConversation={async (conversationId, title) => {
        "use server";

        await renameConversationFromControlBar(
          activeProject?.id ?? "",
          conversationId,
          title,
        );
      }}
      onRenameProject={renameProjectFromControlBar}
      onSelectConversation={async (conversationId) => {
        "use server";

        return switchConversationFromControlBar(
          activeProject?.id ?? "",
          conversationId,
        );
      }}
      onSelectProject={switchProjectFromControlBar}
      projects={projectState.projects}
    />
  );
}
