'use client';

import { PencilIcon, Trash2Icon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/features/i18n/context';

export function EntityMenu({ onDelete, onRename }: { onDelete: () => void; onRename: () => void }) {
  const { t } = useI18n();

  return (
    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/item:opacity-100">
      <Button
        aria-label={t('projects.rename')}
        onClick={(event) => {
          event.stopPropagation();
          onRename();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <PencilIcon />
      </Button>
      <Button
        aria-label={t('common.delete')}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}
