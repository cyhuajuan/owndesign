import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type PreviewEmptyStateProps = {
  badge?: string;
  className?: string;
  description: string;
  icon?: ReactNode;
  title: string;
};

export function PreviewEmptyState({
  badge,
  className,
  description,
  icon,
  title,
}: PreviewEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex size-full items-center justify-center bg-[#0a0a0b] px-6 py-10 text-[#f0f0f2]',
        className,
      )}
    >
      <div className="w-full max-w-md rounded-2xl border border-[#2a2a2e] bg-[#141416] p-8 text-center shadow-[0_18px_48px_rgba(0,0,0,0.45)]">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-[#38383d] bg-[#1c1c1f] text-[#a0a0ab] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] [&_svg]:size-6">
          {icon}
        </div>
        <div className="mt-5 space-y-2">
          {badge ? (
            <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#6b6b76]">
              {badge}
            </div>
          ) : null}
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-[#f0f0f2]">{title}</h2>
          <p className="mx-auto max-w-sm text-sm leading-6 text-[#a0a0ab]">{description}</p>
        </div>
      </div>
    </div>
  );
}
