import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ErrorCode } from '@shared/errors'
import type { HostView } from '@shared/hosts'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { FormError } from '@renderer/components/ui/form-dialog'
import { OsBadge } from '@renderer/features/hosts/OsBadge'
import { api } from '@renderer/lib/api'
import { useHostFormStore } from '@renderer/stores/hosts'

/** A host's notes, links and system. Links open in the browser (http and https only). */
export function HostInfoDialog({ host, onDone }: { host: HostView; onDone: () => void }) {
  const { t } = useTranslation()
  const [failure, setFailure] = useState<ErrorCode | null>(null)
  const openLink = async (url: string): Promise<void> => {
    const result = await api.invoke('app:openExternal', { url })
    setFailure(result.ok ? null : result.error.code)
  }

  return (
    <Dialog
      open
      onClose={onDone}
      title={t('hostInfo.title', { name: host.name })}
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => {
              onDone()
              useHostFormStore.getState().openEdit(host)
            }}
          >
            {t('common.edit')}
          </Button>
          <Button data-autofocus onClick={onDone}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {host.os !== undefined && (
          <div className="flex items-center gap-2 text-sm">
            <OsBadge os={host.os} className="size-6 text-xs" />
            <span dir="auto">{host.os.name}</span>
          </div>
        )}
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold text-muted-foreground">{t('hostInfo.notes')}</h3>
          {host.notes === undefined ? (
            <p className="text-sm text-muted-foreground">{t('hostInfo.noNotes')}</p>
          ) : (
            <p dir="auto" className="text-sm whitespace-pre-wrap" data-host-notes="">
              {host.notes}
            </p>
          )}
        </section>
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold text-muted-foreground">{t('hostInfo.links')}</h3>
          {host.links.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('hostInfo.noLinks')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {host.links.map((link) => (
                <li key={link.url}>
                  <button
                    type="button"
                    className="flex max-w-full items-center gap-2 rounded text-sm text-primary hover:underline"
                    title={link.url}
                    onClick={() => void openLink(link.url)}
                  >
                    <ExternalLink aria-hidden className="size-4 shrink-0" />
                    <span dir="auto" className="truncate">
                      {link.title ?? link.url}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <FormError message={failure === null ? undefined : t(`errors.${failure}`)} />
      </div>
    </Dialog>
  )
}
