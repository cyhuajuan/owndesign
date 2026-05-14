import type { UIMessage } from "ai";

export type HJDesignUIMessage = UIMessage;

type LegacyMessage = {
  content: string;
  role: "assistant" | "user";
};

export function normalizeConversationMessages(
  messages: unknown[],
): HJDesignUIMessage[] {
  return messages
    .map((message, index) => normalizeConversationMessage(message, index))
    .filter((message): message is HJDesignUIMessage => Boolean(message));
}

export function getUIMessageText(message: HJDesignUIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function getFirstUserMessageText(messages: HJDesignUIMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user");

  return firstUserMessage ? getUIMessageText(firstUserMessage) : "";
}

function normalizeConversationMessage(
  message: unknown,
  index: number,
): HJDesignUIMessage | undefined {
  if (isUIMessage(message)) {
    return message;
  }

  if (isLegacyMessage(message)) {
    return {
      id: `legacy-message-${index}`,
      role: message.role,
      parts: [
        {
          type: "text",
          text: message.content,
          state: "done",
        },
      ],
    };
  }

  if (message === undefined || message === null) {
    return undefined;
  }

  return {
    id: `legacy-unknown-${index}`,
    role: "assistant",
    parts: [
      {
        type: "text",
        text: JSON.stringify(message),
        state: "done",
      },
    ],
  };
}

function isUIMessage(message: unknown): message is HJDesignUIMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "id" in message &&
    typeof message.id === "string" &&
    "role" in message &&
    (message.role === "assistant" ||
      message.role === "user" ||
      message.role === "system") &&
    "parts" in message &&
    Array.isArray(message.parts)
  );
}

function isLegacyMessage(message: unknown): message is LegacyMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "content" in message &&
    typeof message.content === "string" &&
    "role" in message &&
    (message.role === "assistant" || message.role === "user")
  );
}
