import { revalidatePath } from "next/cache";
import { FolderIcon, MessageSquareIcon, PlusIcon } from "lucide-react";

import {
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import { ChatShell } from "@/components/chat-shell";
import { ControlBar } from "@/components/control-bar";
import { PreviewEmptyState } from "@/components/preview-empty-state";
import { ProjectPreviewFrame } from "@/components/project-preview-frame";
import {
  createConversationService,
  createProjectService,
} from "@/lib/hjdesign";
import { normalizeConversationMessages } from "@/lib/chat-messages";
import { StreamingConversationPanel } from "@/components/streaming-conversation-panel";

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
    <ChatShell
      composer={
        !activeProject || !activeConversation ? (
          <ConversationEmptyState
            className="min-h-28 pt-4"
            description="请先创建项目，再开始发送消息。"
            icon={<PlusIcon />}
            title="输入区暂不可用"
          />
        ) : undefined
      }
      conversationBody={
        activeProject && activeConversation ? (
          <StreamingConversationPanel
            conversationId={activeConversation.id}
            initialMessages={normalizeConversationMessages(
              activeConversation.messages,
            )}
            key={activeConversation.id}
            projectId={activeProject.id}
          />
        ) : undefined
      }
      controlBar={
        <ControlBar
          activeConversationId={activeConversation?.id}
          activeProjectId={activeProject?.id}
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
      }
      messageHistory={
        activeConversation ? undefined : (
          <ConversationEmptyState
            description="选择或创建一个会话来填充这里。"
            icon={<MessageSquareIcon />}
            title="暂无当前会话"
          />
        )
      }
      previewBody={
        activeProject ? (
          <ProjectPreviewFrame
            initialUpdatedAt={activeProject.updatedAt}
            key={activeProject.id}
            projectId={activeProject.id}
            projectName={activeProject.name}
          />
        ) : (
          <PreviewEmptyState
            badge="Preview"
            description="在对话中向 AI 描述你的设计需求，生成的页面将在此处实时预览。"
            icon={<FolderIcon />}
            title="尚无预览内容"
          />
        )
      }
      previewFilename="index.html"
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
