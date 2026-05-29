"use client";

import {
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolUIPart,
} from "ai";

export function ToolPartView({ part }: { part: ToolLikePart }) {
  return (
    <div className="w-full rounded-md border border-border bg-background px-3 py-2 text-muted-foreground text-sm">
      {getToolDescription(part)}
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
  const suffix = target ? target : "文件";

  if (part.state === "output-available") {
    return `已${verb}${suffix}`;
  }

  if (part.state === "output-error") {
    return `${verb}${suffix}失败`;
  }

  if (part.state === "output-denied") {
    return `已取消${verb}${suffix}`;
  }

  return `正在${verb}${suffix}`;
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

  return typeof path === "string" && path.length > 0 ? path : undefined;
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
