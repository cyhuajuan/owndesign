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
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const CONVERSATION_PANE_STORAGE_KEY = "hjdesign.app.conversation-pane-collapsed";
const CONVERSATION_PANE_EVENT = "hjdesign:conversation-pane";

const demoMessages = [
  {
    content: "Create compact mobile hero for design critique workspace.",
    role: "user" as const,
  },
  {
    content:
      "Mock Agent Reply: preview shell ready. Next slices can wire live Project and Conversation state.",
    role: "assistant" as const,
  },
];

type ChatShellProps = {
  composer?: ReactNode;
  controlBar?: ReactNode;
  messageHistory?: ReactNode;
  previewBody?: ReactNode;
  previewDescription?: ReactNode;
  previewTitle?: ReactNode;
};

export function ChatShell({
  composer,
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
        "grid min-h-screen gap-4 bg-muted/40 p-4",
        isConversationCollapsed
          ? "lg:grid-cols-[minmax(0,1fr)]"
          : "lg:grid-cols-[minmax(22rem,30rem)_minmax(0,1fr)]",
      )}
    >
      {isConversationCollapsed ? null : (
        <Card
          aria-label="Conversation workflow"
          className="flex min-h-[40rem] flex-col overflow-hidden"
          role="region"
        >
          <CardHeader className="gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Conversation workflow</CardTitle>
                <CardDescription>
                  Control Bar, message history, Composer.
                </CardDescription>
              </div>
            </div>
            {controlBar ?? (
              <div className="flex items-center gap-2">
                <Button size="sm" type="button" variant="secondary">
                  Active Project
                </Button>
                <Button size="sm" type="button" variant="outline">
                  Project switcher
                </Button>
                <Button size="sm" type="button" variant="outline">
                  Conversation switcher
                </Button>
                <Button size="sm" type="button" variant="outline">
                  New Conversation
                </Button>
              </div>
            )}
          </CardHeader>

          <Separator />

          <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-0">
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

            <div className="border-t px-4 pb-4">
              {composer ?? (
                <PromptInput onSubmit={() => {}}>
                  <PromptInputBody>
                    <PromptInputTextarea placeholder="Describe next design move..." />
                  </PromptInputBody>
                  <PromptInputFooter>
                    <PromptInputTools />
                    <PromptInputSubmit />
                  </PromptInputFooter>
                </PromptInput>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card
        aria-label="Preview pane"
        className="flex min-h-[40rem] flex-col overflow-hidden"
        role="region"
      >
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <Button
            aria-label={
              isConversationCollapsed
                ? "Expand conversation pane"
                : "Collapse conversation pane"
            }
            onClick={() => writeConversationPaneState(!isConversationCollapsed)}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <span aria-hidden="true">{isConversationCollapsed ? "◨" : "◧"}</span>
          </Button>
          <div>
            <CardTitle>{previewTitle ?? "Preview pane"}</CardTitle>
            <CardDescription>
              {previewDescription ??
                "Preview Header and project-scoped output live here."}
            </CardDescription>
          </div>
        </CardHeader>

        <Separator />

        <CardContent className="min-h-0 flex-1 p-0">
          <ScrollArea className="h-full">
            {previewBody ?? (
              <div className="flex min-h-[32rem] flex-col gap-4 p-6">
                <div className="rounded-2xl border border-dashed bg-background p-6">
                  <p className="text-sm font-medium text-foreground">
                    Project preview placeholder
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Shared Project Output will render here once preview runtime lands.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border bg-card p-4">
                    <p className="text-sm font-medium text-foreground">
                      Preview Header
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Leftmost toggle owns conversation pane collapse state.
                    </p>
                  </div>
                  <div className="rounded-2xl border bg-card p-4">
                    <p className="text-sm font-medium text-foreground">
                      Project output
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      All Conversations in one Project share this surface.
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
