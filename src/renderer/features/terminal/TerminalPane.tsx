import {
  CircleAlert,
  Info,
  KeyRound,
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
import type { ErrorCode } from '@shared/errors'
import { SHORTCUTS } from '@renderer/app/shortcuts'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { api } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { useHostFormStore, useHostsStore } from '@renderer/stores/hosts'
import { useTabsStore, type Pane } from '@renderer/stores/tabs'
import { TerminalView } from './TerminalView'
import { ENVIRONMENT_BORDER, usePaneEnvironment } from './use-environment'

/**
 * One pane: status banners above the terminal, a sudo bar below it, and a
 * border in the host's environment color (production red…).
 */
export function TerminalPane({
  pane,
  visible,
  focused,
  split,
}: {
  pane: Pane
  /** Its tab is the active one. */
  visible: boolean
  focused: boolean
  /** The tab has more than one pane: the focused one gets a ring. */
  split: boolean
}) {
  const { t } = useTranslation()
  const environment = usePaneEnvironment(pane)
  const focusPane = useTabsStore((state) => state.focusPane)
  return (
    <section
      aria-label={pane.title}
      data-pane-id={pane.id}
      data-pane-state={pane.state}
      data-focused={focused ? '' : undefined}
      data-environment={environment}
      onMouseDown={() => {
        focusPane(pane.id)
      }}
      className={cn(
        'relative flex min-h-0 min-w-0 flex-1 flex-col',
        environment !== undefined && cn('border-2', ENVIRONMENT_BORDER[environment]),
        split && focused && 'outline-2 -outline-offset-2 outline-ring',
      )}
    >
      {environment === 'production' && (
        <span className="sr-only">{t('terminal.productionPane')}</span>
      )}
      {pane.state === 'reconnecting' ? (
        <ReconnectingBanner pane={pane} />
      ) : (
        <SessionBanner pane={pane} />
      )}
      {pane.state === 'ready' && pane.sticky === 'unavailable' && <TmuxMissingBar />}
      {pane.source.kind === 'quick' && pane.state === 'ready' && <SaveHostBar pane={pane} />}
      <TerminalView pane={pane} visible={visible} focused={focused} />
      {pane.state === 'ready' && pane.sudo?.canFill === true && <SudoBar pane={pane} />}
    </section>
  )
}

/**
 * sudo asks for a password: offer the hotkey. Main types the saved password
 * only when the hotkey is pressed, never on its own.
 */
function SudoBar({ pane }: { pane: Pane }) {
  const { t } = useTranslation()
  const [error, setError] = useState<ErrorCode | null>(null)
  const fill = (): void => {
    void api.invoke('session:fillSudo', { sessionId: pane.sessionId }).then((result) => {
      setError(result.ok ? null : result.error.code)
    })
  }
  return (
    <div
      role="status"
      data-sudo-bar=""
      className="flex flex-wrap items-center gap-3 border-t border-border bg-muted px-4 py-1.5 text-sm"
    >
      <KeyRound aria-hidden className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        {error === null ? t('terminal.sudoAsks') : t(`errors.${error}`)}
      </span>
      <Button size="sm" variant="outline" onClick={fill}>
        {t('terminal.sudoFill', { shortcut: SHORTCUTS.fillSudo.label })}
      </Button>
    </div>
  )
}

/** The connection dropped: count down to the next try, and offer to try now. */
function ReconnectingBanner({ pane }: { pane: Pane }) {
  const { t } = useTranslation()
  const reconnectNow = useTabsStore((state) => state.reconnectNow)
  const close = useTabsStore((state) => state.closePane)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])
  const target = formatTarget(pane.target)
  const attempt = pane.reconnecting?.attempt ?? 1
  const seconds = Math.max(0, Math.ceil(((pane.reconnecting?.retryAt ?? now) - now) / 1000))
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
          reconnectNow(pane.id)
        }}
      >
        <RotateCw aria-hidden />
        {t('terminal.reconnectNow')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          close(pane.id)
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
function SaveHostBar({ pane }: { pane: Pane }) {
  const { t } = useTranslation()
  const openNew = useHostFormStore((state) => state.openNew)
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-muted px-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{t('quickConnect.notSaved')}</span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          openNew({ ...pane.target, sessionId: pane.sessionId })
        }}
      >
        <Save aria-hidden />
        {t('quickConnect.saveHost')}
      </Button>
    </div>
  )
}

function SessionBanner({ pane }: { pane: Pane }) {
  const { t } = useTranslation()
  const reconnect = useTabsStore((state) => state.reconnect)
  const close = useTabsStore((state) => state.closePane)
  const [confirmForget, setConfirmForget] = useState(false)
  const openEdit = useHostFormStore((state) => state.openEdit)
  const target = formatTarget(pane.target)
  const source = pane.source
  // A sign-in problem on a saved host: the fix is in the host settings.
  const canEditHost =
    source.kind === 'host' && (pane.error === 'SSH_AUTH_FAILED' || pane.error === 'KEY_REQUIRED')
  const editHost = async (): Promise<void> => {
    if (source.kind !== 'host') return
    const store = useHostsStore.getState()
    if (!store.loaded) await store.load()
    const host = useHostsStore.getState().hosts.find((item) => item.id === source.hostId)
    if (host !== undefined) openEdit(host)
  }

  if (pane.state === 'ready') return null

  if (
    pane.state === 'connecting' ||
    pane.state === 'verifying-host-key' ||
    pane.state === 'authenticating'
  ) {
    const text =
      pane.state === 'connecting'
        ? t('terminal.connecting', { target })
        : pane.state === 'verifying-host-key'
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

  const hostKeyChanged = pane.error === 'SSH_HOST_KEY_CHANGED'
  const Icon = hostKeyChanged ? ShieldAlert : pane.state === 'error' ? CircleAlert : PlugZap
  return (
    <div
      role={pane.state === 'error' ? 'alert' : 'status'}
      data-session-banner={pane.state}
      className={cn(
        'flex flex-col gap-3 border-b px-4 py-3 text-sm',
        pane.state === 'error' ? 'border-destructive bg-destructive/10' : 'border-border bg-muted',
      )}
    >
      <div className="flex items-start gap-2">
        <Icon
          aria-hidden
          className={cn(
            'mt-0.5 size-4 shrink-0',
            pane.state === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium">
            {pane.state === 'error'
              ? t('terminal.failed', { target })
              : t('terminal.disconnected', { target })}
          </p>
          {pane.error !== undefined && (
            <p>
              {pane.via === undefined
                ? t(`errors.${pane.error}`)
                : t('terminal.onJumpHost', { name: pane.via, message: t(`errors.${pane.error}`) })}
            </p>
          )}
          {hostKeyChanged && pane.hostKey !== undefined && (
            <p className="text-xs">
              {t('terminal.newFingerprint')}{' '}
              <span dir="ltr" className="font-mono break-all select-text">
                {pane.hostKey.fingerprint}
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
              void reconnect(pane.id)
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
            close(pane.id)
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
                const server = pane.hostKey ?? { host: pane.target.address, port: pane.target.port }
                void api
                  .invoke('knownHosts:forget', { host: server.host, port: server.port })
                  .then((result) => {
                    if (result.ok) void reconnect(pane.id)
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
