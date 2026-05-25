"use client";

import { useMemo, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { useAppNavigate } from "@/lib/router";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LayoutPanelLeftIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  LanguageCard,
  PanelDescription,
  PanelTitle,
  StepItem,
  StepLine,
  SummaryCard,
  GlobeIcon,
} from "@/features/onboarding/components/setup-widgets";
import type {
  InterfaceLanguage,
  ModelProviderOptions,
} from "@owndesign/core/settings/settings-service";
import {
  DEEPSEEK_CONTEXT_SIZE_K,
  DEEPSEEK_MODELS,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_OPENAI_COMPATIBLE_CONTEXT_SIZE_K,
  getProviderLabel,
  isDeepSeekModel,
  type DeepSeekThinkingMode,
  type ModelProvider,
} from "@/features/settings/model-utils";

type InitialModelConfiguration = {
  id: string;
  provider: ModelProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
  contextSizeK: number;
  providerOptions?: ModelProviderOptions;
};

export type InitialSetupInput = {
  interfaceLanguage: InterfaceLanguage;
  modelConfigurations: InitialModelConfiguration[];
};

type InitialSetupGuideProps = {
  onComplete: (input: InitialSetupInput) => Promise<{ href?: string } | void>;
};

type Step = 1 | 2 | 3;

type ModelForm = {
  id: string;
  provider: ModelProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
  contextSizeK: string;
  providerOptions?: ModelProviderOptions;
};


