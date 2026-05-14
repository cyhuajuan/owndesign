import { revalidatePath } from "next/cache";
import { FolderIcon, MessageSquareIcon, PlusIcon } from "lucide-react";

import {
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import { ChatShell } from "@/components/chat-shell";
import { ControlBar } from "@/components/control-bar";
import { ProjectPreviewFrame } from "@/components/project-preview-frame";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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

  await createProjectService().createProject({
    name: trimmedName,
    description: trimmedDescription || undefined,
  });
  revalidatePath("/");
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
  revalidatePath("/");
}

async function switchProjectFromControlBar(projectId: string) {
  "use server";

  if (!projectId) {
    return;
  }

  await createProjectService().switchProject(projectId);
  revalidatePath("/");
}

async function createConversationFromControlBar(projectId: string) {
  "use server";

  if (!projectId) {
    return;
  }

  await createConversationService().createConversation(projectId);
  revalidatePath("/");
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
) {
  "use server";

  if (!projectId || !conversationId) {
    return;
  }

  await createConversationService().deleteConversation(projectId, conversationId);
  revalidatePath("/");
}

export default async function Home() {
  const projectState = await createProjectService().getProjectState();
  const activeProject = projectState.projects.find(
    (project) => project.id === projectState.activeProjectId,
  );
  const conversationState = activeProject
    ? await createConversationService().getConversationState(activeProject.id)
    : { activeConversationId: undefined, conversations: [] };
  const activeConversation = conversationState.conversations.find(
    (conversation) =>
      conversation.id === conversationState.activeConversationId,
  );
  const previewHref = activeProject
    ? `/api/projects/${activeProject.id}/preview?updatedAt=${encodeURIComponent(
        activeProject.updatedAt,
      )}`
    : undefined;

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
          activeConversationId={conversationState.activeConversationId}
          activeProjectId={projectState.activeProjectId}
          conversations={conversationState.conversations}
          onCreateConversation={async () => {
            "use server";

            await createConversationFromControlBar(activeProject?.id ?? "");
          }}
          onCreateProject={createProjectFromControlBar}
          onDeleteConversation={async (conversationId) => {
            "use server";

            await deleteConversationFromControlBar(
              activeProject?.id ?? "",
              conversationId,
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

            await switchConversationFromControlBar(
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
            projectId={activeProject.id}
            projectName={activeProject.name}
          />
        ) : (
          <Empty className="size-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderIcon />
              </EmptyMedia>
              <EmptyTitle>尚无预览内容</EmptyTitle>
              <EmptyDescription>
                在对话中向 AI 描述你的设计需求，生成的页面将在此处实时预览。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      }
      previewFilename="index.html"
      previewHref={previewHref}
    />
  );
}
