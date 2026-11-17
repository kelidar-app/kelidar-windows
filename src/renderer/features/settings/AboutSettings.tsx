import { Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { APP } from '@shared/app'
import { shortcutOf } from '@renderer/app/shortcuts'
import { Button } from '@renderer/components/ui/button'
import { useSettingsStore } from '@renderer/stores/settings'
import { useUpdatesStore } from '@renderer/stores/updates'

/** The version, updates from GitHub Releases, and the release notes of a new version. */
export function AboutSettings() {
  const { t, i18n } = useTranslation()
  const status = useUpdatesStore((state) => state.status)
  const check = useUpdatesStore((state) => state.check)
  const restart = useUpdatesStore((state) => state.restart)
  const checkUpdates = useSettingsStore((state) => state.settings.checkUpdates)
  const update = useSettingsStore((state) => state.update)
  if (status === null) return null

  const when =
    status.checkedAt === undefined
      ? undefined
      : new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(status.checkedAt),
        )
  const line = (() => {
    switch (status.state) {
      case 'disabled':
        return t('updates.disabled')
      case 'idle':
        return t('updates.idle')
      case 'checking':
        return t('updates.checking')
      case 'upToDate':
        return t('updates.upToDate', { when: when ?? '' })
      case 'downloading':
        return t('updates.downloading', {
          version: status.version ?? '',
          percent: Math.round(status.percent ?? 0),
        })
      case 'ready':
        return t('updates.ready', { version: status.version ?? '' })
      case 'error':
        return t(`errors.${status.error ?? 'UPDATE_CHECK_FAILED'}`)
    }
  })()
  const busy = status.state === 'checking' || status.state === 'downloading'

  return (
    <div className="flex flex-col gap-4" data-about-settings="">
      <h2 className="text-sm font-semibold text-muted-foreground">
        {t('updates.title', { app: APP.name })}
      </h2>
      <p className="text-sm">
        {t('updates.version')}{' '}
        <span dir="ltr" className="font-mono" data-app-version="">
          {status.currentVersion}
        </span>
      </p>
      <div className="flex flex-col gap-2">
        <p
          role="status"
          data-update-state={status.state}
          className={status.state === 'error' ? 'text-sm text-destructive' : 'text-sm'}
        >
          {line}
        </p>
        {status.state === 'downloading' && (
          <progress
            className="h-1.5 w-full max-w-sm accent-primary"
            max={100}
            value={status.percent ?? 0}
            aria-label={t('updates.progress')}
          />
        )}
        {status.notes !== undefined &&
          (status.state === 'ready' || status.state === 'downloading') && (
            <section className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold text-muted-foreground">
                {t('updates.notes', { version: status.version ?? '' })}
              </h3>
              <p
                dir="auto"
                data-release-notes=""
                className="max-h-48 overflow-y-auto rounded-md border border-border bg-muted px-3 py-2 text-sm whitespace-pre-wrap"
              >
                {status.notes}
              </p>
            </section>
          )}
        <div className="flex flex-wrap gap-2">
          {status.state === 'ready' ? (
            <Button
              size="sm"
              title={t('nav.withShortcut', {
                label: t('commands.installUpdate'),
                shortcut: shortcutOf('installUpdate').label,
              })}
              onClick={restart}
            >
              <RotateCcw aria-hidden />
              {t('updates.restart')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={status.state === 'disabled' || busy}
              title={t('nav.withShortcut', {
                label: t('commands.checkUpdates'),
                shortcut: shortcutOf('checkUpdates').label,
              })}
              onClick={() => void check()}
            >
              {busy ? <Loader2 aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />}
              {t('updates.check')}
            </Button>
          )}
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={checkUpdates}
          className="mt-0.5 size-4 accent-primary"
          onChange={(event) => void update({ checkUpdates: event.target.checked })}
        />
        <span className="flex flex-col gap-0.5">
          <span>{t('updates.onStart')}</span>
          <span className="text-xs text-muted-foreground">{t('updates.onStartHint')}</span>
        </span>
      </label>
    </div>
  )
}
