"use client";

import type { InterfaceLanguage } from "@/features/settings/types";
import { settingsOptClass } from "@/features/settings/components/settings-styles";

export function GeneralSettingsSection({
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

