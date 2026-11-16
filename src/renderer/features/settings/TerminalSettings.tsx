import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_TERMINAL_FONT,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  terminalFontFamilySchema,
  terminalFontSizeSchema,
  terminalLineHeightSchema,
} from '@shared/settings'
import { SHORTCUTS } from '@renderer/app/shortcuts'
import { Field } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { useSettingsStore } from '@renderer/stores/settings'

/** Monospaced fonts that ship with Windows or are common among developers. */
const FONT_SUGGESTIONS = [
  DEFAULT_TERMINAL_FONT,
  "'Cascadia Code', monospace",
  'Consolas, monospace',
  "'JetBrains Mono', monospace",
  "'Fira Code', monospace",
  "'Courier New', monospace",
]

/** Font, size, line height and the paste guard. Each field saves when it loses focus. */
export function TerminalSettings() {
  const { t } = useTranslation()
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)
  const [family, setFamily] = useState(settings.terminalFontFamily)
  const [size, setSize] = useState(String(settings.terminalFontSize))
  const [lineHeight, setLineHeight] = useState(String(settings.terminalLineHeight))
  const [errors, setErrors] = useState<{ family?: string; size?: string; lineHeight?: string }>({})

  const saveFamily = (): void => {
    const parsed = terminalFontFamilySchema.safeParse(family)
    setErrors((current) => ({
      ...current,
      family: parsed.success ? undefined : t('settings.fontInvalid'),
    }))
    if (parsed.success && parsed.data !== settings.terminalFontFamily) {
      void update({ terminalFontFamily: parsed.data })
    }
  }
  const saveSize = (): void => {
    const parsed = terminalFontSizeSchema.safeParse(Number(size))
    setErrors((current) => ({
      ...current,
      size: parsed.success
        ? undefined
        : t('settings.fontSizeInvalid', { min: MIN_FONT_SIZE, max: MAX_FONT_SIZE }),
    }))
    if (parsed.success && parsed.data !== settings.terminalFontSize) {
      void update({ terminalFontSize: parsed.data })
    }
  }
  const saveLineHeight = (): void => {
    const parsed = terminalLineHeightSchema.safeParse(Number(lineHeight))
    setErrors((current) => ({
      ...current,
      lineHeight: parsed.success ? undefined : t('settings.lineHeightInvalid'),
    }))
    if (parsed.success && parsed.data !== settings.terminalLineHeight) {
      void update({ terminalLineHeight: parsed.data })
    }
  }
  const onEnter = (save: () => void) => (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') save()
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-sm font-semibold text-muted-foreground">{t('settings.terminal')}</h2>
      <Field label={t('settings.fontFamily')} error={errors.family ?? null}>
        {({ id, describedBy, invalid }) => (
          <>
            <Input
              id={id}
              dir="ltr"
              list={`${id}-fonts`}
              value={family}
              spellCheck={false}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              className="font-mono"
              onChange={(event) => {
                setFamily(event.target.value)
              }}
              onBlur={saveFamily}
              onKeyDown={onEnter(saveFamily)}
            />
            <datalist id={`${id}-fonts`}>
              {FONT_SUGGESTIONS.map((font) => (
                <option key={font} value={font} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      <div className="flex flex-wrap gap-4">
        <Field label={t('settings.fontSize')} error={errors.size ?? null}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              dir="ltr"
              type="number"
              min={MIN_FONT_SIZE}
              max={MAX_FONT_SIZE}
              value={size}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              className="w-28"
              onChange={(event) => {
                setSize(event.target.value)
              }}
              onBlur={saveSize}
              onKeyDown={onEnter(saveSize)}
            />
          )}
        </Field>
        <Field label={t('settings.lineHeight')} error={errors.lineHeight ?? null}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              dir="ltr"
              type="number"
              min={1}
              max={2}
              step={0.05}
              value={lineHeight}
              aria-invalid={invalid}
              aria-describedby={describedBy}
              className="w-28"
              onChange={(event) => {
                setLineHeight(event.target.value)
              }}
              onBlur={saveLineHeight}
              onKeyDown={onEnter(saveLineHeight)}
            />
          )}
        </Field>
      </div>
      <p
        dir="ltr"
        className="rounded-md border border-border bg-muted px-3 py-2 text-start"
        style={{
          fontFamily: settings.terminalFontFamily,
          fontSize: `${String(settings.terminalFontSize)}px`,
          lineHeight: settings.terminalLineHeight,
        }}
      >
        user@server:~$ ls -la /var/www {'{'}0Oo1lI{'}'}
      </p>
      <p className="text-xs text-muted-foreground">
        {t('settings.zoomHint', {
          zoomIn: SHORTCUTS.zoomIn.label,
          zoomOut: SHORTCUTS.zoomOut.label,
          reset: SHORTCUTS.zoomReset.label,
        })}
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.pasteGuard}
          className="mt-0.5 size-4 accent-primary"
          onChange={(event) => void update({ pasteGuard: event.target.checked })}
        />
        <span className="flex flex-col gap-0.5">
          <span>{t('settings.pasteGuard')}</span>
          <span className="text-xs text-muted-foreground">{t('settings.pasteGuardHint')}</span>
        </span>
      </label>
    </div>
  )
}
