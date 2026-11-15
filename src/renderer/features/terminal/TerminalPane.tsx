import { CircleAlert, LoaderCircle, PlugZap, RotateCw, Save, ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatTarget } from '@shared/address'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { api } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { useHostFormStore } from '@renderer/stores/hosts'
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
      <SessionBanner tab={tab} />
      {tab.source.kind === 'quick' && tab.state === 'ready' && <SaveHostBar tab={tab} />}
      <TerminalView tab={tab} active={active} />
    </section>
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
  const target = formatTarget(tab.target)

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
          {tab.error !== undefined && <p>{t(`errors.${tab.error}`)}</p>}
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
                void api
                  .invoke('knownHosts:forget', { host: tab.target.address, port: tab.target.port })
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
