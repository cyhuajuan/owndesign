import { revalidatePath } from "next/cache";
import {
  createConversationService,
  createProjectService,
} from "@/lib/hjdesign";
import { WorkspaceShell } from "@/components/workspace-shell";

async function createProjectFromControlBar(
  name: string,
  description?: string,
) {
  "use server";

  const trimmedName = name.trim();
  const trimmedDescription = description?.trim();

  if (!trimmedName) {
    return;
  }

  const result = await createProjectService().createProject({
    name: trimmedName,
    description: trimmedDescription || undefined,
  });
  revalidatePath("/");

  return {
    href: buildWorkspaceHref(result.project.id, result.conversation.id),
  };
}

async function renameProjectFromControlBar(
  projectId: string,
  name: string,
  description?: string,
) {
  "use server";

  const trimmedName = name.trim();
  const trimmedDescription = description?.trim();

  if (!projectId || !trimmedName) {
    return;
  }

  await createProjectService().renameProject(projectId, {
    name: trimmedName,
    description: trimmedDescription || undefined,
  });
  revalidatePath("/");
}

async function deleteProjectFromControlBar(projectId: string) {
  "use server";

  if (!projectId) {
    return;
  }

  await createProjectService().deleteProject(projectId);
  const projectState = await createProjectService().getProjectState();
  const fallbackProject = projectState.projects[0];
  const fallbackConversation = fallbackProject
    ? (await createConversationService().getConversationState(fallbackProject.id))
        .conversations[0]
    : undefined;

  revalidatePath("/");

  return {
    href: buildWorkspaceHref(fallbackProject?.id, fallbackConversation?.id),
  };
}

async function switchProjectFromControlBar(projectId: string) {
  "use server";

  if (!projectId) {
    return;
  }

  const conversationState =
    await createConversationService().getConversationState(projectId);
  const activeConversation = conversationState.conversations[0];

  revalidatePath("/");

  return {
    href: buildWorkspaceHref(projectId, activeConversation?.id),
  };
}

async function createConversationFromControlBar(projectId: string) {
  "use server";

  if (!projectId) {
    return;
  }

  const conversation =
    await createConversationService().createConversation(projectId);
  revalidatePath("/");

  return {
    href: buildWorkspaceHref(projectId, conversation.id),
  };
}

async function switchConversationFromControlBar(
  projectId: string,
  conversationId: string,
) {
  "use server";

  if (!projectId || !conversationId) {
    return;
  }

  await createConversationService().switchConversation(projectId, conversationId);
  revalidatePath("/");

  return {
    href: buildWorkspaceHref(projectId, conversationId),
  };
}

async function renameConversationFromControlBar(
  projectId: string,
  conversationId: string,
  title: string,
) {
  "use server";

  const trimmedTitle = title.trim();

  if (!projectId || !conversationId || !trimmedTitle) {
    return;
  }

  await createConversationService().renameConversation(projectId, conversationId, {
    title: trimmedTitle,
  });
  revalidatePath("/");
}

async function deleteConversationFromControlBar(
  projectId: string,
  conversationId: string,
  currentConversationId?: string,
) {
  "use server";

  if (!projectId || !conversationId) {
    return;
  }

  const remainingConversations =
    await createConversationService().deleteConversation(projectId, conversationId);
  const nextConversationId =
    currentConversationId === conversationId
      ? remainingConversations[0]?.id
      : currentConversationId;

  revalidatePath("/");

  return {
    href: buildWorkspaceHref(projectId, nextConversationId),
  };
}

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = (await searchParams) ?? {};
  const requestedProjectId = getSearchParam(params.projectId);
  const requestedConversationId = getSearchParam(params.conversationId);
  const projectState = await createProjectService().getProjectState();
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

function buildWorkspaceHref(projectId?: string, conversationId?: string) {
  if (!projectId) {
    return "/";
  }

  const params = new URLSearchParams({ projectId });

  if (conversationId) {
    params.set("conversationId", conversationId);
  }

  return `/?${params.toString()}`;
}

function getSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
