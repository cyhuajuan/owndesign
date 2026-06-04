'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useApiClient } from '@/api/context';
import type { InterfaceLanguage } from '@/features/settings/types';
import { translations, type TranslationKey } from '@/features/i18n/translations';

const SETTINGS_UPDATED_EVENT = 'owndesign:settings-updated';

type FormatParams = Record<string, string | number>;

type I18nContextValue = {
  language: InterfaceLanguage;
  refreshLanguage: () => Promise<void>;
  t: (key: TranslationKey, params?: FormatParams) => string;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const api = useApiClient();
  const [language, setLanguage] = useState<InterfaceLanguage>('zh-CN');

  const refreshLanguage = useCallback(async () => {
    const settings = await api.loadSettings();

    setLanguage(settings.interfaceLanguage);
  }, [api]);

  useEffect(() => {
    void refreshLanguage();
    window.addEventListener(SETTINGS_UPDATED_EVENT, refreshLanguage);

    return () => {
      window.removeEventListener(SETTINGS_UPDATED_EVENT, refreshLanguage);
    };
  }, [refreshLanguage]);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      refreshLanguage,
      t: (key, params) => formatMessage(translations[language][key], params),
    }),
    [language, refreshLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);

  if (!context) {
    return fallbackI18nContext;
  }

  return context;
}

function formatMessage(message: string, params?: FormatParams) {
  if (!params || !message) {
    return message;
  }

  return message.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key];

    return value === undefined ? match : String(value);
  });
}

const fallbackI18nContext: I18nContextValue = {
  language: 'zh-CN',
  refreshLanguage: async () => {},
  t: (key, params) => formatMessage(translations['zh-CN'][key], params),
};
