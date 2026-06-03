import type { UIMessage } from "ai";

import { getFirstUserMessageText } from "@owndesign/core/conversations/chat-messages";
import { FALLBACK_CONVERSATION_TITLE } from "@owndesign/core/conversations/default-title";

export function deriveConversationTitle({
  conversationTitle,
  initialMessages,
  messages,
  titleManuallySet,
}: {
  conversationTitle: string;
  initialMessages: UIMessage[];
  messages: UIMessage[];
  titleManuallySet: boolean;
}) {
  if (
    titleManuallySet ||
    conversationTitle !== FALLBACK_CONVERSATION_TITLE ||
    initialMessages.length > 0
  ) {
    return conversationTitle;
  }

  const firstUserMessageText = getFirstUserMessageText(messages);

  return firstUserMessageText
    ? firstUserMessageText.trim().replace(/\s+/g, " ").slice(0, 80)
    : conversationTitle;
}
