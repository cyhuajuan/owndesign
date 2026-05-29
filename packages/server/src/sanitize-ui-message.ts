import type { UIMessage, UIMessageChunk } from "ai";
import type { ConversationRecord } from "@owndesign/core/workspace-store";

export function sanitizePublicConversation(
  conversation: ConversationRecord,
): ConversationRecord {
  return {
    ...conversation,
    messages: Array.isArray(conversation.messages)
      ? conversation.messages.map((message) =>
          sanitizePublicUIMessage(message as UIMessage),
        )
      : conversation.messages,
  };
}

export function sanitizePublicUIMessage(message: UIMessage): UIMessage {
  if (!Array.isArray(message.parts)) {
    return message;
  }

  return {
    ...message,
    parts: message.parts.flatMap((part) => {
      if (part.type === "reasoning") {
        return [];
      }

      if (isToolLikePart(part)) {
        return [sanitizeToolLikePart(part) as UIMessage["parts"][number]];
      }

      return [part];
    }),
  };
}

export function sanitizePublicUIMessageChunk(
  chunk: UIMessageChunk,
): UIMessageChunk | undefined {
  if (chunk.type.startsWith("reasoning-")) {
    return undefined;
  }

  switch (chunk.type) {
    case "tool-input-delta":
      return undefined;
    case "tool-input-available":
    case "tool-input-error":
    case "tool-output-available":
    case "tool-output-error":
    case "tool-output-denied":
      return sanitizeToolChunk(chunk) as UIMessageChunk;
    default:
      return chunk;
  }
}

function sanitizeToolLikePart(part: Record<string, unknown>) {
  const sanitized: Record<string, unknown> = {
    state: part.state,
    toolCallId: part.toolCallId,
    type: part.type,
  };

  if (typeof part.toolName === "string") {
    sanitized.toolName = part.toolName;
  }

  const inputPath = getPathFromValue(part.input);
  const outputPath = getPathFromValue(part.output);

  if (inputPath) {
    sanitized.input = { path: inputPath };
  }

  if (outputPath) {
    sanitized.output = { path: outputPath };
  }

  return sanitized;
}

function sanitizeToolChunk(chunk: Record<string, unknown>) {
  const sanitized: Record<string, unknown> = {
    toolCallId: chunk.toolCallId,
    type: chunk.type,
  };

  if (typeof chunk.toolName === "string") {
    sanitized.toolName = chunk.toolName;
  }

  const inputPath = getPathFromValue(chunk.input);
  const outputPath = getPathFromValue(chunk.output);

  if (chunk.type === "tool-input-available" || chunk.type === "tool-input-error") {
    sanitized.input = inputPath ? { path: inputPath } : {};
  }

  if (chunk.type === "tool-input-error") {
    sanitized.errorText = "工具输入失败";
  }

  if (chunk.type === "tool-output-available") {
    sanitized.output = outputPath ? { path: outputPath } : {};
  }

  if (chunk.type === "tool-output-error") {
    sanitized.errorText = "工具执行失败";
  }

  return sanitized;
}

function isToolLikePart(part: unknown): part is Record<string, unknown> {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    typeof part.type === "string" &&
    (part.type === "dynamic-tool" || part.type.startsWith("tool-"))
  );
}

function getPathFromValue(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const path = "path" in value ? value.path : undefined;

  return typeof path === "string" && path.length > 0 ? path : undefined;
}
