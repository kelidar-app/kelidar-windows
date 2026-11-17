import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { OS_RELEASE_COMMAND } from '@shared/host-extras'
import { shortcutOf } from '@renderer/app/shortcuts'
import { Button } from '@renderer/components/ui/button'
import { useImportStore } from '@renderer/stores/import'
import { useSettingsStore } from '@renderer/stores/settings'

/** System detection (with the exact command it runs) and importing hosts. */
export function HostSettings() {
  const { t } = useTranslation()
  const detectOs = useSettingsStore((state) => state.settings.detectOs)
  const update = useSettingsStore((state) => state.update)
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-sm font-semibold text-muted-foreground">{t('settings.hosts')}</h2>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={detectOs}
          className="mt-0.5 size-4 accent-primary"
          onChange={(event) => void update({ detectOs: event.target.checked })}
        />
        <span className="flex flex-col gap-0.5">
          <span>{t('settings.detectOs')}</span>
          <span className="text-xs text-muted-foreground">
            {t('settings.detectOsHint')}{' '}
            <code dir="ltr" className="rounded bg-muted px-1 font-mono">
              {OS_RELEASE_COMMAND}
            </code>
          </span>
        </span>
      </label>
      <div className="flex flex-col items-start gap-2">
        <p className="text-xs text-muted-foreground">
          {t('settings.importHint', { path: '~/.ssh/config' })}
        </p>
        <Button
          variant="outline"
          size="sm"
          title={t('nav.withShortcut', {
            label: t('commands.importHosts'),
            shortcut: shortcutOf('importHosts').label,
          })}
          onClick={() => {
            useImportStore.getState().open({ kind: 'preview' })
          }}
        >
          <Download aria-hidden />
          {t('import.title')}
        </Button>
      </div>
    </div>
  )
}
