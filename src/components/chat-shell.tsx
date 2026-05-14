"use client";

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  MessageSquareTextIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "lucide-react";

const CONVERSATION_PANE_STORAGE_KEY = "hjdesign.app.conversation-pane-collapsed";
const CONVERSATION_PANE_EVENT = "hjdesign:conversation-pane";

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

type ChatShellProps = {
  composer?: ReactNode;
  conversationBody?: ReactNode;
  controlBar?: ReactNode;
  messageHistory?: ReactNode;
  previewBody?: ReactNode;
  previewDescription?: ReactNode;
  previewTitle?: ReactNode;
};

export function ChatShell({
  composer,
  conversationBody,
  controlBar,
  messageHistory,
  previewBody,
  previewDescription,
  previewTitle,
}: ChatShellProps) {
  const isConversationCollapsed = useSyncExternalStore(
    subscribeToConversationPaneState,
    readConversationPaneState,
    () => false,
  );

  return (
    <div
      className={cn(
        "grid min-h-screen gap-4 bg-background p-4 text-foreground",
        isConversationCollapsed
          ? "lg:grid-cols-[minmax(0,1fr)]"
          : "lg:grid-cols-[minmax(22rem,30rem)_minmax(0,1fr)]",
      )}
    >
      {isConversationCollapsed ? null : (
        <Card
          aria-label="会话工作流"
          className="flex min-h-[40rem] flex-col overflow-hidden border border-border/70 bg-card shadow-sm"
          role="region"
        >
          <CardHeader className="gap-4 border-b bg-muted/35">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2">
                  <MessageSquareTextIcon data-icon="inline-start" />
                  会话工作流
                </CardTitle>
                <CardDescription>
                  控制栏、消息历史和输入区。
                </CardDescription>
              </div>
            </div>
            {controlBar ? (
              <div key="control-bar">{controlBar}</div>
            ) : (
              <div className="flex items-center gap-2">
                <Button size="sm" type="button" variant="secondary">
                  当前项目
                </Button>
                <Button size="sm" type="button" variant="outline">
                  切换项目
                </Button>
                <Button size="sm" type="button" variant="outline">
                  切换会话
                </Button>
                <Button size="sm" type="button" variant="outline">
                  新建会话
                </Button>
              </div>
            )}
          </CardHeader>

          <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-0">
            {conversationBody ?? (
              <>
                <Conversation className="min-h-0">
                  <ConversationContent>
                    {messageHistory ??
                      (demoMessages.length === 0 ? (
                        <ConversationEmptyState />
                      ) : (
                        demoMessages.map((message, index) => (
                          <Message from={message.role} key={`${message.role}-${index}`}>
                            <MessageContent>{message.content}</MessageContent>
                          </Message>
                        ))
                      ))}
                  </ConversationContent>
                </Conversation>

                <div className="border-t bg-card px-4 pb-4">
                  {composer ?? (
                    <PromptInput onSubmit={() => {}}>
                      <PromptInputBody>
                        <PromptInputTextarea placeholder="描述下一步设计动作..." />
                      </PromptInputBody>
                      <PromptInputFooter>
                        <PromptInputTools />
                        <PromptInputSubmit />
                      </PromptInputFooter>
                    </PromptInput>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card
        aria-label="预览面板"
        className="flex min-h-[40rem] flex-col overflow-hidden border border-border/70 bg-card shadow-sm"
        role="region"
      >
        <CardHeader className="flex flex-row items-center justify-between gap-3 border-b bg-muted/25">
          <Button
            aria-label={
              isConversationCollapsed
                ? "展开会话面板"
                : "收起会话面板"
            }
            onClick={() => writeConversationPaneState(!isConversationCollapsed)}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            {isConversationCollapsed ? (
              <PanelLeftOpenIcon />
            ) : (
              <PanelLeftCloseIcon />
            )}
          </Button>
          <div className="min-w-0 text-right">
            <CardTitle>{previewTitle ?? "预览面板"}</CardTitle>
            <CardDescription>
              {previewDescription ??
                "预览标题和项目范围输出会显示在这里。"}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="min-h-0 flex-1 p-0">
          <ScrollArea className="h-full">
            {previewBody ?? (
              <div className="flex min-h-[32rem] flex-col gap-4 p-6">
                <div className="rounded-lg border border-dashed bg-background p-6">
                  <p className="text-sm font-medium text-foreground">
                    项目预览占位
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    预览运行时接入后，共享项目输出会显示在这里。
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg border bg-card p-4">
                    <p className="text-sm font-medium text-foreground">
                      预览标题区
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      最左侧按钮负责切换会话面板的收起状态。
                    </p>
                  </div>
                  <div className="rounded-lg border bg-card p-4">
                    <p className="text-sm font-medium text-foreground">
                      项目输出
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      同一项目下的所有会话共享这个输出区域。
                    </p>
                  </div>
                </div>
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function subscribeToConversationPaneState(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === CONVERSATION_PANE_STORAGE_KEY
    ) {
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
