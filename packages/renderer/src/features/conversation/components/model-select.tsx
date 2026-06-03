"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useI18n } from "@/features/i18n/context";
import type {
  AnthropicEffort,
  DeepSeekThinkingMode,
  PublicSettings,
} from "@/features/conversation/types";
import {
  anthropicEfforts,
  deepSeekThinkingModes,
  getDeepSeekThinkingMode,
  getSelectedModelLabel,
} from "@/features/conversation/utils/model-selection";

export function ModelSelect({
  onAnthropicEffortSelect,
  onSelect,
  selectedAnthropicEffort = "high",
  selectedModelId,
  settings,
}: {
  onAnthropicEffortSelect?: (modelId: string, effort: AnthropicEffort) => void;
  onSelect: (
    modelId: string,
    thinkingMode?: DeepSeekThinkingMode,
  ) => void | Promise<void>;
  selectedAnthropicEffort?: AnthropicEffort;
  selectedModelId: string | null;
  settings?: PublicSettings;
}) {
  const { t } = useI18n();
  const selectedModel = settings?.modelConfigurations.find(
    (configuration) => configuration.id === selectedModelId,
  );
  const disabled = !settings || settings.modelConfigurations.length === 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <button
            className="flex h-7 cursor-pointer items-center gap-[5px] rounded-[6px] bg-transparent px-2 text-xs text-[#a0a0ab] transition-all duration-150 hover:bg-[#252528] hover:text-[#f0f0f2] disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:[&_.chev]:rotate-180 [&_svg]:size-[13px]"
            type="button"
          >
            <span className="whitespace-nowrap">
              {getSelectedModelLabel(
                selectedModel,
                selectedAnthropicEffort,
                t("conversation.noModelConfigured"),
              )}
            </span>
            <ChevronDownIcon className="chev !size-2.5 opacity-50 transition-transform duration-150" />
          </button>
        }
      />
      <DropdownMenuContent
        align="end"
        className="min-w-[200px] max-w-[320px] rounded-[8px] border border-[#2a2a2e] bg-[#1c1c1f] p-1 text-[#a0a0ab] shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
        side="top"
        sideOffset={6}
      >
        <DropdownMenuGroup className="max-h-[calc(60vh-8px)] overflow-y-auto overflow-x-hidden">
          {settings?.modelConfigurations.length ? (
            settings.modelConfigurations.map((configuration) =>
              configuration.provider === "deepseek" ? (
                <DropdownMenuSub key={configuration.id}>
                  <DropdownMenuSubTrigger
                    className={modelMenuItemClass(
                      configuration.id === selectedModelId,
                    )}
                    onClick={() => {
                      void onSelect(configuration.id);
                    }}
                  >
                    <ModelSelectCheck
                      active={configuration.id === selectedModelId}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {configuration.model}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    align="end"
                    className="min-w-[120px] rounded-[8px] border border-[#2a2a2e] bg-[#1c1c1f] p-1 text-[#a0a0ab] shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
                    side="right"
                    sideOffset={6}
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="px-2.5 py-1.5 text-[11px] text-[#6b6b76]">
                          {t("conversation.modelThinkingMode")}
                      </DropdownMenuLabel>
                      {deepSeekThinkingModes.map((thinkingMode) => (
                        <DropdownMenuItem
                          className={modelMenuItemClass(
                            configuration.id === selectedModelId &&
                              getDeepSeekThinkingMode(configuration) ===
                                thinkingMode,
                          )}
                          key={thinkingMode}
                          onClick={() => {
                            void onSelect(configuration.id, thinkingMode);
                          }}
                        >
                          <ModelSelectCheck
                            active={
                              configuration.id === selectedModelId &&
                              getDeepSeekThinkingMode(configuration) ===
                                thinkingMode
                            }
                          />
                          <span>{thinkingMode}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : configuration.provider === "anthropic" ? (
                <DropdownMenuSub key={configuration.id}>
                  <DropdownMenuSubTrigger
                    className={modelMenuItemClass(
                      configuration.id === selectedModelId,
                    )}
                    onClick={() => {
                      void onSelect(configuration.id);
                    }}
                  >
                    <ModelSelectCheck
                      active={configuration.id === selectedModelId}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {configuration.model}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    align="end"
                    className="min-w-[120px] rounded-[8px] border border-[#2a2a2e] bg-[#1c1c1f] p-1 text-[#a0a0ab] shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
                    side="right"
                    sideOffset={6}
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="px-2.5 py-1.5 text-[11px] text-[#6b6b76]">
                        Effort
                      </DropdownMenuLabel>
                      {anthropicEfforts.map((effort) => (
                        <DropdownMenuItem
                          className={modelMenuItemClass(
                            configuration.id === selectedModelId &&
                              selectedAnthropicEffort === effort,
                          )}
                          key={effort}
                          onClick={() => {
                            void onSelect(configuration.id);
                            onAnthropicEffortSelect?.(configuration.id, effort);
                          }}
                        >
                          <ModelSelectCheck
                            active={
                              configuration.id === selectedModelId &&
                              selectedAnthropicEffort === effort
                            }
                          />
                          <span>{effort}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : (
                <DropdownMenuItem
                  className={modelMenuItemClass(
                    configuration.id === selectedModelId,
                  )}
                  key={configuration.id}
                  onClick={() => {
                    void onSelect(configuration.id);
                  }}
                >
                  <ModelSelectCheck
                    active={configuration.id === selectedModelId}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {configuration.model}
                  </span>
                </DropdownMenuItem>
              ),
            )
          ) : (
            <DropdownMenuItem
              className="justify-center px-4 py-6 text-center text-xs text-[#6b6b76] focus:bg-transparent focus:text-[#6b6b76]"
              disabled
            >
              {t("conversation.noConfiguredModel")}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelSelectCheck({ active }: { active: boolean }) {
  return (
    <CheckIcon
      className={cn(
        "size-3.5 shrink-0 opacity-0",
        active && "text-[#6c5ce7] opacity-100",
      )}
    />
  );
}

function modelMenuItemClass(active: boolean) {
  return cn(
    "relative flex cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-[7px] text-[13px] text-[#a0a0ab] transition-colors duration-100 focus:bg-[#252528] focus:text-[#f0f0f2]",
    active &&
      "bg-[rgba(108,92,231,0.15)] text-[#6c5ce7] focus:bg-[rgba(108,92,231,0.15)] focus:text-[#6c5ce7]",
  );
}
