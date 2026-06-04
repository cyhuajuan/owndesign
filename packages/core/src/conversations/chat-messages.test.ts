import { describe, expect, it } from 'vitest';

import { getFirstUserMessageText, normalizeConversationMessages } from './chat-messages';

describe('chat message normalization', () => {
  it('converts legacy role/content messages into UIMessage parts', () => {
    const messages = normalizeConversationMessages([
      {
        content: '**Hello**',
        role: 'user',
      },
      {
        content: 'Hi there',
        role: 'assistant',
      },
    ]);

    expect(messages).toEqual([
      {
        id: 'legacy-message-0',
        parts: [{ state: 'done', text: '**Hello**', type: 'text' }],
        role: 'user',
      },
      {
        id: 'legacy-message-1',
        parts: [{ state: 'done', text: 'Hi there', type: 'text' }],
        role: 'assistant',
      },
    ]);
    expect(getFirstUserMessageText(messages)).toBe('**Hello**');
  });

  it('keeps existing UIMessage records unchanged', () => {
    const existingMessage = {
      id: 'message-1',
      parts: [{ text: 'Hello', type: 'text' as const }],
      role: 'assistant' as const,
    };

    expect(normalizeConversationMessages([existingMessage])).toEqual([existingMessage]);
  });
});
