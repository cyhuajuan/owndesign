"use client";

import {
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolUIPart,
} from "ai";
import { useState } from "react";

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";

export function ToolPartView({
  part,
}: {
  part: ToolLikePart;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="w-full space-y-2">
      <Tool
        className="mb-0 w-full bg-background text-sm"
        onOpenChange={setIsOpen}
        open={isOpen}
      >
        {part.type === "dynamic-tool" ? (
          <ToolHeader
            state={part.state}
            toolName={part.toolName}
            type={part.type}
          />
        ) : (
          <ToolHeader state={part.state} type={part.type} />
        )}
        {isOpen ? (
          <ToolContent>
            <ToolInput input={part.input} />
            {part.output !== undefined || part.errorText ? (
              <ToolOutput errorText={part.errorText} output={part.output} />
            ) : null}
          </ToolContent>
        ) : null}
      </Tool>
    </div>
  );
}

export function isToolPart(part: unknown): part is ToolLikePart {
  return isToolUIPart(part as never);
}

export type ToolLikePart = ToolUIPart | DynamicToolUIPart;
