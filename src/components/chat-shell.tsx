"use client";

import type { CSSProperties, ReactNode } from "react";
import { useMemo, useSyncExternalStore } from "react";
import {
  ExternalLinkIcon,
  LayersIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RefreshCwIcon,
} from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const CONVERSATION_PANE_STORAGE_KEY =
  "hjdesign.app.conversation-pane-collapsed";
const CONVERSATION_PANE_EVENT = "hjdesign:conversation-pane";
const PREVIEW_REFRESH_EVENT = "hjdesign:preview-refresh";

const demoMessages = [
  {
    content: "为设计评审工作台创建紧凑的移动端首屏。",
    role: "user" as const,
  },
  {
    content:
      "模拟助手回复：预览壳层已就绪。下一步可以接入实时项目和会话状态。",
    role: "assistant" as const,
  },
];

type PreviewStatus = "ready" | "loading" | "error";

type ChatShellProps = {
  composer?: ReactNode;
  conversationBody?: ReactNode;
  controlBar?: ReactNode;
  messageHistory?: ReactNode;
  previewActions?: ReactNode;
  previewBody?: ReactNode;
  previewFilename?: ReactNode;
  previewHref?: string;
  previewStatus?: PreviewStatus;
};

const statusLabels: Record<PreviewStatus, string> = {
  error: "异常",
  loading: "加载中...",
  ready: "就绪",
};

export function ChatShell({
  composer,
  conversationBody,
  controlBar,
  messageHistory,
  previewActions,
  previewBody,
  previewFilename = "index.html",
  previewHref,
  previewStatus = "ready",
}: ChatShellProps) {
  const isConversationCollapsed = useSyncExternalStore(
    subscribeToConversationPaneState,
    readConversationPaneState,
    () => false,
  );
  const isSidebarOpen = !isConversationCollapsed;
  const statusClassName = useMemo(
    () =>
      cn(
        "size-1.5 rounded-full",
        previewStatus === "ready" && "bg-[var(--status-ready)]",
        previewStatus === "loading" &&
          "animate-pulse bg-[var(--status-warning)]",
        previewStatus === "error" && "bg-destructive",
      ),
    [previewStatus],
  );

  return (
    <SidebarProvider
      className="h-svh min-h-0 bg-background text-foreground"
      open={isSidebarOpen}
      onOpenChange={(open) => writeConversationPaneState(!open)}
      style={
        {
          "--sidebar-width": "400px",
          "--sidebar-width-icon": "0px",
        } as CSSProperties
      }
    >
      <div className="flex h-svh w-full flex-col overflow-hidden bg-background">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
          <div className="flex shrink-0 items-center gap-2 font-semibold text-primary">
            <LayersIcon className="size-5" />
            <span className="text-[15px] tracking-normal">HJDesign</span>
          </div>
          <Separator orientation="vertical" className="h-5" />
          {controlBar ? (
            <div key="control-bar" className="min-w-0">
              {controlBar}
            </div>
          ) : null}
          <div className="flex-1" />
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar
            aria-label="会话工作流"
            className="top-11 h-[calc(100svh-2.75rem)] border-r border-border bg-card"
            collapsible="offcanvas"
            role="region"
          >
            <SidebarContent className="bg-card">
              {conversationBody ?? (
                <Conversation className="min-h-0">
                  <ConversationContent className="gap-2 p-4">
                    {messageHistory ??
                      (demoMessages.length === 0 ? (
                        <ConversationEmptyState />
                      ) : (
                        demoMessages.map((message, index) => (
                          <Message
                            from={message.role}
                            key={`${message.role}-${index}`}
                          >
                            <MessageContent>{message.content}</MessageContent>
                          </Message>
                        ))
                      ))}
                  </ConversationContent>
                </Conversation>
              )}
            </SidebarContent>
            {conversationBody ? null : (
              <SidebarFooter className="border-t border-border bg-card p-3">
                {composer ?? (
                  <PromptInput onSubmit={() => {}}>
                    <PromptInputBody>
                      <PromptInputTextarea placeholder="输入消息..." />
                    </PromptInputBody>
                    <PromptInputFooter>
                      <PromptInputTools />
                      <PromptInputSubmit />
                    </PromptInputFooter>
                  </PromptInput>
                )}
              </SidebarFooter>
            )}
          </Sidebar>

          <SidebarInset
            aria-label="预览面板"
            className="min-w-0 bg-background"
            role="region"
          >
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-border bg-card px-3">
                <Button
                  aria-label={
                    isConversationCollapsed
                      ? "展开会话面板"
                      : "收起会话面板"
                  }
                  onClick={() =>
                    writeConversationPaneState(!isConversationCollapsed)
                  }
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  {isConversationCollapsed ? (
                    <PanelLeftOpenIcon />
                  ) : (
                    <PanelLeftCloseIcon />
                  )}
                </Button>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={statusClassName} />
                  <span>{statusLabels[previewStatus]}</span>
                </div>
                <div className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                  {previewFilename}
                </div>
                <div className="flex items-center gap-1">
                  {previewActions ?? (
                    <>
                      <Button
                        aria-label="刷新预览"
                        onClick={() => {
                          window.dispatchEvent(new Event(PREVIEW_REFRESH_EVENT));
                        }}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <RefreshCwIcon />
                      </Button>
                      <Button
                        aria-label="新窗口打开预览"
                        disabled={!previewHref}
                        onClick={() => {
                          if (previewHref) {
                            window.open(previewHref, "_blank", "noopener");
                          }
                        }}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <ExternalLinkIcon />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="relative min-h-0 flex-1 overflow-hidden">
                {previewBody ?? (
                  <div className="flex size-full items-center justify-center p-10">
                    <ConversationEmptyState
                      description="在对话中向 AI 描述你的设计需求，生成的页面将在此处实时预览。"
                      title="尚无预览内容"
                    />
                  </div>
                )}
              </div>
            </div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}

function subscribeToConversationPaneState(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === CONVERSATION_PANE_STORAGE_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(CONVERSATION_PANE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CONVERSATION_PANE_EVENT, onStoreChange);
  };
}

function readConversationPaneState() {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.localStorage.getItem(CONVERSATION_PANE_STORAGE_KEY) === "true"
  );
}

function writeConversationPaneState(value: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    CONVERSATION_PANE_STORAGE_KEY,
    String(value),
  );
  window.dispatchEvent(new Event(CONVERSATION_PANE_EVENT));
}
