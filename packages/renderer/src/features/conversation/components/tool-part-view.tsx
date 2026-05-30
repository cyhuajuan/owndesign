"use client";

import {
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolUIPart,
} from "ai";

import { Shimmer } from "@/components/ai-elements/shimmer";

export function ToolPartView({ part }: { part: ToolLikePart }) {
  const description = getToolDescription(part);

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

function getToolDescription(part: ToolLikePart) {
  const toolName = getToolName(part);
  const target = getToolTarget(part);
  const verb = toolVerbs[toolName] ?? toolName;
  const suffix = target ?? (toolName === "callFrontendCapability" ? "" : "文件");

  if (isFailedToolPart(part)) {
    return `${verb}${suffix}失败`;
  }

  if (part.state === "output-denied") {
    return `已取消${verb}${suffix}`;
  }

  if (part.state === "output-available") {
    return `已${verb}${suffix}`;
  }

  return `正在${verb}${suffix}`;
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

  const path = "path" in value ? value.path : undefined;

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

const toolVerbs: Record<string, string> = {
  callFrontendCapability: "更新预览",
  createHtml: "创建",
  delete: "删除",
  edit: "编辑",
  glob: "查找",
  grep: "搜索",
  patch: "修改",
  read: "查看",
  write: "写入",
};
