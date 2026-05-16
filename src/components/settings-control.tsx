"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  ChevronDownIcon,
  CpuIcon,
  PlusIcon,
  SettingsIcon,
  SlidersIcon,
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

type ModelConfigurationForm = {
  id: string;
  provider: ModelProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
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
    apiKey: "";
    hasApiKey: boolean;
    providerOptions?: ModelProviderOptions;
  }>;
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
  const [activeSection, setActiveSection] = useState<"general" | "ai">(
    "general",
  );
  const [interfaceLanguage, setInterfaceLanguage] =
    useState<InterfaceLanguage>("zh-CN");
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);
  const [modelConfigurations, setModelConfigurations] = useState<
    ModelConfigurationForm[]
  >([]);

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
        setModelConfigurations(
          settings.modelConfigurations.map((configuration) => ({
            id: configuration.id,
            provider: configuration.provider,
            model: configuration.model,
            baseUrl: configuration.baseUrl,
            apiKey: "",
            providerOptions: configuration.providerOptions,
            collapsed: false,
          })),
        );
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[1000] flex animate-in fade-in-0 items-center justify-center bg-black/60 duration-150">
      <div className="flex h-[80vh] max-h-[620px] w-full max-w-[760px] animate-in flex-row overflow-hidden rounded-[12px] border border-[#2a2a2e] bg-[#1c1c1f] p-0 text-[#f0f0f2] shadow-[0_8px_24px_rgba(0,0,0,0.5)] duration-150 zoom-in-95 slide-in-from-bottom-2">
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
                    onClick={() => setInterfaceLanguage("zh-CN")}
                    type="button"
                  >
                    简体中文
                  </button>
                  <button
                    className={settingsOptClass(interfaceLanguage === "en-US")}
                    data-lang="en"
                    onClick={() => setInterfaceLanguage("en-US")}
                    type="button"
                  >
                    English
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-1 text-base font-semibold">AI 模型</div>
              <div className="mb-6 text-[13px] leading-normal text-[#6b6b76]">
                添加和管理多个 AI 模型配置，每个配置包含 Provider、Model、Base
                URL 和 API Key。
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
                        setModelConfigurations((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? nextConfiguration : item,
                          ),
                        );
                      }}
                      onRemove={() => {
                        setModelConfigurations((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        );
                      }}
                    />
                  ))
                )}
              </div>
              <button
                className="flex w-full items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-[#2a2a2e] bg-[#0a0a0b] p-2.5 text-[13px] text-[#a0a0ab] transition-all duration-150 hover:border-[#6c5ce7] hover:bg-[rgba(108,92,231,0.15)] hover:text-[#6c5ce7] [&_svg]:size-4"
                onClick={() => {
                  setModelConfigurations((current) => [
                    ...current,
                    {
                      id: crypto.randomUUID(),
                      provider: "",
                      model: "",
                      baseUrl: "",
                      apiKey: "",
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

function ModelConfigCard({
  configuration,
  onChange,
  onRemove,
}: {
  configuration: ModelConfigurationForm;
  onChange: (configuration: ModelConfigurationForm) => void;
  onRemove: () => void;
}) {
  const label = configuration.model || getProviderLabel(configuration.provider) || "未命名";

  return (
    <div className="overflow-hidden rounded-[8px] border border-[#2a2a2e] bg-[#0a0a0b] transition-colors duration-150 hover:border-[#38383d]">
      <div
        className="flex cursor-pointer select-none items-center gap-1.5 border-b border-[#2a2a2e] bg-[#141416] px-3.5 py-2.5"
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
              onChange={(event) =>
                onChange({
                  ...configuration,
                  provider: event.target.value as ModelProvider,
                })
              }
              value={configuration.provider}
            >
              <option value="">选择 Provider...</option>
              <option value="deepseek">DeepSeek</option>
              <option value="openai-compatible">OpenAI Compatible</option>
            </select>
          </ModelField>
          <ModelField label="Model" required>
            <input
              className={modelInputClass}
              onChange={(event) =>
                onChange({ ...configuration, model: event.target.value })
              }
              placeholder="例如 gpt-4o"
              type="text"
              value={configuration.model}
            />
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
        providerOptions: configuration.providerOptions,
        provider: configuration.provider,
      })),
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
