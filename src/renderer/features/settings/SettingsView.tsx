import { useTranslation } from 'react-i18next'
import { ChoiceGroup, type Choice } from '@renderer/components/ui/choice-group'
import { useSettingsStore } from '@renderer/stores/settings'
import { SecuritySettings } from '@renderer/features/security/SecuritySettings'
import { AboutSettings } from './AboutSettings'
import { HostSettings } from './HostSettings'
import { TerminalSettings } from './TerminalSettings'
import { TerminalThemePicker } from './TerminalThemePicker'
import type { Language, Theme } from '@shared/settings'

export function SettingsView() {
  const { t } = useTranslation()
  const settings = useSettingsStore((state) => state.settings)
  const error = useSettingsStore((state) => state.error)
  const update = useSettingsStore((state) => state.update)

  const themeChoices: readonly Choice<Theme>[] = [
    { value: 'system', label: t('settings.themeSystem') },
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') },
  ]
  // Each language is named in its own language.
  const languageChoices: readonly Choice<Language>[] = [
    { value: 'en', label: t('languages.en'), lang: 'en' },
    { value: 'fa', label: t('languages.fa'), lang: 'fa' },
  ]

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-8 overflow-y-auto p-8 pb-24">
      <h1 className="text-xl font-semibold">{t('settings.title')}</h1>

      {error !== null && (
        <p
          role="alert"
          className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
        >
          {t(`errors.${error}`)}
        </p>
      )}

      <div className="flex flex-col gap-6">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('settings.appearance')}</h2>
        <ChoiceGroup
          legend={t('settings.theme')}
          value={settings.theme}
          choices={themeChoices}
          onChange={(theme) => void update({ theme })}
        />
        <TerminalThemePicker
          value={settings.terminalTheme}
          onChange={(terminalTheme) => void update({ terminalTheme })}
        />
        <ChoiceGroup
          legend={t('settings.language')}
          hint={t('settings.languageHint')}
          value={settings.language}
          choices={languageChoices}
          onChange={(language) => void update({ language })}
        />
      </div>
      <TerminalSettings />
      <HostSettings />
      <SecuritySettings />
      <AboutSettings />
    </section>
  )
}
