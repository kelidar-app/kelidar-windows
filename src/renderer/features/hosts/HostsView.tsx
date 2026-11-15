import {
  KeyRound,
  LockKeyhole,
  MessageSquareMore,
  Pencil,
  Plus,
  Server,
  Trash2,
} from 'lucide-react'
import { useEffect, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { formatTarget } from '@shared/address'
import type { ErrorCode } from '@shared/errors'
import type { HostView } from '@shared/hosts'
import { SHORTCUTS } from '@renderer/app/shortcuts'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { useHostFormStore, useHostsStore } from '@renderer/stores/hosts'
import { QuickConnect } from './QuickConnect'

export function HostsView() {
  const { t } = useTranslation()
  const hosts = useHostsStore((state) => state.hosts)
  const loaded = useHostsStore((state) => state.loaded)
  const error = useHostsStore((state) => state.error)
  const load = useHostsStore((state) => state.load)
  const openNew = useHostFormStore((state) => state.openNew)
  const [deleting, setDeleting] = useState<HostView | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const newHostLabel = t('nav.withShortcut', {
    label: t('hosts.newHost'),
    shortcut: SHORTCUTS.newHost.label,
  })

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-4 border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">{t('hosts.title')}</h1>
          <Button
            title={newHostLabel}
            aria-keyshortcuts={SHORTCUTS.newHost.aria}
            onClick={() => {
              openNew()
            }}
          >
            <Plus aria-hidden />
            {t('hosts.newHost')}
          </Button>
        </div>
        <QuickConnect />
      </div>

      {error !== null && (
        <p
          role="alert"
          className="mx-6 mt-4 rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
        >
          {t(`errors.${error}`)}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {loaded && error === null && hosts.length === 0 ? (
          <EmptyState />
        ) : (
          <ul aria-label={t('hosts.listLabel')} className="flex flex-col gap-1.5">
            {hosts.map((host) => (
              <HostRow
                key={host.id}
                host={host}
                onDelete={() => {
                  setDeleting(host)
                }}
              />
            ))}
          </ul>
        )}
      </div>

      <DeleteHostDialog
        host={deleting}
        onClose={() => {
          setDeleting(null)
        }}
      />
    </section>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <Server aria-hidden className="size-7" />
      </div>
      <div className="flex max-w-md flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('hosts.emptyTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('hosts.emptyBody')}</p>
      </div>
    </div>
  )
}

function SignInIcon({ host }: { host: HostView }) {
  const { t } = useTranslation()
  const { method } = host.signIn
  const Icon = method === 'key' ? KeyRound : method === 'password' ? LockKeyhole : MessageSquareMore
  const label =
    method === 'key'
      ? t('hosts.signInKey')
      : method === 'password'
        ? t('hosts.signInPassword')
        : t('hosts.signInAsk')
  return <Icon aria-label={label} className="size-4 shrink-0 text-muted-foreground" />
}

function HostRow({ host, onDelete }: { host: HostView; onDelete: () => void }) {
  const { t } = useTranslation()
  const openEdit = useHostFormStore((state) => state.openEdit)
  const target = formatTarget(host)

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>): void => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Delete') {
      event.preventDefault()
      onDelete()
    } else if (event.key.toLowerCase() === 'e' && event.ctrlKey) {
      event.preventDefault()
      openEdit(host)
    }
  }

  return (
    <li
      tabIndex={0}
      aria-label={t('hosts.rowLabel', { name: host.name, target })}
      aria-keyshortcuts="Control+E Delete"
      data-host-id={host.id}
      onKeyDown={onKeyDown}
      className="group flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 hover:bg-muted"
    >
      <Server aria-hidden className="size-4 shrink-0 text-primary" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{host.name}</span>
        <span dir="ltr" className="truncate text-start font-mono text-xs text-muted-foreground">
          {target}
        </span>
      </div>
      <SignInIcon host={host} />
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('hosts.edit', { name: host.name })}
        title={t('nav.withShortcut', { label: t('common.edit'), shortcut: 'Ctrl+E' })}
        onClick={() => {
          openEdit(host)
        }}
      >
        <Pencil aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('hosts.delete', { name: host.name })}
        title={t('nav.withShortcut', { label: t('common.delete'), shortcut: 'Delete' })}
        onClick={onDelete}
      >
        <Trash2 aria-hidden />
      </Button>
    </li>
  )
}

function DeleteHostDialog({ host, onClose }: { host: HostView | null; onClose: () => void }) {
  const { t } = useTranslation()
  const remove = useHostsStore((state) => state.remove)
  const [error, setError] = useState<ErrorCode | null>(null)

  return (
    <Dialog
      open={host !== null}
      onClose={() => {
        setError(null)
        onClose()
      }}
      role="alertdialog"
      title={t('hosts.deleteTitle', { name: host?.name ?? '' })}
      description={t('hosts.deleteBody')}
      footer={
        <>
          {error !== null && (
            <p role="alert" className="me-auto text-sm text-destructive">
              {t(`errors.${error}`)}
            </p>
          )}
          <Button variant="outline" autoFocus onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              if (host === null) return
              void remove(host.id).then((result) => {
                if (result.ok) {
                  setError(null)
                  onClose()
                } else setError(result.code)
              })
            }}
          >
            {t('common.delete')}
          </Button>
        </>
      }
    />
  )
}
