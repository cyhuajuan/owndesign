"use client";

import { useEffect } from "react";

import {
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import type { PublicModelConfiguration } from "@/features/conversation/types";

export function PromptAttachmentControls({
  selectedModel,
}: {
  selectedModel?: PublicModelConfiguration;
}) {
  const attachments = usePromptInputAttachments();
  const hideAttachments = !selectedModel || selectedModel.provider === "deepseek";

  useEffect(() => {
    if (hideAttachments && attachments.files.length > 0) {
      attachments.clear();
    }
  }, [attachments, hideAttachments]);

  if (hideAttachments) {
    return <PromptInputTools />;
  }

  return (
    <PromptInputTools>
      <PromptInputActionMenu>
        <PromptInputActionMenuTrigger aria-label="添加附件" />
        <PromptInputActionMenuContent side="top" sideOffset={6}>
          <PromptInputActionAddAttachments />
        </PromptInputActionMenuContent>
      </PromptInputActionMenu>
    </PromptInputTools>
  );
}
