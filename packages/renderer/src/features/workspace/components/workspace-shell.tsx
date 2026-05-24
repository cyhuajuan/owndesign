"use client";

import { useMemo, useState } from "react";
import { FolderIcon, MessageSquareIcon, PlusIcon } from "lucide-react";

import {
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import { ChatShell } from "@/features/workspace/components/chat-shell";
import { ControlBar } from "@/features/projects/components/control-bar";
import { PreviewEmptyState } from "@/features/preview/components/preview-empty-state";
import { ProjectPreviewFrame } from "@/features/preview/components/project-preview-frame";
import {
  StreamingConversationPanel,
  type ConversationPanelUpdate,
} from "@/features/conversation/components/streaming-conversation-panel";
import { normalizeConversationMessages } from "@owndesign/core/server/conversations/chat-messages";
import type {
  ConversationRecord,
  ProjectRecord,
} from "@owndesign/core/server/workspace-store";

type ActionResult = { href?: string } | undefined | void;

type WorkspaceShellProps = {
  activeConversationId?: string;
  activeProject?: ProjectRecord;
  conversations: ConversationRecord[];
  onCreateConversation: () => Promise<ActionResult> | ActionResult;
  onCreateProject: (
    name: string,
    description?: string,
  ) => Promise<ActionResult> | ActionResult;
  onDeleteConversation: (
    conversationId: string,
  ) => Promise<ActionResult> | ActionResult;
  onDeleteProject: (
    projectId: string,
  ) => Promise<ActionResult> | ActionResult;
  onRenameConversation: (
    conversationId: string,
    title: string,
  ) => Promise<ActionResult> | ActionResult;
  onRenameProject: (
    projectId: string,
    name: string,
    description?: string,
  ) => Promise<ActionResult> | ActionResult;
  onSelectConversation: (
    conversationId: string,
  ) => Promise<ActionResult> | ActionResult;
  onSelectProject: (
    projectId: string,
  ) => Promise<ActionResult> | ActionResult;
  projects: ProjectRecord[];
};

export function WorkspaceShell({
  activeConversationId,
  activeProject,
  conversations,
  onCreateConversation,
  onCreateProject,
  onDeleteConversation,
  onDeleteProject,
  onRenameConversation,
  onRenameProject,
  onSelectConversation,
  onSelectProject,
  projects,
}: WorkspaceShellProps) {
  const [conversationUpdates, setConversationUpdates] = useState<
    Record<string, ConversationPanelUpdate>
  >({});
  const clientConversations = useMemo(
    () =>
      sortConversations(
        conversations.map((conversation) => {
          const update = conversationUpdates[conversation.id];

          return update
            ? {
                ...conversation,
                lastMessageAt: update.lastMessageAt,
                messages: update.messages as unknown[],
                title: update.title,
                updatedAt: update.updatedAt,
              }
            : conversation;
        }),
      ),
    [conversationUpdates, conversations],
  );

  const activeConversation = useMemo(
    () =>
      clientConversations.find(
        (conversation) => conversation.id === activeConversationId,
      ) ?? clientConversations[0],
    [activeConversationId, clientConversations],
  );

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
      controlBar={
        <ControlBar
          activeConversationId={activeConversation?.id}
          activeProjectId={activeProject?.id}
          conversations={clientConversations}
          onCreateConversation={onCreateConversation}
          onCreateProject={onCreateProject}
          onDeleteConversation={onDeleteConversation}
          onDeleteProject={onDeleteProject}
          onRenameConversation={onRenameConversation}
          onRenameProject={onRenameProject}
          onSelectConversation={onSelectConversation}
          onSelectProject={onSelectProject}
          projects={projects}
        />
      }
      conversationBody={
        activeProject && activeConversation ? (
          <StreamingConversationPanel
            conversationId={activeConversation.id}
            conversationTitle={activeConversation.title}
            initialMessages={normalizeConversationMessages(
              activeConversation.messages,
            )}
            key={activeConversation.id}
            onConversationUpdate={handleConversationUpdate}
            projectId={activeProject.id}
            titleManuallySet={activeConversation.titleManuallySet}
          />
        ) : undefined
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
      previewProjectId={activeProject?.id}
    />
  );

  function handleConversationUpdate(update: ConversationPanelUpdate) {
    setConversationUpdates((current) => ({
      ...current,
      [update.id]: update,
    }));
  }
}

function sortConversations(conversations: ConversationRecord[]) {
  return [...conversations].sort((left, right) => {
    const leftTime = left.lastMessageAt ?? left.createdAt;
    const rightTime = right.lastMessageAt ?? right.createdAt;

    return new Date(rightTime).getTime() - new Date(leftTime).getTime();
  });
}
