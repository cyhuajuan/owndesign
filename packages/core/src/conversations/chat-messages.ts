import type { UIMessage } from 'ai';

export type OwnDesignUIMessage = UIMessage;

export type TurnPromptRewriteMetadata = {
  originalUserPrompt: string;
  promptRewrite: {
    duplicateSourcePath?: string;
    duplicateTargetPath?: string;
    createdAt: string;
    kind: 'turn-prompt-rewriter';
    pageEditMode?: string;
    previewFileExists: boolean;
    previewPath?: string;
  };
};

type LegacyMessage = {
  content: string;
  role: 'assistant' | 'user';
};

export function normalizeConversationMessages(messages: unknown[]): OwnDesignUIMessage[] {
  return messages
    .map((message, index) => normalizeConversationMessage(message, index))
    .filter((message): message is OwnDesignUIMessage => Boolean(message));
}

export function getUIMessageText(message: OwnDesignUIMessage) {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

export function getFirstUserMessageText(messages: OwnDesignUIMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === 'user');

  return firstUserMessage ? getUserVisibleMessageText(firstUserMessage) : '';
}

export function getUserVisibleMessageText(message: OwnDesignUIMessage) {
  return getOriginalUserPrompt(message) ?? getUIMessageText(message);
}

export function getOriginalUserPrompt(message: OwnDesignUIMessage) {
  const metadata = message.metadata;

  if (
    typeof metadata === 'object' &&
    metadata !== null &&
    'originalUserPrompt' in metadata &&
    typeof metadata.originalUserPrompt === 'string'
  ) {
    return metadata.originalUserPrompt;
  }

  return undefined;
}

function normalizeConversationMessage(
  message: unknown,
  index: number,
): OwnDesignUIMessage | undefined {
  if (isUIMessage(message)) {
    return message;
  }

  if (isLegacyMessage(message)) {
    return {
      id: `legacy-message-${index}`,
      role: message.role,
      parts: [
        {
          type: 'text',
          text: message.content,
          state: 'done',
        },
      ],
    };
  }

  if (message === undefined || message === null) {
    return undefined;
  }

  return {
    id: `legacy-unknown-${index}`,
    role: 'assistant',
    parts: [
      {
        type: 'text',
        text: JSON.stringify(message),
        state: 'done',
      },
    ],
  };
}

function isUIMessage(message: unknown): message is OwnDesignUIMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'id' in message &&
    typeof message.id === 'string' &&
    'role' in message &&
    (message.role === 'assistant' || message.role === 'user' || message.role === 'system') &&
    'parts' in message &&
    Array.isArray(message.parts)
  );
}

function isLegacyMessage(message: unknown): message is LegacyMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'content' in message &&
    typeof message.content === 'string' &&
    'role' in message &&
    (message.role === 'assistant' || message.role === 'user')
  );
}
