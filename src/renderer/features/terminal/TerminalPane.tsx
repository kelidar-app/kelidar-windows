import {
  CircleAlert,
  Info,
  LoaderCircle,
  Pencil,
  PlugZap,
  RotateCw,
  Save,
  ShieldAlert,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatTarget } from '@shared/address'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { api } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { useHostFormStore, useHostsStore } from '@renderer/stores/hosts'
import { useTabsStore, type TerminalTab } from '@renderer/stores/tabs'
import { TerminalView } from './TerminalView'

/** A terminal tab: a status banner (while not connected) above the terminal. */
export function TerminalPane({ tab, active }: { tab: TerminalTab; active: boolean }) {
  return (
    <section
      hidden={!active}
      aria-label={tab.customTitle ?? tab.title}
      className={cn('min-h-0 flex-1 flex-col', active ? 'flex' : 'hidden')}
    >
      {tab.state === 'reconnecting' ? (
        <ReconnectingBanner tab={tab} />
      ) : (
        <SessionBanner tab={tab} />
      )}
      {tab.state === 'ready' && tab.sticky === 'unavailable' && <TmuxMissingBar />}
      {tab.source.kind === 'quick' && tab.state === 'ready' && <SaveHostBar tab={tab} />}
      <TerminalView tab={tab} active={active} />
    </section>
  )
}

/** The connection dropped: count down to the next try, and offer to try now. */
function ReconnectingBanner({ tab }: { tab: TerminalTab }) {
  const { t } = useTranslation()
  const reconnectNow = useTabsStore((state) => state.reconnectNow)
  const close = useTabsStore((state) => state.close)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])
  const target = formatTarget(tab.target)
  const attempt = tab.reconnecting?.attempt ?? 1
  const seconds = Math.max(0, Math.ceil(((tab.reconnecting?.retryAt ?? now) - now) / 1000))
  return (
    <div
      role="status"
      data-session-banner="reconnecting"
      className="flex flex-wrap items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm"
    >
      <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-amber-600" />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="font-medium">{t('terminal.connectionLost', { target })}</p>
        <p className="text-muted-foreground">
          {seconds > 0
            ? t('terminal.reconnectingIn', { count: seconds, attempt })
            : t('terminal.reconnectingNow', { attempt })}
        </p>
      </div>
      <Button
        size="sm"
        onClick={() => {
          reconnectNow(tab.id)
        }}
      >
        <RotateCw aria-hidden />
        {t('terminal.reconnectNow')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          close(tab.id)
        }}
      >
        <X aria-hidden />
        {t('terminal.closeTab')}
      </Button>
    </div>
  )
}

/** Sticky session asked for, but the server has no tmux: a normal shell opened. */
function TmuxMissingBar() {
  const { t } = useTranslation()
  const [hidden, setHidden] = useState(false)
  if (hidden) return null
  return (
    <div
      role="status"
      className="flex items-start gap-3 border-b border-border bg-muted px-4 py-2 text-sm"
    >
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p>{t('terminal.tmuxMissing')}</p>
        <p className="text-xs text-muted-foreground">{t('terminal.tmuxInstall')}</p>
        <ul dir="ltr" className="flex flex-col gap-0.5 text-start font-mono text-xs select-text">
          <li>sudo apt install tmux</li>
          <li>sudo dnf install tmux</li>
          <li>sudo apk add tmux</li>
        </ul>
      </div>
      <Button
        size="icon"
        variant="ghost"
        aria-label={t('common.close')}
        onClick={() => {
          setHidden(true)
        }}
      >
        <X aria-hidden />
      </Button>
    </div>
  )
}

/** Quick Connect saved nothing; offer to save the host once connected. */
function SaveHostBar({ tab }: { tab: TerminalTab }) {
  const { t } = useTranslation()
  const openNew = useHostFormStore((state) => state.openNew)
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-muted px-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{t('quickConnect.notSaved')}</span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          openNew({ ...tab.target, sessionId: tab.sessionId })
        }}
      >
        <Save aria-hidden />
        {t('quickConnect.saveHost')}
      </Button>
    </div>
  )
}

