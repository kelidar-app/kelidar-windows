import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { APP } from '@shared/app'
import type { Language } from '@shared/settings'
import en from './en.json'
import fa from './fa.json'

/** First-strong isolate and pop directional isolate (Unicode bidi controls, invisible). */
const FSI = '\u2068'
const PDI = '\u2069'

/**
 * In RTL text, each inserted value (an address, a shortcut like
 * Ctrl+0, a host name) is isolated so it keeps its own direction: without
 * this, "Ctrl+0" inside a Persian sentence shows as "0+Ctrl". LTR text does
 * not need it, so English strings stay exactly as written.
 */
export function isolateValue(value: string, direction: 'ltr' | 'rtl'): string {
  return direction === 'rtl' ? `${FSI}${value}${PDI}` : value
}

/** Sets lang and dir on <html>, which flips the whole layout for Persian. */
function applyDocumentLanguage(language: string): void {
  const root = document.documentElement
  root.lang = language
  root.dir = i18next.dir(language)
}

export async function initI18n(language: Language): Promise<void> {
  i18next.on('languageChanged', applyDocumentLanguage)
  await i18next.use(initReactI18next).init({
    resources: { en: { translation: en }, fa: { translation: fa } },
    lng: language,
    fallbackLng: 'en',
    supportedLngs: ['en', 'fa'],
    interpolation: {
      // Not HTML escaping (React does that): bidi isolation of inserted values.
      escapeValue: true,
      escape: (value: string) => isolateValue(value, i18next.dir()),
      defaultVariables: { appName: APP.name },
    },
    returnNull: false,
  })
  applyDocumentLanguage(i18next.language)
}

export { i18next }
