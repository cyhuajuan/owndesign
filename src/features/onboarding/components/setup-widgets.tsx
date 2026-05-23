"use client";

import type { ReactNode } from "react";
import { CheckIcon } from "lucide-react";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const CHECK_ICON = (
  <CheckIcon aria-hidden="true" className="hidden group-[.selected]:block" />
);

export function StepItem({
  active,
  children,
  done,
  number,
}: {
  active: boolean;
  children: string;
  done: boolean;
  number: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 select-none items-center gap-2 text-xs font-medium text-[#6b6b76]",
        active && "text-[#fafafa]",
        done && "text-[#2ecc71]",
      )}
    >
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full bg-[#252528] text-[11px] font-semibold text-[#6b6b76] transition-all duration-300",
          active && "bg-[#6c5ce7] text-white shadow-[0_0_12px_rgba(108,92,231,0.08)]",
          done && "bg-[#2ecc71] text-white",
        )}
      >
        {number}
      </span>
      {children}
    </div>
  );
}

export function StepLine({ done }: { done: boolean }) {
  return (
    <Separator
      className={cn(
        "mx-3 h-px min-w-6 flex-1 bg-[#27272a] transition-colors duration-300",
        done && "bg-[#2ecc71]",
      )}
    />
  );
}

export function PanelTitle({ children }: { children: string }) {
  return <div className="mb-1 text-[17px] font-semibold">{children}</div>;
}

export function PanelDescription({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 text-[13px] leading-relaxed text-[#6b6b76]">
      {children}
    </div>
  );
}

export function LanguageCard({
  icon,
  name,
  nativeName,
  selected,
  onClick,
}: {
  icon: string;
  name: string;
  nativeName: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "group flex flex-col items-center gap-2.5 rounded-[10px] border border-[#27272a] bg-[#1c1c20] px-4 py-5 text-center transition-all duration-200 hover:border-[#3f3f46] hover:bg-[#252528]",
        selected &&
          "selected border-[#6c5ce7] bg-[rgba(108,92,231,0.14)] shadow-[0_0_0_1px_#6c5ce7]",
      )}
      onClick={onClick}
      type="button"
    >
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full border border-[#27272a] bg-[#18181b] text-lg font-bold transition-all duration-200",
          selected && "border-[#6c5ce7] bg-[#6c5ce7] text-white",
        )}
      >
        {icon}
      </div>
      <div>
        <div className="text-sm font-semibold text-[#fafafa]">{name}</div>
        <div className="text-[13px] text-[#6b6b76]">{nativeName}</div>
      </div>
      <div
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-[#27272a] transition-all duration-200 [&_svg]:size-3",
          selected && "border-[#6c5ce7] bg-[#6c5ce7] text-white",
        )}
      >
        {CHECK_ICON}
      </div>
    </button>
  );
}


export function SummaryCard({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="rounded-[10px] border border-[#27272a] bg-[#1c1c20] px-4 py-3.5">
      <div className="mb-1.5 text-[11px] font-semibold tracking-[0.4px] text-[#6b6b76] uppercase">
        {label}
      </div>
      {children}
    </div>
  );
}

export function GlobeIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4 text-[#6c5ce7]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" x2="22" y1="12" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
