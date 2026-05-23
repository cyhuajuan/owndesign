"use client";

import { useState, type ReactNode } from "react";
import { CheckIcon, ImageIcon, PlusIcon, TypeIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { normalizeResourceDefaults } from "@/features/settings/resource-utils";
import type { ResourceLibrary, ResourceSettings } from "@/features/settings/types";

export function ResourceSettingsSection({
  resources,
  onChange,
}: {
  resources: ResourceSettings;
  onChange: (resources: ResourceSettings) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-base font-semibold">资源管理</div>
      <div className="mb-6 max-w-[560px] text-[13px] leading-normal text-[#6b6b76]">
        管理设计页面可使用的字体库和图标库。
      </div>

      <ResourceGroup
        addLabel="添加字体库"
        emptyIcon={<TypeIcon />}
        emptyText="暂无字体库，点击上方&quot;添加字体库&quot;按钮添加。"
        icon={<TypeIcon />}
        libraries={resources.fontLibraries}
        onChange={(fontLibraries) => onChange({ ...resources, fontLibraries })}
        title="字体库"
      />
      <div className="my-7 h-px bg-[#2a2a2e]" />
      <ResourceGroup
        addLabel="添加图标库"
        emptyIcon={<ImageIcon />}
        emptyText="暂无图标库，点击上方&quot;添加图标库&quot;按钮添加。"
        icon={<ImageIcon />}
        libraries={resources.iconLibraries}
        onChange={(iconLibraries) => onChange({ ...resources, iconLibraries })}
        title="图标库"
      />
    </div>
  );
}

function ResourceGroup({
  addLabel,
  emptyIcon,
  emptyText,
  icon,
  libraries,
  onChange,
  title,
}: {
  addLabel: string;
  emptyIcon: ReactNode;
  emptyText: string;
  icon: ReactNode;
  libraries: ResourceLibrary[];
  onChange: (libraries: ResourceLibrary[]) => void;
  title: string;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftCdn, setDraftCdn] = useState("");

  const addLibrary = () => {
    const name = draftName.trim();

    if (!name) {
      return;
    }

    onChange(
      normalizeResourceDefaults([
        ...libraries,
        {
          id: crypto.randomUUID(),
          name,
          cdn: draftCdn.trim(),
          isDefault: libraries.length === 0,
        },
      ]),
    );
    setDraftName("");
    setDraftCdn("");
    setIsAdding(false);
  };

  return (
    <div className="mb-8 last:mb-0">
      <div className="mb-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#f0f0f2] [&_svg]:size-[15px] [&_svg]:text-[#6c5ce7]">
          {icon}
          {title}
          <span className="rounded-full bg-[#252528] px-2.5 py-px text-[11px] font-medium text-[#6b6b76]">
            {libraries.length}
          </span>
        </div>
        <button
          className="flex items-center gap-1 rounded-[6px] bg-[rgba(108,92,231,0.15)] px-3 py-1.5 text-xs font-medium text-[#6c5ce7] transition-colors duration-150 hover:bg-[rgba(108,92,231,0.25)] [&_svg]:size-[13px]"
          onClick={() => setIsAdding((current) => !current)}
          type="button"
        >
          <PlusIcon />
          {addLabel}
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {libraries.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-[#2a2a2e] px-4 py-8 text-center text-[13px] text-[#6b6b76] [&_svg]:mx-auto [&_svg]:mb-2 [&_svg]:size-6 [&_svg]:opacity-35">
            {emptyIcon}
            <div>{emptyText.replaceAll("&quot;", '"')}</div>
          </div>
        ) : (
          libraries.map((library) => (
            <ResourceCard
              key={library.id}
              library={library}
              onChange={(nextLibrary) =>
                onChange(
                  libraries.map((current) =>
                    current.id === library.id ? nextLibrary : current,
                  ),
                )
              }
              onRemove={() =>
                onChange(
                  normalizeResourceDefaults(
                    libraries.filter((current) => current.id !== library.id),
                  ),
                )
              }
              onSetDefault={() =>
                onChange(
                  libraries.map((current) => ({
                    ...current,
                    isDefault: current.id === library.id,
                  })),
                )
              }
            />
          ))
        )}
      </div>
      {isAdding ? (
        <div className="flex items-center gap-2 px-0 pt-2.5 pb-1">
          <input
            className="min-w-0 flex-1 rounded-[6px] border border-[#2a2a2e] bg-[#1c1c1f] px-2.5 py-1.5 text-xs text-[#f0f0f2] outline-none transition-colors duration-150 placeholder:text-[#6b6b76] focus:border-[#6c5ce7]"
            onChange={(event) => setDraftName(event.target.value)}
            placeholder={title === "字体库" ? "字体库名称" : "图标库名称"}
            type="text"
            value={draftName}
          />
          <input
            className="min-w-0 flex-[1.5] rounded-[6px] border border-[#2a2a2e] bg-[#1c1c1f] px-2.5 py-1.5 text-xs text-[#f0f0f2] outline-none transition-colors duration-150 placeholder:text-[#6b6b76] focus:border-[#6c5ce7]"
            onChange={(event) => setDraftCdn(event.target.value)}
            placeholder="CDN URL (https://...)"
            type="text"
            value={draftCdn}
          />
          <button
            className="flex size-7 items-center justify-center rounded-[6px] bg-[#6c5ce7] text-white transition-colors duration-150 hover:bg-[#7d6ff0] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-3.5"
            disabled={!draftName.trim()}
            onClick={addLibrary}
            title="确认添加"
            type="button"
          >
            <CheckIcon />
          </button>
          <button
            className="flex size-7 items-center justify-center rounded-[6px] bg-[#252528] text-[#6b6b76] transition-colors duration-150 hover:bg-[#2e2e32] hover:text-[#a0a0ab] [&_svg]:size-3.5"
            onClick={() => {
              setDraftName("");
              setDraftCdn("");
              setIsAdding(false);
            }}
            title="取消"
            type="button"
          >
            <XIcon />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ResourceCard({
  library,
  onChange,
  onRemove,
  onSetDefault,
}: {
  library: ResourceLibrary;
  onChange: (library: ResourceLibrary) => void;
  onRemove: () => void;
  onSetDefault: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-[8px] border border-[#2a2a2e] bg-[#0a0a0b] px-3.5 py-3 transition-[border-color,box-shadow] duration-150 hover:border-[#38383d]",
        library.isDefault && "border-[#6c5ce7] shadow-[0_0_0_1px_rgba(108,92,231,0.15)]",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#f0f0f2]">
          {library.name}
        </span>
        {library.isDefault ? (
          <span className="shrink-0 rounded-full bg-[rgba(108,92,231,0.15)] px-2 py-0.5 text-[10px] font-semibold tracking-[0.3px] text-[#6c5ce7]">
            默认
          </span>
        ) : (
          <button
            className="shrink-0 rounded-[6px] border border-[#2a2a2e] bg-[#1c1c1f] px-2 py-0.5 text-[11px] text-[#6b6b76] transition-all duration-150 hover:border-[#6c5ce7] hover:bg-[rgba(108,92,231,0.15)] hover:text-[#6c5ce7]"
            onClick={onSetDefault}
            type="button"
          >
            设为默认
          </button>
        )}
        <button
          className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-[#6b6b76] transition-all duration-150 hover:bg-[rgba(231,76,60,0.1)] hover:text-[#e74c3c] [&_svg]:size-3.5"
          onClick={onRemove}
          title="移除"
          type="button"
        >
          <XIcon />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="w-9 shrink-0 text-[11px] font-medium text-[#6b6b76]">
          CDN
        </span>
        <input
          className={resourceCdnInputClass}
          onChange={(event) => onChange({ ...library, cdn: event.target.value })}
          placeholder="https://..."
          spellCheck={false}
          type="text"
          value={library.cdn}
        />
        {library.cdn ? (
          <CheckIcon className="size-3 shrink-0 text-[#2ecc71]" />
        ) : null}
      </div>
    </div>
  );
}



const resourceCdnInputClass =
  "min-w-0 flex-1 rounded-[6px] border border-[#2a2a2e] bg-[#1c1c1f] px-2 py-1.5 font-mono text-xs text-[#a0a0ab] outline-none transition-colors duration-150 placeholder:text-[#6b6b76] focus:border-[#6c5ce7]";
