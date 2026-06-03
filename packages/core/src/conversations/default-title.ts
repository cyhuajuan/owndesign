import type { InterfaceLanguage } from "@owndesign/core/settings/settings-service";

export const FALLBACK_CONVERSATION_TITLE = "新建会话";

const DEFAULT_CONVERSATION_TITLES: Record<InterfaceLanguage, string> = {
  "en-US": "",
  "zh-CN": FALLBACK_CONVERSATION_TITLE,
};

export function getDefaultConversationTitle(language: InterfaceLanguage) {
  return DEFAULT_CONVERSATION_TITLES[language] || FALLBACK_CONVERSATION_TITLE;
}

export function normalizeDefaultConversationTitle(title?: string) {
  const trimmedTitle = title?.trim();

  return trimmedTitle || FALLBACK_CONVERSATION_TITLE;
}
