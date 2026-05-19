"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  CpuIcon,
  ImageIcon,
  PlusIcon,
  SettingsIcon,
  SlidersIcon,
  TypeIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

export const SETTINGS_UPDATED_EVENT = "hjdesign:settings-updated";

type InterfaceLanguage = "zh-CN" | "en-US";
type ModelProvider = "" | "deepseek" | "openai-compatible";
type DeepSeekThinkingMode = "disabled" | "high" | "max";
type ModelProviderOptions = {
  deepseek?: {
    thinkingMode: DeepSeekThinkingMode;
  };
};

type ResourceLibrary = {
  id: string;
  name: string;
  cdn: string;
  isDefault: boolean;
};

type ResourceSettings = {
  fontLibraries: ResourceLibrary[];
  iconLibraries: ResourceLibrary[];
};

type ModelConfigurationForm = {
  id: string;
  provider: ModelProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
  contextSizeK: string;
  providerOptions?: ModelProviderOptions;
  collapsed: boolean;
};

type PublicSettings = {
  defaultModelId: string | null;
  interfaceLanguage: InterfaceLanguage;
  modelConfigurations: Array<{
    id: string;
    provider: "deepseek" | "openai-compatible";
    model: string;
    baseUrl: string;
    contextSizeK: number;
    apiKey: "";
    hasApiKey: boolean;
    providerOptions?: ModelProviderOptions;
  }>;
  resources: ResourceSettings;
};

const DEFAULT_RESOURCES: ResourceSettings = {
  fontLibraries: [
    {
      id: "font-1",
      name: "Google Fonts",
      cdn: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Noto+Sans+SC:wght@100..900&display=swap",
      isDefault: true,
    },
  ],
  iconLibraries: [
    {
      id: "icon-1",
      name: "Lucide Icons",
      cdn: "https://unpkg.com/lucide@latest/dist/umd/lucide.js",
      isDefault: true,
    },
  ],
};

