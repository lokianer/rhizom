import i18next, { type LanguageDetectorModule } from 'i18next';
import { initReactI18next } from 'react-i18next';

import {
  fallbackLanguage,
  resolveLanguage,
  supportedLanguages,
  type SupportedLanguage,
} from './detect.js';
import deCommon from './locales/de/common.json';
import enCommon from './locales/en/common.json';

export const defaultNS = 'common';

// Exported so i18next.d.ts can derive the typed keys from the English bundle.
export const resources = {
  en: { common: enCommon },
  de: { common: deCommon },
} as const;

const STORAGE_KEY = 'rhizom.language';

function readStoredLanguage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (privacy mode, disabled storage): fall back to the browser.
    return null;
  }
}

// Synchronous detector: a stored choice wins, then the browser preference, then English.
const languageDetector: LanguageDetectorModule = {
  type: 'languageDetector',
  detect: () => resolveLanguage(readStoredLanguage(), navigator.languages),
  cacheUserLanguage: (language) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Persistence is best-effort.
    }
  },
};

i18next.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

// With bundled resources and a synchronous detector, init() completes synchronously, so the
// first render never suspends. `lng` is deliberately not set: it would override detection.
void i18next
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    resources,
    defaultNS,
    ns: [defaultNS],
    fallbackLng: fallbackLanguage,
    supportedLngs: supportedLanguages,
    load: 'languageOnly',
    debug: import.meta.env.DEV,
    interpolation: {
      // React escapes rendered values itself.
      escapeValue: false,
    },
  });

export async function changeLanguage(language: SupportedLanguage): Promise<void> {
  // i18next calls languageDetector.cacheUserLanguage() as part of changeLanguage().
  await i18next.changeLanguage(language);
}

export default i18next;
