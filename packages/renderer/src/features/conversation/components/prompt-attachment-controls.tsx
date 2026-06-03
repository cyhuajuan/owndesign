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
import { useI18n } from "@/features/i18n/context";
import type { PublicModelConfiguration } from "@/features/conversation/types";

export function PromptAttachmentControls({
  selectedModel,
}: {
  selectedModel?: PublicModelConfiguration;
}) {
  const { t } = useI18n();
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
        <PromptInputActionMenuTrigger aria-label={t("conversation.addAttachment")} />
        <PromptInputActionMenuContent side="top" sideOffset={6}>
          <PromptInputActionAddAttachments />
        </PromptInputActionMenuContent>
      </PromptInputActionMenu>
    </PromptInputTools>
  );
}
