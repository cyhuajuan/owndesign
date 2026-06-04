import { describe, expect, it } from 'vitest';

import {
  FALLBACK_CONVERSATION_TITLE,
  getDefaultConversationTitle,
  normalizeDefaultConversationTitle,
} from './default-title';

describe('default conversation title', () => {
  it('falls back when the configured language title is empty', () => {
    expect(getDefaultConversationTitle('en-US')).toBe(FALLBACK_CONVERSATION_TITLE);
    expect(normalizeDefaultConversationTitle('')).toBe(FALLBACK_CONVERSATION_TITLE);
  });
});
