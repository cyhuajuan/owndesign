"use client";

import { startTransition, useState } from "react";

import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";

type MessageComposerProps = {
  action: (formData: FormData) => Promise<void>;
  conversationId: string;
  projectId: string;
};

export function MessageComposer({
  action,
  conversationId,
  projectId,
}: MessageComposerProps) {
  const [isPending, setIsPending] = useState(false);

  return (
    <PromptInput
      className="pt-4"
      onSubmit={({ text }) => {
        const trimmedText = text.trim();

        if (!trimmedText) {
          return;
        }

        const formData = new FormData();
        formData.set("projectId", projectId);
        formData.set("conversationId", conversationId);
        formData.set("content", trimmedText);

        setIsPending(true);
        startTransition(async () => {
          try {
            await action(formData);
          } finally {
            setIsPending(false);
          }
        });
      }}
    >
      <PromptInputBody>
        <PromptInputTextarea
          disabled={isPending}
          placeholder="描述你希望这段会话探索的内容..."
        />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools />
        <PromptInputSubmit disabled={isPending} />
      </PromptInputFooter>
    </PromptInput>
  );
}