export function SettingsControl() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[6px] text-[#6b6b76] transition-all duration-200 hover:bg-[#252528] hover:text-[#f0f0f2] [&_svg]:size-4 [&_svg]:transition-transform [&_svg]:duration-[400ms] hover:[&_svg]:rotate-[60deg]"
        onClick={() => setIsOpen(true)}
        title="设置"
        type="button"
      >
        <SettingsIcon />
      </button>
      {isOpen ? <SettingsPanel onClose={() => setIsOpen(false)} /> : null}
    </>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [activeSection, setActiveSection] = useState<
    "general" | "resources" | "ai"
  >("general");
  const [interfaceLanguage, setInterfaceLanguage] =
    useState<InterfaceLanguage>("zh-CN");
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);
  const [modelConfigurations, setModelConfigurations] = useState<
    ModelConfigurationForm[]
  >([]);
  const [resources, setResources] =
    useState<ResourceSettings>(DEFAULT_RESOURCES);

  useEffect(() => {
    let isMounted = true;

    void fetch("/api/settings")
      .then((response) => response.json() as Promise<PublicSettings>)
      .then((settings) => {
        if (!isMounted) {
          return;
        }

        setInterfaceLanguage(settings.interfaceLanguage);
        setDefaultModelId(settings.defaultModelId);
        setResources(settings.resources ?? DEFAULT_RESOURCES);
        setModelConfigurations(
          settings.modelConfigurations.map((configuration) => ({
            id: configuration.id,
            provider: configuration.provider,
            model: configuration.model,
            baseUrl: configuration.baseUrl,
            contextSizeK: String(configuration.contextSizeK),
            apiKey: "",
            providerOptions: configuration.providerOptions,
            collapsed: true,
          })),
        );
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[1000] flex animate-in fade-in-0 items-center justify-center bg-black/60 duration-150">
      <div className="flex h-[80vh] max-h-[620px] w-full max-w-[820px] animate-in flex-row overflow-hidden rounded-[12px] border border-[#2a2a2e] bg-[#1c1c1f] p-0 text-[#f0f0f2] shadow-[0_8px_24px_rgba(0,0,0,0.5)] duration-150 zoom-in-95 slide-in-from-bottom-2">
        <div className="flex w-[200px] min-w-[200px] shrink-0 flex-col overflow-y-auto border-r border-[#2a2a2e] bg-[#141416] py-5">
          <button
            className={navItemClass(activeSection === "general")}
            data-section="general"
            onClick={() => setActiveSection("general")}
            type="button"
          >
            <SlidersIcon className="size-4 shrink-0" />
            通用设置
          </button>
          <button
            className={navItemClass(activeSection === "resources")}
            data-section="resources"
            onClick={() => setActiveSection("resources")}
            type="button"
          >
            <BookOpenIcon className="size-4 shrink-0" />
            资源管理
          </button>
          <button
            className={navItemClass(activeSection === "ai")}
            data-section="ai"
            onClick={() => setActiveSection("ai")}
            type="button"
          >
            <CpuIcon className="size-4 shrink-0" />
            AI 模型
          </button>
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-8 pt-7 pb-6">
          {activeSection === "general" ? (
            <GeneralSettingsSection
              interfaceLanguage={interfaceLanguage}
              onInterfaceLanguageChange={setInterfaceLanguage}
            />
          ) : activeSection === "resources" ? (
            <ResourceSettingsSection resources={resources} onChange={setResources} />
          ) : (
            <AiSettingsSection
              modelConfigurations={modelConfigurations}
              onChange={setModelConfigurations}
            />
          )}
          <div className="mt-auto flex justify-end gap-2 border-t border-[#2a2a2e] pt-5">
            <button
              className="rounded-[6px] bg-[#252528] px-[18px] py-[7px] text-[13px] font-medium text-[#a0a0ab] transition-all duration-150 hover:bg-[#2e2e32]"
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button
              className="rounded-[6px] bg-[#6c5ce7] px-[18px] py-[7px] text-[13px] font-medium text-white transition-all duration-150 hover:bg-[#7d6ff0]"
              onClick={async () => {
                const saved = await saveSettings({
                  defaultModelId,
                  interfaceLanguage,
                  modelConfigurations,
                  resources,
                });
                if (!saved) {
                  return;
                }
                window.dispatchEvent(new Event(SETTINGS_UPDATED_EVENT));
                onClose();
              }}
              type="button"
            >
              保存设置
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GeneralSettingsSection({
  interfaceLanguage,
  onInterfaceLanguageChange,
}: {
  interfaceLanguage: InterfaceLanguage;
  onInterfaceLanguageChange: (language: InterfaceLanguage) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-base font-semibold">通用设置</div>
      <div className="mb-6 text-[13px] leading-normal text-[#6b6b76]">
        管理界面语言等基础偏好。
      </div>
      <div className="mb-5">
        <label className="mb-1.5 block text-xs font-medium text-[#a0a0ab]">
          界面语言
        </label>
        <div className="flex gap-2">
          <button
            className={settingsOptClass(interfaceLanguage === "zh-CN")}
            data-lang="zh"
            onClick={() => onInterfaceLanguageChange("zh-CN")}
            type="button"
          >
            简体中文
          </button>
          <button
            className={settingsOptClass(interfaceLanguage === "en-US")}
            data-lang="en"
            onClick={() => onInterfaceLanguageChange("en-US")}
            type="button"
          >
            English
          </button>
        </div>
      </div>
    </div>
  );
}

function ResourceSettingsSection({
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

function AiSettingsSection({
  modelConfigurations,
  onChange,
}: {
  modelConfigurations: ModelConfigurationForm[];
  onChange: (configurations: ModelConfigurationForm[]) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-base font-semibold">AI 模型</div>
      <div className="mb-6 text-[13px] leading-normal text-[#6b6b76]">
        添加和管理多个 AI 模型配置，每个配置包含 Provider、Model、Base URL 和
        API Key。
      </div>
      <div className="mb-4 flex flex-col gap-3">
        {modelConfigurations.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-[#6b6b76]">
            暂无模型配置，点击下方按钮添加。
          </div>
        ) : (
          modelConfigurations.map((configuration, index) => (
            <ModelConfigCard
              configuration={configuration}
              key={configuration.id}
              onChange={(nextConfiguration) => {
                onChange(
                  modelConfigurations.map((item, itemIndex) =>
                    itemIndex === index ? nextConfiguration : item,
                  ),
                );
              }}
              onRemove={() => {
                onChange(
                  modelConfigurations.filter((_, itemIndex) => itemIndex !== index),
                );
              }}
            />
          ))
        )}
      </div>
      <button
        className="flex w-full items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-[#2a2a2e] bg-[#0a0a0b] p-2.5 text-[13px] text-[#a0a0ab] transition-all duration-150 hover:border-[#6c5ce7] hover:bg-[rgba(108,92,231,0.15)] hover:text-[#6c5ce7] [&_svg]:size-4"
        onClick={() => {
          onChange([
            ...modelConfigurations,
            {
              id: crypto.randomUUID(),
              provider: "",
              model: "",
              baseUrl: "",
              apiKey: "",
              contextSizeK: "",
              providerOptions: undefined,
              collapsed: false,
            },
          ]);
        }}
        type="button"
      >
        <PlusIcon />
        添加模型
      </button>
    </div>
  );
}

function ModelConfigCard({
  configuration,
  onChange,
  onRemove,
}: {
  configuration: ModelConfigurationForm;
  onChange: (configuration: ModelConfigurationForm) => void;
  onRemove: () => void;
}) {
  const label =
    configuration.model || getProviderLabel(configuration.provider) || "未命名";

  return (
    <div className="overflow-hidden rounded-[8px] border border-[#2a2a2e] bg-[#0a0a0b] transition-colors duration-150 hover:border-[#38383d]">
      <div
        className={cn(
          "flex cursor-pointer select-none items-center gap-1.5 bg-[#141416] px-3.5 py-2.5",
          !configuration.collapsed && "border-b border-[#2a2a2e]",
        )}
        onClick={() =>
          onChange({ ...configuration, collapsed: !configuration.collapsed })
        }
      >
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 text-[#6b6b76] transition-transform duration-200",
            configuration.collapsed && "-rotate-90",
          )}
        />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]">
          {label}
        </div>
        <button
          className="flex size-6 items-center justify-center rounded-[6px] text-[#6b6b76] transition-all duration-150 hover:bg-[rgba(231,76,60,0.1)] hover:text-[#e74c3c] [&_svg]:size-3.5"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          title="删除此配置"
          type="button"
        >
          <XIcon />
        </button>
      </div>
      {configuration.collapsed ? null : (
        <div className="grid grid-cols-2 gap-3 p-3.5">
          <ModelField label="Provider" required>
            <select
              className="w-full cursor-pointer appearance-none rounded-[6px] border border-[#2a2a2e] bg-[#1c1c1f] px-2.5 py-[7px] pr-7 text-[13px] text-[#f0f0f2] outline-none transition-colors duration-150 hover:border-[#38383d] focus:border-[#6c5ce7]"
              onChange={(event) => {
                const provider = event.target.value as ModelProvider;

                onChange({
                  ...configuration,
                  provider,
                  ...(provider === "deepseek"
                    ? {
                        model: isDeepSeekModel(configuration.model)
                          ? configuration.model
                          : DEFAULT_DEEPSEEK_MODEL,
                        contextSizeK: String(DEEPSEEK_CONTEXT_SIZE_K),
                      }
                    : provider === "openai-compatible"
                      ? {
                          contextSizeK: configuration.contextSizeK,
                        }
                      : {}),
                });
              }}
              value={configuration.provider}
            >
              <option value="">选择 Provider...</option>
              <option value="deepseek">DeepSeek</option>
              <option value="openai-compatible">OpenAI Compatible</option>
            </select>
          </ModelField>
          <ModelField label="Model" required>
            {configuration.provider === "deepseek" ? (
              <select
                className="w-full cursor-pointer appearance-none rounded-[6px] border border-[#2a2a2e] bg-[#1c1c1f] px-2.5 py-[7px] pr-7 text-[13px] text-[#f0f0f2] outline-none transition-colors duration-150 hover:border-[#38383d] focus:border-[#6c5ce7]"
                onChange={(event) =>
                  onChange({
                    ...configuration,
                    model: event.target.value,
                    contextSizeK: String(DEEPSEEK_CONTEXT_SIZE_K),
                  })
                }
                value={
                  isDeepSeekModel(configuration.model)
                    ? configuration.model
                    : DEFAULT_DEEPSEEK_MODEL
                }
              >
                {DEEPSEEK_MODELS.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={modelInputClass}
                onChange={(event) =>
                  onChange({ ...configuration, model: event.target.value })
                }
                placeholder="例如 gpt-4o"
                type="text"
                value={configuration.model}
              />
            )}
          </ModelField>
          <ModelField
            label="Base URL"
            required={configuration.provider === "openai-compatible"}
          >
            <input
              className={modelInputClass}
              onChange={(event) =>
                onChange({ ...configuration, baseUrl: event.target.value })
              }
              placeholder={getBaseUrlPlaceholder(configuration.provider)}
              type="text"
              value={configuration.baseUrl}
            />
          </ModelField>
          <ModelField label="API Key" required>
            <input
              className={modelInputClass}
              onChange={(event) =>
                onChange({ ...configuration, apiKey: event.target.value })
              }
              placeholder="sk-..."
              type="password"
              value={configuration.apiKey}
            />
          </ModelField>
          {configuration.provider === "openai-compatible" ? (
            <ModelField label="Context Size (K)">
              <input
                className={modelInputClass}
                min={1}
                onChange={(event) =>
                  onChange({
                    ...configuration,
                    contextSizeK: event.target.value,
                  })
                }
                placeholder={String(DEFAULT_OPENAI_COMPATIBLE_CONTEXT_SIZE_K)}
                type="number"
                value={configuration.contextSizeK}
              />
            </ModelField>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ModelField({
  children,
  label,
  required = false,
}: {
  children: ReactNode;
  label: string;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.4px] text-[#6b6b76]">
        {label}
        {required ? <span className="text-[#e74c3c]">*</span> : null}
      </label>
      {children}
    </div>
  );
}

async function saveSettings(settings: {
  defaultModelId: string | null;
  interfaceLanguage: InterfaceLanguage;
  modelConfigurations: ModelConfigurationForm[];
  resources: ResourceSettings;
}) {
  const defaultModelId =
    settings.defaultModelId &&
    settings.modelConfigurations.some(
      (configuration) => configuration.id === settings.defaultModelId,
    )
      ? settings.defaultModelId
      : settings.modelConfigurations[0]?.id ?? null;
  const response = await fetch("/api/settings", {
    body: JSON.stringify({
      defaultModelId,
      interfaceLanguage: settings.interfaceLanguage,
      modelConfigurations: settings.modelConfigurations.map((configuration) => ({
        apiKey: configuration.apiKey,
        baseUrl: configuration.baseUrl,
        id: configuration.id,
        model: configuration.model,
        contextSizeK: configuration.contextSizeK,
        providerOptions: configuration.providerOptions,
        provider: configuration.provider,
      })),
      resources: settings.resources,
    }),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });

  if (!response.ok) {
    window.alert(await response.text());
    return false;
  }

  return true;
}

function normalizeResourceDefaults(libraries: ResourceLibrary[]) {
  const defaultIndex = libraries.findIndex((library) => library.isDefault);

  return libraries.map((library, index) => ({
    ...library,
    isDefault: defaultIndex >= 0 ? index === defaultIndex : index === 0,
  }));
}

function navItemClass(active: boolean) {
  return cn(
    "relative flex w-full items-center gap-2 bg-transparent px-4 py-2 text-left text-[13px] text-[#a0a0ab] transition-all duration-150 hover:bg-[#252528] hover:text-[#f0f0f2]",
    active &&
      "bg-[rgba(108,92,231,0.15)] text-[#6c5ce7] before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:rounded-r-sm before:bg-[#6c5ce7] hover:bg-[rgba(108,92,231,0.15)] hover:text-[#6c5ce7]",
  );
}

function settingsOptClass(active: boolean) {
  return cn(
    "flex-1 rounded-[6px] border border-[#2a2a2e] bg-[#0a0a0b] px-3 py-2 text-center text-[13px] text-[#a0a0ab] transition-all duration-150 hover:border-[#38383d] hover:text-[#f0f0f2]",
    active &&
      "border-[#6c5ce7] bg-[rgba(108,92,231,0.15)] text-[#6c5ce7]",
  );
}

function getProviderLabel(provider: ModelProvider) {
  if (provider === "deepseek") {
    return "DeepSeek";
  }

  if (provider === "openai-compatible") {
    return "OpenAI Compatible";
  }

  return "";
}

function getBaseUrlPlaceholder(provider: ModelProvider) {
  if (provider === "deepseek") {
    return "https://api.deepseek.com";
  }

  return "";
}

const modelInputClass =
  "w-full rounded-[6px] border border-[#2a2a2e] bg-[#1c1c1f] px-2.5 py-[7px] text-[13px] text-[#f0f0f2] outline-none transition-colors duration-150 placeholder:text-[#6b6b76] focus:border-[#6c5ce7]";

const resourceCdnInputClass =
  "min-w-0 flex-1 rounded-[6px] border border-[#2a2a2e] bg-[#1c1c1f] px-2 py-1.5 font-mono text-xs text-[#a0a0ab] outline-none transition-colors duration-150 placeholder:text-[#6b6b76] focus:border-[#6c5ce7]";

const DEEPSEEK_CONTEXT_SIZE_K = 1000;
const DEFAULT_OPENAI_COMPATIBLE_CONTEXT_SIZE_K = 200;
const DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"] as const;
const DEFAULT_DEEPSEEK_MODEL = DEEPSEEK_MODELS[0];

function isDeepSeekModel(model: string): model is (typeof DEEPSEEK_MODELS)[number] {
  return DEEPSEEK_MODELS.includes(
    model as (typeof DEEPSEEK_MODELS)[number],
  );
}
