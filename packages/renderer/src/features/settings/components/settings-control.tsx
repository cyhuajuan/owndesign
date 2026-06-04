'use client';

import { useEffect, useState } from 'react';
import { BookOpenIcon, CpuIcon, SettingsIcon, SlidersIcon } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useI18n } from '@/features/i18n/context';
import { AiSettingsSection } from '@/features/settings/components/ai-settings-section';
import { GeneralSettingsSection } from '@/features/settings/components/general-settings-section';
import { ResourceSettingsSection } from '@/features/settings/components/resource-settings-section';
import { saveSettings, loadSettings } from '@/features/settings/client';
import { useApiClient } from '@/api/context';
import type {
  InterfaceLanguage,
  ModelConfigurationForm,
  ResourceSettings,
} from '@/features/settings/types';

export const SETTINGS_UPDATED_EVENT = 'owndesign:settings-updated';

const DEFAULT_RESOURCES: ResourceSettings = {
  fontLibraries: [
    {
      id: 'font-1',
      name: 'Google Fonts',
      cdn: 'https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Noto+Sans+SC:wght@100..900&display=swap',
      isDefault: true,
    },
  ],
  iconLibraries: [
    {
      id: 'icon-1',
      name: 'Lucide Icons',
      cdn: 'https://unpkg.com/lucide@latest/dist/umd/lucide.js',
      isDefault: true,
    },
  ],
};

export function SettingsControl() {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useI18n();

  return (
    <Dialog onOpenChange={setIsOpen} open={isOpen}>
      <button
        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[6px] text-[#6b6b76] transition-all duration-200 hover:bg-[#252528] hover:text-[#f0f0f2] [&_svg]:size-4 [&_svg]:transition-transform [&_svg]:duration-[400ms] hover:[&_svg]:rotate-[60deg]"
        onClick={() => setIsOpen(true)}
        title={t('settings.open')}
        type="button"
      >
        <SettingsIcon />
      </button>
      <SettingsPanel isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </Dialog>
  );
}

function SettingsPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [activeSection, setActiveSection] = useState<'general' | 'resources' | 'ai'>('general');
  const [interfaceLanguage, setInterfaceLanguage] = useState<InterfaceLanguage>('zh-CN');
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);
  const [modelConfigurations, setModelConfigurations] = useState<ModelConfigurationForm[]>([]);
  const [resources, setResources] = useState<ResourceSettings>(DEFAULT_RESOURCES);
  const api = useApiClient();
  const { t } = useI18n();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let isMounted = true;

    void loadSettings(api).then((settings) => {
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
          apiKey: '',
          providerOptions:
            configuration.provider === 'deepseek' ? configuration.providerOptions : undefined,
          collapsed: true,
        })),
      );
    });

    return () => {
      isMounted = false;
    };
  }, [api, isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <DialogContent
      className="max-h-[620px] h-[80vh] max-w-[820px] gap-0 overflow-hidden border border-[#2a2a2e] bg-[#1c1c1f] p-0 text-[#f0f0f2] shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
      data-testid="settings-panel"
      showCloseButton={false}
    >
      <DialogTitle className="sr-only">{t('settings.open')}</DialogTitle>
      <DialogDescription className="sr-only">{t('settings.description')}</DialogDescription>
      <div className="flex size-full flex-row overflow-hidden rounded-[12px]">
        <div className="flex w-[200px] min-w-[200px] shrink-0 flex-col overflow-y-auto border-r border-[#2a2a2e] bg-[#141416] py-5">
          <button
            className={navItemClass(activeSection === 'general')}
            data-section="general"
            onClick={() => setActiveSection('general')}
            type="button"
          >
            <SlidersIcon className="size-4 shrink-0" />
            {t('settings.general')}
          </button>
          <button
            className={navItemClass(activeSection === 'resources')}
            data-section="resources"
            onClick={() => setActiveSection('resources')}
            type="button"
          >
            <BookOpenIcon className="size-4 shrink-0" />
            {t('settings.resources')}
          </button>
          <button
            className={navItemClass(activeSection === 'ai')}
            data-section="ai"
            onClick={() => setActiveSection('ai')}
            type="button"
          >
            <CpuIcon className="size-4 shrink-0" />
            {t('settings.aiModels')}
          </button>
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-8 pt-7 pb-6">
          {activeSection === 'general' ? (
            <GeneralSettingsSection
              interfaceLanguage={interfaceLanguage}
              onInterfaceLanguageChange={setInterfaceLanguage}
            />
          ) : activeSection === 'resources' ? (
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
              {t('common.cancel')}
            </button>
            <button
              className="rounded-[6px] bg-[#6c5ce7] px-[18px] py-[7px] text-[13px] font-medium text-white transition-all duration-150 hover:bg-[#7d6ff0]"
              onClick={async () => {
                const saved = await saveSettings(api, {
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
              {t('settings.saveSettings')}
            </button>
          </div>
        </div>
      </div>
    </DialogContent>
  );
}

function navItemClass(active: boolean) {
  return cn(
    'relative flex w-full items-center gap-2 bg-transparent px-4 py-2 text-left text-[13px] text-[#a0a0ab] transition-all duration-150 hover:bg-[#252528] hover:text-[#f0f0f2]',
    active &&
      'bg-[rgba(108,92,231,0.15)] text-[#6c5ce7] before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:rounded-r-sm before:bg-[#6c5ce7] hover:bg-[rgba(108,92,231,0.15)] hover:text-[#6c5ce7]',
  );
}
