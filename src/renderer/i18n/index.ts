import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { APP } from '@shared/app'
import type { Language } from '@shared/settings'
import en from './en.json'
import fa from './fa.json'

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
      escapeValue: false,
      defaultVariables: { appName: APP.name },
    },
    returnNull: false,
  })
  applyDocumentLanguage(i18next.language)
}

export { i18next }
