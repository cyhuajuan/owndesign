"use client";

import type { ReactNode } from "react";
import { ChevronDownIcon, PlusIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DEEPSEEK_CONTEXT_SIZE_K,
  DEEPSEEK_MODELS,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_OPENAI_COMPATIBLE_CONTEXT_SIZE_K,
  getBaseUrlPlaceholder,
  getProviderLabel,
  isDeepSeekModel,
  type ModelProvider,
} from "@/features/settings/model-utils";
import type { ModelConfigurationForm } from "@/features/settings/types";

export function AiSettingsSection({
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



const modelInputClass =
  "w-full rounded-[6px] border border-[#2a2a2e] bg-[#1c1c1f] px-2.5 py-[7px] text-[13px] text-[#f0f0f2] outline-none transition-colors duration-150 placeholder:text-[#6b6b76] focus:border-[#6c5ce7]";
