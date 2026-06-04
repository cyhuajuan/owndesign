'use client';

import { startTransition, useState } from 'react';

import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { useI18n } from '@/features/i18n/context';

type MessageComposerProps = {
  action: (formData: FormData) => Promise<void>;
  conversationId: string;
  projectId: string;
};

export function MessageComposer({ action, conversationId, projectId }: MessageComposerProps) {
  const { t } = useI18n();
  const [isPending, setIsPending] = useState(false);

  return (
    <PromptInput
      className="pt-4"
      maxFileSize={10 * 1024 * 1024}
      maxFiles={8}
      multiple
      onSubmit={({ text }) => {
        const trimmedText = text.trim();

        if (!trimmedText) {
          return;
        }

        const formData = new FormData();
        formData.set('projectId', projectId);
        formData.set('conversationId', conversationId);
        formData.set('content', trimmedText);

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
      <PromptInputHeader>
        <PromptInputAttachments />
      </PromptInputHeader>
      <PromptInputBody>
        <PromptInputTextarea
          disabled={isPending}
          placeholder={t('conversation.historyPlaceholder')}
        />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools>
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger aria-label={t('conversation.addAttachment')} />
            <PromptInputActionMenuContent side="top" sideOffset={6}>
              <PromptInputActionAddAttachments />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
        </PromptInputTools>
        <PromptInputSubmit disabled={isPending} />
      </PromptInputFooter>
    </PromptInput>
  );
}
