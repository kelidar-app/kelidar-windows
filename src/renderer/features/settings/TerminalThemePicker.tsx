import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { TERMINAL_THEME_IDS, type TerminalThemeId } from '@shared/settings'
import { TERMINAL_THEMES } from '@renderer/features/terminal/themes'
import { cn } from '@renderer/lib/cn'
import { usePrefersDark } from '@renderer/lib/use-prefers-dark'

const SWATCHES = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const

/**
 * The four terminal themes as radio cards. Each preview shows the variant
 * that matches the current light or dark appearance.
 */
export function TerminalThemePicker({
  value,
  onChange,
}: {
  value: TerminalThemeId
  onChange: (value: TerminalThemeId) => void
}) {
  const { t } = useTranslation()
  const name = useId()
  const dark = usePrefersDark()

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{t('settings.terminalTheme')}</legend>
      <p className="mb-1 text-xs text-muted-foreground">{t('settings.terminalThemeHint')}</p>
      <div className="grid grid-cols-2 gap-3">
        {TERMINAL_THEME_IDS.map((id) => {
          const colors = dark ? TERMINAL_THEMES[id].dark : TERMINAL_THEMES[id].light
          const checked = id === value
          return (
            <label
              key={id}
              className={cn(
                'flex cursor-pointer flex-col gap-2 rounded-lg border p-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring',
                checked ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-input',
              )}
            >
              <input
                type="radio"
                name={name}
                value={id}
                checked={checked}
                className="sr-only"
                onChange={() => {
                  onChange(id)
                }}
              />
              <div
                aria-hidden
                dir="ltr"
                className="flex flex-col gap-1 rounded-md p-2 font-mono text-xs"
                style={{ backgroundColor: colors.background, color: colors.foreground }}
              >
                <span>
                  <span style={{ color: colors.green }}>user@host</span>:
                  <span style={{ color: colors.blue }}>~</span>$ ls
                </span>
                <span className="flex gap-1">
                  {SWATCHES.map((swatch) => (
                    <span
                      key={swatch}
                      className="size-3 rounded-sm"
                      style={{ backgroundColor: colors[swatch] }}
                    />
                  ))}
                </span>
              </div>
              <span className="text-sm">{t(`settings.terminalThemes.${id}`)}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
