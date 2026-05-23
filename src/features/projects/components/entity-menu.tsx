"use client";

import { PencilIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";

export function EntityMenu({
  onDelete,
  onRename,
}: {
  onDelete: () => void;
  onRename: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/item:opacity-100">
      <Button
        aria-label="重命名"
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
        aria-label="删除"
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
