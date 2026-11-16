import { DatabaseBackup, Download, LockKeyhole, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AUTO_LOCK_MINUTES, CLIPBOARD_CLEAR_SECONDS } from '@shared/security'
import { autoLockMinutesSchema, clipboardClearSecondsSchema } from '@shared/settings'
import { shortcutOf } from '@renderer/app/shortcuts'
import { Button } from '@renderer/components/ui/button'
import { Field } from '@renderer/components/ui/field'
import { Select } from '@renderer/components/ui/select'
import { useSettingsStore } from '@renderer/stores/settings'
import { useSecurityDialogStore, useVaultStore } from '@renderer/stores/security'

/** Master password, locking, clipboard clearing and backups. */
export function SecuritySettings() {
  const { t, i18n } = useTranslation()
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)
  const status = useVaultStore((state) => state.status)
  const lock = useVaultStore((state) => state.lock)
  const show = useSecurityDialogStore((state) => state.show)
  const hasPassword = status.masterPassword
  const number = (value: number): string => new Intl.NumberFormat(i18n.language).format(value)
  const withShortcut = (label: string, id: Parameters<typeof shortcutOf>[0]): string =>
    t('nav.withShortcut', { label, shortcut: shortcutOf(id).label })

  return (
    <div className="flex flex-col gap-6" data-security-settings="">
      <h2 className="text-sm font-semibold text-muted-foreground">{t('security.title')}</h2>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t('security.masterPassword')}</span>
        <p className="text-xs text-muted-foreground">
          {hasPassword ? t('security.masterPasswordOn') : t('security.masterPasswordOff')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            title={withShortcut(t('commands.masterPassword'), 'masterPassword')}
            onClick={() => {
              show('masterPassword')
            }}
          >
            {hasPassword ? t('security.changeTitle') : t('security.setTitle')}
          </Button>
          {hasPassword && (
            <Button
              variant="outline"
              size="sm"
              title={withShortcut(t('commands.lockNow'), 'lockNow')}
              onClick={() => void lock()}
            >
              <LockKeyhole aria-hidden />
              {t('security.lockNow')}
            </Button>
          )}
        </div>
      </div>

      <Field
        label={t('security.autoLock')}
        hint={hasPassword ? t('security.autoLockHint') : t('security.needsMasterPassword')}
      >
        {({ id, describedBy }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            disabled={!hasPassword}
            value={settings.autoLockMinutes}
            onChange={(event) => {
              const parsed = autoLockMinutesSchema.safeParse(Number(event.target.value))
              if (parsed.success) void update({ autoLockMinutes: parsed.data })
            }}
          >
            {AUTO_LOCK_MINUTES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0
                  ? t('security.never')
                  : t('security.minutes', { count: minutes, value: number(minutes) })}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.lockOnWindowsLock}
          disabled={!hasPassword}
          className="mt-0.5 size-4 accent-primary"
          onChange={(event) => void update({ lockOnWindowsLock: event.target.checked })}
        />
        <span className="flex flex-col gap-0.5">
          <span>{t('security.lockOnWindowsLock')}</span>
          <span className="text-xs text-muted-foreground">
            {t('security.lockOnWindowsLockHint')}
          </span>
        </span>
      </label>

      <Field label={t('security.clipboardClear')} hint={t('security.clipboardClearHint')}>
        {({ id, describedBy }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            value={settings.clipboardClearSeconds}
            onChange={(event) => {
              const parsed = clipboardClearSecondsSchema.safeParse(Number(event.target.value))
              if (parsed.success) void update({ clipboardClearSeconds: parsed.data })
            }}
          >
            {CLIPBOARD_CLEAR_SECONDS.map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds === 0
                  ? t('security.never')
                  : t('security.seconds', { count: seconds, value: number(seconds) })}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t('security.backupsTitle')}</span>
        <p className="text-xs text-muted-foreground">{t('security.backupsHint')}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            title={withShortcut(t('commands.exportData'), 'exportData')}
            onClick={() => {
              show('export')
            }}
          >
            <Download aria-hidden />
            {t('security.exportTitle')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            title={withShortcut(t('commands.importData'), 'importData')}
            onClick={() => {
              show('import')
            }}
          >
            <Upload aria-hidden />
            {t('security.importTitle')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            title={withShortcut(t('commands.restoreBackup'), 'restoreBackup')}
            onClick={() => {
              show('restore')
            }}
          >
            <DatabaseBackup aria-hidden />
            {t('security.restoreTitle')}
          </Button>
        </div>
      </div>
    </div>
  )
}
