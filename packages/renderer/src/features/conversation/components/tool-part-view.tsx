"use client";

import {
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolUIPart,
} from "ai";

import { Shimmer } from "@/components/ai-elements/shimmer";
import { useI18n } from "@/features/i18n/context";

export function ToolPartView({ part }: { part: ToolLikePart }) {
  const { t } = useI18n();
  const description = getToolDescription(part, t);

  return (
    <div className="w-full text-muted-foreground text-sm">
      {isPendingToolPart(part) ? (
        <Shimmer as="span">{description}</Shimmer>
      ) : (
        description
      )}
    </div>
  );
}

export function isToolPart(part: unknown): part is ToolLikePart {
  return isToolUIPart(part as never);
}

export type ToolLikePart = ToolUIPart | DynamicToolUIPart;

function getToolDescription(
  part: ToolLikePart,
  t: ReturnType<typeof useI18n>["t"],
) {
  const toolName = getToolName(part);
  const target = getToolTarget(part);
  const verb = getToolVerb(toolName, t);
  const suffix = target ?? (isPreviewTool(toolName) ? "" : t("conversation.file"));

  if (isFailedToolPart(part)) {
    return t("tool.failed", { suffix, verb });
  }

  if (part.state === "output-denied") {
    return t("tool.cancelled", { suffix, verb });
  }

  if (part.state === "output-available") {
    return t("tool.completed", { suffix, verb });
  }

  return t("tool.running", { suffix, verb });
}

function isPendingToolPart(part: ToolLikePart) {
  return (
    part.state !== "output-available" &&
    part.state !== "output-error" &&
    part.state !== "output-denied"
  );
}

function isFailedToolPart(part: ToolLikePart) {
  return part.state === "output-error" || getToolOutputOk(part) === false;
}

function getToolName(part: ToolLikePart) {
  return part.type === "dynamic-tool"
    ? part.toolName
    : part.type.split("-").slice(1).join("-");
}

function getToolTarget(part: ToolLikePart) {
  return (
    getPathFromValue(part.output) ??
    getPathFromValue(part.input) ??
    getPathFromValue(part)
  );
}

function getPathFromValue(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const path = "path" in value
    ? value.path
    : "targetPath" in value
      ? value.targetPath
      : undefined;

  if (typeof path === "string" && path.length > 0) {
    return path;
  }

  const nestedOutput = "output" in value ? value.output : undefined;

  if (nestedOutput && typeof nestedOutput === "object") {
    return getPathFromValue(nestedOutput);
  }

  return undefined;
}

function getToolOutputOk(part: ToolLikePart) {
  const output = part.output;

  if (!output || typeof output !== "object" || !("ok" in output)) {
    return undefined;
  }

  return typeof output.ok === "boolean" ? output.ok : undefined;
}

function isPreviewTool(toolName: string) {
  return toolName === "previewRefresh" || toolName === "previewSwitchHtml";
}

function getToolVerb(toolName: string, t: ReturnType<typeof useI18n>["t"]) {
  const toolVerbKeys: Record<string, Parameters<typeof t>[0]> = {
    copyFile: "tool.copyFile",
    createHtml: "tool.createHtml",
    delete: "tool.delete",
    edit: "tool.edit",
    glob: "tool.glob",
    grep: "tool.grep",
    patch: "tool.patch",
    previewRefresh: "tool.previewRefresh",
    previewSwitchHtml: "tool.previewSwitchHtml",
    read: "tool.read",
    write: "tool.write",
  };
  const key = toolVerbKeys[toolName];

  return key ? t(key) : toolName;
}
