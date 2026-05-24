"use client";

import { GaugeIcon } from "lucide-react";
import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { LanguageModelUsage } from "ai";

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

type ContextValue = {
  maxTokens: number;
  usedTokens: number;
  usage?: Partial<LanguageModelUsage>;
};

const ContextState = createContext<ContextValue | null>(null);

export type ContextProps = ComponentProps<typeof HoverCard> & ContextValue;

export function Context({
  children,
  maxTokens,
  usedTokens,
  usage,
  ...props
}: ContextProps) {
  return (
    <ContextState.Provider value={{ maxTokens, usedTokens, usage }}>
      <HoverCard {...props}>{children}</HoverCard>
    </ContextState.Provider>
  );
}

export type ContextTriggerProps = ComponentProps<typeof Button> & {
  children?: ReactNode;
};

export function ContextTrigger({
  children,
  className,
  ...props
}: ContextTriggerProps) {
  const context = useContextValue();
  const percent = getUsagePercent(context.usedTokens, context.maxTokens);

  return (
    <HoverCardTrigger
      render={
        <Button
          aria-label={`上下文 ${percent}%`}
          className={cn(
            "h-7 rounded-[6px] bg-transparent px-2 text-xs text-[#a0a0ab] hover:bg-[#252528] hover:text-[#f0f0f2]",
            className,
          )}
          size="sm"
          type="button"
          variant="ghost"
          {...props}
        />
      }
    >
      {children ?? (
        <>
          <ContextProgressRing percent={percent} />
        </>
      )}
    </HoverCardTrigger>
  );
}

export type ContextContentProps = ComponentProps<typeof HoverCardContent>;

export function ContextContent({ className, ...props }: ContextContentProps) {
  return (
    <HoverCardContent
      align="end"
      className={cn(
        "w-64 rounded-[8px] border border-[#2a2a2e] bg-[#1c1c1f] p-0 text-[#f0f0f2] shadow-[0_8px_24px_rgba(0,0,0,0.5)]",
        className,
      )}
      side="top"
      sideOffset={8}
      {...props}
    />
  );
}

export type ContextContentHeaderProps = ComponentProps<"div">;

export function ContextContentHeader({
  children,
  className,
  ...props
}: ContextContentHeaderProps) {
  const { maxTokens, usedTokens } = useContextValue();
  const percent = getUsagePercent(usedTokens, maxTokens);

  return (
    <div className={cn("space-y-2 p-3", className)} {...props}>
      {children ?? (
        <>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-1.5 font-medium">
              <GaugeIcon className="size-3.5 text-[#6c5ce7]" />
              上下文
            </span>
            <span className="text-[#a0a0ab]">{percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#252528]">
            <div
              className="h-full rounded-full bg-[#6c5ce7] transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="text-[11px] text-[#6b6b76]">
            {formatTokens(usedTokens)} / {formatTokens(maxTokens)}
          </div>
        </>
      )}
    </div>
  );
}

export type ContextContentBodyProps = ComponentProps<"div">;

export function ContextContentBody({
  className,
  ...props
}: ContextContentBodyProps) {
  return <div className={cn("space-y-1 px-3 pb-3", className)} {...props} />;
}

export type ContextContentFooterProps = ComponentProps<"div">;

export function ContextContentFooter({
  children,
  className,
  ...props
}: ContextContentFooterProps) {
  return (
    <div
      className={cn(
        "border-t border-[#2a2a2e] bg-[#141416] px-3 py-2 text-[11px] text-[#6b6b76]",
        className,
      )}
      {...props}
    >
      {children ?? "统计来自最近一次模型响应。"}
    </div>
  );
}

export type ContextUsageProps = ComponentProps<"div"> & {
  children?: ReactNode;
};

export function ContextInputUsage(props: ContextUsageProps) {
  const { usage } = useContextValue();
  return (
    <ContextUsageRow
      label="输入"
      tokens={usage?.inputTokens}
      {...props}
    />
  );
}

export function ContextOutputUsage(props: ContextUsageProps) {
  const { usage } = useContextValue();
  return (
    <ContextUsageRow
      label="输出"
      tokens={usage?.outputTokens}
      {...props}
    />
  );
}

export function ContextReasoningUsage(props: ContextUsageProps) {
  const { usage } = useContextValue();
  return (
    <ContextUsageRow
      label="推理"
      tokens={
        usage?.outputTokenDetails?.reasoningTokens ?? usage?.reasoningTokens
      }
      {...props}
    />
  );
}

export function ContextCacheUsage(props: ContextUsageProps) {
  const { usage } = useContextValue();
  return (
    <ContextUsageRow
      label="缓存"
      tokens={usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cachedInputTokens}
      {...props}
    />
  );
}

function ContextUsageRow({
  children,
  className,
  label,
  tokens,
  ...props
}: ContextUsageProps & { label: string; tokens?: number }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-[6px] bg-[#0a0a0b] px-2.5 py-1.5 text-xs",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <span className="text-[#a0a0ab]">{label}</span>
          <span className="font-medium text-[#f0f0f2]">
            {formatTokens(tokens ?? 0)}
          </span>
        </>
      )}
    </div>
  );
}

function ContextProgressRing({ percent }: { percent: number }) {
  const radius = 5;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <svg aria-hidden className="size-3.5 -rotate-90" viewBox="0 0 14 14">
      <circle
        className="text-[#38383d]"
        cx="7"
        cy="7"
        fill="none"
        r={radius}
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle
        className="text-[#6c5ce7]"
        cx="7"
        cy="7"
        fill="none"
        r={radius}
        stroke="currentColor"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function useContextValue() {
  const value = useContext(ContextState);

  if (!value) {
    throw new Error("Context components must be used within Context.");
  }

  return value;
}

function getUsagePercent(usedTokens: number, maxTokens: number) {
  if (maxTokens <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((usedTokens / maxTokens) * 100));
}

function formatTokens(tokens: number) {
  return new Intl.NumberFormat("en", {
    compactDisplay: "short",
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(tokens);
}