export function InitialSetupGuide({ onComplete }: InitialSetupGuideProps) {
  const navigate = useAppNavigate();
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [language, setLanguage] = useState<InterfaceLanguage>("zh-CN");
  const [models, setModels] = useState<ModelForm[]>([
    {
      id: createId(),
      provider: "openai-compatible",
      model: "gpt-4o",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-...",
      contextSizeK: String(DEFAULT_OPENAI_COMPATIBLE_CONTEXT_SIZE_K),
    },
  ]);
  const [toast, setToast] = useState<
    { id: number; message: string; type: "success" | "error" | "info" } | undefined
  >();
  const [isFinishing, setIsFinishing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const summaryModels = useMemo(
    () =>
      models.map(
        (model) => getProviderLabel(model.provider) || model.model || "未命名",
      ),
    [models],
  );

  return (
    <div className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-[#0a0a0b] text-[#fafafa] [background:radial-gradient(ellipse_70%_60%_at_20%_30%,rgba(108,92,231,0.07)_0%,transparent_70%),radial-gradient(ellipse_50%_50%_at_80%_70%,rgba(46,204,113,0.04)_0%,transparent_60%),radial-gradient(ellipse_80%_40%_at_50%_0%,rgba(108,92,231,0.03)_0%,transparent_70%),#0a0a0b] before:pointer-events-none before:absolute before:inset-0 before:bg-[repeating-linear-gradient(90deg,transparent,transparent_120px,rgba(255,255,255,0.012)_120px,rgba(255,255,255,0.012)_121px),repeating-linear-gradient(0deg,transparent,transparent_120px,rgba(255,255,255,0.012)_120px,rgba(255,255,255,0.012)_121px)]">
      <Card className="relative z-10 max-h-[88vh] w-[580px] max-w-[92vw] animate-[containerIn_0.4s_cubic-bezier(0.16,1,0.3,1)] gap-0 overflow-hidden rounded-2xl border border-[#27272a] bg-[#18181b] py-0 text-[#fafafa] shadow-[0_0_0_1px_rgba(108,92,231,0.06),0_24px_80px_rgba(0,0,0,0.5)]">
        <div className="flex shrink-0 items-center gap-3 border-b border-[#27272a] px-7 pt-5 pb-4">
          <div className="flex items-center gap-2 text-base font-bold tracking-normal text-[#6c5ce7]">
            <LayoutPanelLeftIcon className="size-[22px]" />
            OwnDesign
          </div>
          <div className="ml-auto text-[13px] text-[#6b6b76]">
            项目初始化向导
          </div>
        </div>

        <div className="flex shrink-0 items-center px-7 pt-5 pb-2">
          <StepItem active={currentStep === 1} done={currentStep > 1} number="1">
            语言设置
          </StepItem>
          <StepLine done={currentStep > 1} />
          <StepItem active={currentStep === 2} done={currentStep > 2} number="2">
            模型配置
          </StepItem>
          <StepLine done={currentStep > 2} />
          <StepItem active={currentStep === 3} done={false} number="3">
            准备就绪
          </StepItem>
        </div>

        <CardContent className="min-h-0 flex-1 overflow-y-auto px-7 pt-4 pb-0">
          {currentStep === 1 ? (
            <section className="animate-[panelIn_0.3s_ease]">
              <PanelTitle>选择界面语言</PanelTitle>
              <PanelDescription>
                选择你偏好的语言，界面文本将切换为对应语言。
              </PanelDescription>
              <div className="grid grid-cols-2 gap-2.5 pb-2 max-sm:grid-cols-1">
                <LanguageCard
                  icon="中"
                  nativeName="Chinese (Simplified)"
                  name="简体中文"
                  selected={language === "zh-CN"}
                  onClick={() => setLanguage("zh-CN")}
                />
                <LanguageCard
                  icon="EN"
                  nativeName="English (US)"
                  name="English"
                  selected={language === "en-US"}
                  onClick={() => setLanguage("en-US")}
                />
              </div>
            </section>
          ) : null}

          {currentStep === 2 ? (
            <section className="animate-[panelIn_0.3s_ease]">
              <PanelTitle>添加模型配置</PanelTitle>
              <PanelDescription>
                配置 AI 模型的接入信息，包括 Provider、模型名称、接口地址和 API Key。
              </PanelDescription>
              <div className="mb-3 flex flex-col gap-2">
                {models.length === 0 ? (
                  <div className="px-3 py-6 text-center text-[13px] text-[#6b6b76]">
                    暂无模型配置，点击下方按钮添加。
                  </div>
                ) : (
                  models.map((model, index) => (
                    <ModelEntry
                      key={model.id}
                      model={model}
                      removable={models.length > 1}
                      onChange={(nextModel) =>
                        setModels((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? nextModel : item,
                          ),
                        )
                      }
                      onRemove={() =>
                        setModels((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    />
                  ))
                )}
              </div>
              <button
                className="flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-[#27272a] bg-[#1c1c20] p-[9px] text-[13px] text-[#6b6b76] transition-all duration-150 hover:border-[#6c5ce7] hover:bg-[rgba(108,92,231,0.14)] hover:text-[#6c5ce7] [&_svg]:size-[15px]"
                onClick={() =>
                  setModels((current) => [
                    ...current,
                    {
                      id: createId(),
                      provider: "openai-compatible",
                      model: "",
                      baseUrl: "",
                      apiKey: "",
                      contextSizeK: String(DEFAULT_OPENAI_COMPATIBLE_CONTEXT_SIZE_K),
                    },
                  ])
                }
                type="button"
              >
                <PlusIcon />
                添加另一个模型
              </button>
            </section>
          ) : null}

          {currentStep === 3 ? (
            <section className="animate-[panelIn_0.3s_ease]">
              <PanelTitle>准备就绪</PanelTitle>
              <PanelDescription>
                确认你的初始设置，随时可以进入主界面开始设计。
              </PanelDescription>
              <div className="mb-3 flex flex-col gap-3">
                <SummaryCard label="界面语言">
                  <div className="flex items-center gap-2 text-sm font-medium text-[#fafafa]">
                    <GlobeIcon />
                    <span>{language === "zh-CN" ? "简体中文" : "English"}</span>
                  </div>
                </SummaryCard>
                <SummaryCard label="已配置模型">
                  <div className="flex flex-col gap-1">
                    {summaryModels.map((name, index) => (
                      <div
                        className="flex items-center gap-2 py-1 text-[13px] text-[#a1a1aa]"
                        key={`${name}-${index}`}
                      >
                        <CheckIcon className="size-3.5 shrink-0 text-[#2ecc71]" />
                        <span>
                          {name} - {models[index]?.model || "-"}
                        </span>
                      </div>
                    ))}
                  </div>
                </SummaryCard>
              </div>
            </section>
          ) : null}
        </CardContent>

        <div className="mt-4 flex shrink-0 items-center justify-between border-t border-[#27272a] px-7 pt-4 pb-5">
          <div className="text-xs text-[#6b6b76]">{getHint(currentStep)}</div>
          <div className="flex gap-2">
            {currentStep > 1 ? (
              <Button
                className="h-8 gap-1.5 rounded-md bg-[#252528] px-[18px] text-[13px] font-medium text-[#a1a1aa] hover:bg-[#2e2e32] hover:text-[#fafafa]"
                onClick={() =>
                  setCurrentStep((step) => (step === 3 ? 2 : 1) as Step)
                }
                type="button"
                variant="ghost"
              >
                <ChevronLeftIcon data-icon="inline-start" />
                返回
              </Button>
            ) : null}
            <Button
              className="h-8 gap-1.5 rounded-md bg-[#6c5ce7] px-[22px] text-[13px] font-semibold text-white hover:bg-[#7d6ff0] hover:shadow-[0_0_20px_rgba(108,92,231,0.08)]"
              disabled={isPending || isFinishing}
              onClick={handleNext}
              type="button"
            >
              {currentStep === 3 ? "进入主界面" : "继续"}
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          </div>
        </div>
      </Card>

      <div
        className={cn(
          "pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0b] opacity-0 transition-opacity duration-400",
          isFinishing && "pointer-events-auto opacity-100",
        )}
      >
        <div className="flex animate-[toPulse_0.6s_ease] flex-col items-center gap-4">
          <LayoutPanelLeftIcon className="size-12 text-[#6c5ce7]" />
          <div className="text-base font-semibold text-[#fafafa]">
            正在进入 OwnDesign
          </div>
          <div className="text-[13px] text-[#6b6b76]">加载项目工作区...</div>
        </div>
      </div>

      {toast ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-2">
          <div className="pointer-events-auto flex max-w-[380px] animate-[toastIn_0.25s_ease] items-center gap-2 rounded-[10px] border border-[#27272a] bg-[#18181b] px-[18px] py-2.5 text-[13px] shadow-md">
            {toast.type === "error" ? (
              <XIcon className="size-4 shrink-0 text-[#e74c3c]" />
            ) : (
              <CheckIcon className="size-4 shrink-0 text-[#2ecc71]" />
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      ) : null}
    </div>
  );

  function handleNext() {
    if (currentStep === 1) {
      setCurrentStep(2);
      return;
    }

    if (currentStep === 2) {
      if (models.length === 0) {
        showToast("请至少添加一个模型配置", "error");
        return;
      }

      setCurrentStep(3);
      return;
    }

    setIsFinishing(true);
    showToast("初始化完成，正在进入主界面", "success");
    startTransition(async () => {
      const result = await onComplete({
        interfaceLanguage: language,
        modelConfigurations: models.map(normalizeModelForSubmit),
      });
      window.setTimeout(() => {
        navigate(result?.href ?? "/");
      }, 1200);
    });
  }

  function showToast(message: string, type: "success" | "error" | "info") {
    const id = Date.now();
    setToast({ id, message, type });
    window.setTimeout(() => {
      setToast((current) => (current?.id === id ? undefined : current));
    }, 2800);
  }
}

function ModelEntry({
  model,
  removable,
  onChange,
  onRemove,
}: {
  model: ModelForm;
  removable: boolean;
  onChange: (model: ModelForm) => void;
  onRemove: () => void;
}) {
  const label = getProviderLabel(model.provider) || model.model || "未命名模型";

  return (
    <div className="overflow-hidden rounded-[10px] border border-[#27272a] bg-[#1c1c20] transition-colors duration-150 hover:border-[#3f3f46]">
      <div className="flex cursor-pointer select-none items-center gap-2 px-3.5 py-2.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {label}
        </span>
        <span className="rounded-[10px] bg-[rgba(108,92,231,0.14)] px-2 py-0.5 text-[10px] font-semibold tracking-[0.3px] text-[#6c5ce7]">
          {getProviderLabel(model.provider) || "未设置"}
        </span>
        {removable ? (
          <button
            className="flex size-6 items-center justify-center rounded-md text-[#6b6b76] transition-all duration-150 hover:bg-[rgba(231,76,60,0.1)] hover:text-[#e74c3c] [&_svg]:size-3.5"
            onClick={onRemove}
            title="移除"
            type="button"
          >
            <XIcon />
          </button>
        ) : null}
      </div>
      <FieldGroup className="grid grid-cols-2 gap-2.5 px-3.5 pb-3.5 max-sm:grid-cols-1">
        <ModelField label="Provider">
          <Select
            onValueChange={(providerValue) => {
              const provider = providerValue as ModelProvider;
              onChange({
                ...model,
                provider,
                ...(provider === "deepseek"
                  ? {
                      model: isDeepSeekModel(model.model)
                        ? model.model
                        : DEFAULT_DEEPSEEK_MODEL,
                      baseUrl: model.baseUrl || "https://api.deepseek.com",
                      contextSizeK: String(DEEPSEEK_CONTEXT_SIZE_K),
                      providerOptions: {
                        deepseek: { thinkingMode: "high" as DeepSeekThinkingMode },
                      },
                    }
                  : {
                      contextSizeK:
                        model.contextSizeK ||
                        String(DEFAULT_OPENAI_COMPATIBLE_CONTEXT_SIZE_K),
                      providerOptions: undefined,
                    }),
              });
            }}
            value={model.provider}
          >
            <SelectTrigger className={selectClassName}>
              <SelectValue placeholder="选择 Provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="deepseek">DeepSeek</SelectItem>
                <SelectItem value="openai-compatible">OpenAI Compatible</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </ModelField>
        <ModelField label="Model">
          {model.provider === "deepseek" ? (
            <Select
              onValueChange={(value) =>
                onChange({
                  ...model,
                  model: value ?? DEFAULT_DEEPSEEK_MODEL,
                  contextSizeK: String(DEEPSEEK_CONTEXT_SIZE_K),
                })
              }
              value={isDeepSeekModel(model.model) ? model.model : DEFAULT_DEEPSEEK_MODEL}
            >
              <SelectTrigger className={selectClassName}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {DEEPSEEK_MODELS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <Input
              className={inputClassName}
              onChange={(event) => onChange({ ...model, model: event.target.value })}
              placeholder="gpt-4o"
              type="text"
              value={model.model}
            />
          )}
        </ModelField>
        <ModelField label="Base URL">
          <Input
            className={inputClassName}
            onChange={(event) => onChange({ ...model, baseUrl: event.target.value })}
            placeholder="https://api.openai.com/v1"
            type="text"
            value={model.baseUrl}
          />
        </ModelField>
        <ModelField label="API Key">
          <Input
            className={inputClassName}
            onChange={(event) => onChange({ ...model, apiKey: event.target.value })}
            placeholder="sk-..."
            type="password"
            value={model.apiKey}
          />
        </ModelField>
      </FieldGroup>
    </div>
  );
}

function ModelField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <Field className="gap-[3px]">
      <FieldLabel className="text-[10px] font-semibold tracking-[0.4px] text-[#6b6b76] uppercase">
        {label}
      </FieldLabel>
      {children}
    </Field>
  );
}

function getHint(step: Step) {
  if (step === 1) {
    return "选择你偏好的界面语言";
  }

  if (step === 2) {
    return "配置至少一个 AI 模型";
  }

  return "确认设置，开始使用";
}

function normalizeModelForSubmit(model: ModelForm): InitialModelConfiguration {
  const provider = model.provider || "openai-compatible";
  const contextSizeK =
    provider === "deepseek"
      ? DEEPSEEK_CONTEXT_SIZE_K
      : Number.parseInt(model.contextSizeK, 10) ||
        DEFAULT_OPENAI_COMPATIBLE_CONTEXT_SIZE_K;

  return {
    id: model.id,
    provider,
    model:
      provider === "deepseek"
        ? isDeepSeekModel(model.model)
          ? model.model
          : DEFAULT_DEEPSEEK_MODEL
        : model.model,
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    contextSizeK,
    ...(provider === "deepseek"
      ? {
          providerOptions: model.providerOptions ?? {
            deepseek: { thinkingMode: "high" },
          },
        }
      : {}),
  };
}

function createId() {
  return crypto.randomUUID();
}

const inputClassName =
  "h-[34px] rounded-md border-[#27272a] bg-[#18181b] px-2.5 py-[7px] text-[13px] text-[#fafafa] shadow-none outline-none transition-colors duration-150 placeholder:text-[#6b6b76] focus-visible:border-[#6c5ce7] focus-visible:ring-0";

const selectClassName =
  "h-[34px] w-full rounded-md border-[#27272a] bg-[#18181b] px-2.5 py-[7px] text-[13px] text-[#fafafa] shadow-none outline-none transition-colors duration-150 hover:border-[#3f3f46] focus-visible:border-[#6c5ce7] focus-visible:ring-0";