function SessionBanner({ tab }: { tab: TerminalTab }) {
  const { t } = useTranslation()
  const reconnect = useTabsStore((state) => state.reconnect)
  const close = useTabsStore((state) => state.close)
  const [confirmForget, setConfirmForget] = useState(false)
  const openEdit = useHostFormStore((state) => state.openEdit)
  const target = formatTarget(tab.target)
  const source = tab.source
  // A sign-in problem on a saved host: the fix is in the host settings.
  const canEditHost =
    source.kind === 'host' && (tab.error === 'SSH_AUTH_FAILED' || tab.error === 'KEY_REQUIRED')
  const editHost = async (): Promise<void> => {
    if (source.kind !== 'host') return
    const store = useHostsStore.getState()
    if (!store.loaded) await store.load()
    const host = useHostsStore.getState().hosts.find((item) => item.id === source.hostId)
    if (host !== undefined) openEdit(host)
  }

  if (tab.state === 'ready') return null

  if (
    tab.state === 'connecting' ||
    tab.state === 'verifying-host-key' ||
    tab.state === 'authenticating'
  ) {
    const text =
      tab.state === 'connecting'
        ? t('terminal.connecting', { target })
        : tab.state === 'verifying-host-key'
          ? t('terminal.verifying')
          : t('terminal.authenticating')
    return (
      <div
        role="status"
        className="flex items-center gap-2 border-b border-border bg-muted px-4 py-2 text-sm"
      >
        <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-primary" />
        <span dir="auto">{text}</span>
      </div>
    )
  }

  const hostKeyChanged = tab.error === 'SSH_HOST_KEY_CHANGED'
  const Icon = hostKeyChanged ? ShieldAlert : tab.state === 'error' ? CircleAlert : PlugZap
  return (
    <div
      role={tab.state === 'error' ? 'alert' : 'status'}
      data-session-banner={tab.state}
      className={cn(
        'flex flex-col gap-3 border-b px-4 py-3 text-sm',
        tab.state === 'error' ? 'border-destructive bg-destructive/10' : 'border-border bg-muted',
      )}
    >
      <div className="flex items-start gap-2">
        <Icon
          aria-hidden
          className={cn(
            'mt-0.5 size-4 shrink-0',
            tab.state === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium">
            {tab.state === 'error'
              ? t('terminal.failed', { target })
              : t('terminal.disconnected', { target })}
          </p>
          {tab.error !== undefined && (
            <p>
              {tab.via === undefined
                ? t(`errors.${tab.error}`)
                : t('terminal.onJumpHost', { name: tab.via, message: t(`errors.${tab.error}`) })}
            </p>
          )}
          {hostKeyChanged && tab.hostKey !== undefined && (
            <p className="text-xs">
              {t('terminal.newFingerprint')}{' '}
              <span dir="ltr" className="font-mono break-all select-text">
                {tab.hostKey.fingerprint}
              </span>
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {!hostKeyChanged && (
          <Button
            size="sm"
            autoFocus
            onClick={() => {
              void reconnect(tab.id)
            }}
          >
            <RotateCw aria-hidden />
            {t('terminal.reconnect')}
          </Button>
        )}
        {canEditHost && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void editHost()
            }}
          >
            <Pencil aria-hidden />
            {t('terminal.editHost')}
          </Button>
        )}
        {hostKeyChanged && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setConfirmForget(true)
            }}
          >
            {t('terminal.forgetKey')}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            close(tab.id)
          }}
        >
          <X aria-hidden />
          {t('terminal.closeTab')}
        </Button>
      </div>
      <Dialog
        open={confirmForget}
        onClose={() => {
          setConfirmForget(false)
        }}
        role="alertdialog"
        title={t('terminal.forgetKeyTitle')}
        description={t('terminal.forgetKeyBody', { target })}
        footer={
          <>
            <Button
              variant="outline"
              autoFocus
              onClick={() => {
                setConfirmForget(false)
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmForget(false)
                // The server whose key changed: a jump host or the target.
                const server = tab.hostKey ?? { host: tab.target.address, port: tab.target.port }
                void api
                  .invoke('knownHosts:forget', { host: server.host, port: server.port })
                  .then((result) => {
                    if (result.ok) void reconnect(tab.id)
                  })
              }}
            >
              {t('terminal.forgetKeyConfirm')}
            </Button>
          </>
        }
      />
    </div>
  )
}
