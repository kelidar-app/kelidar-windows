import {
  ClipboardCopy,
  KeyRound,
  LockKeyhole,
  MessageSquareMore,
  Pencil,
  NotebookText,
  Play,
  Star,
  Trash2,
  Usb,
  UserRound,
} from 'lucide-react'
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { formatTarget } from '@shared/address'
import type { HostView } from '@shared/hosts'
import type { Environment } from '@shared/records'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/cn'
import { useGroupFormStore, useHostFormStore, useHostsStore } from '@renderer/stores/hosts'
import { useKeychainDialogStore } from '@renderer/stores/keychain'
import { useImportStore } from '@renderer/stores/import'
import { copySavedPassword } from '@renderer/stores/security'
import { useTabsStore } from '@renderer/stores/tabs'
import { useUiStore } from '@renderer/stores/ui'
import { COLOR_EDGE, ENVIRONMENT_BADGE } from './colors'
import { DRAG_TYPE, hostDragItem, useDragStore } from './drag'
import { canUpgradeToKey, HOST_KEYS } from './host-keys'
import { OsBadge } from './OsBadge'

export type HostLayout = 'cards' | 'list'

function SignInIcon({ host }: { host: HostView }) {
  const { t } = useTranslation()
  const { method } = host.signIn
  if (host.identity !== undefined) {
    const label = t('hosts.signInIdentity', { name: host.identity.name })
    return <UserRound aria-label={label} className="size-4 shrink-0 text-muted-foreground" />
  }
  const Icon =
    method === 'key'
      ? KeyRound
      : method === 'password'
        ? LockKeyhole
        : method === 'agent'
          ? Usb
          : MessageSquareMore
  const label =
    method === 'key'
      ? t('hosts.signInKey')
      : method === 'password'
        ? t('hosts.signInPassword')
        : method === 'agent'
          ? t('hosts.signInAgent')
          : t('hosts.signInAsk')
  return <Icon aria-label={label} className="size-4 shrink-0 text-muted-foreground" />
}

export function EnvironmentBadge({ environment }: { environment: Environment }) {
  const { t } = useTranslation()
  return (
    <span
      data-environment={environment}
      className={cn(
        'shrink-0 rounded border px-1.5 py-px text-[0.6875rem] leading-4 font-medium',
        ENVIRONMENT_BADGE[environment],
      )}
    >
      {t(`environments.${environment}`)}
    </span>
  )
}

function TagChips({ tags }: { tags: readonly string[] }) {
  const { t } = useTranslation()
  const setHostQuery = useUiStore((state) => state.setHostQuery)
  if (tags.length === 0) return null
  return (
    <ul aria-label={t('hosts.tags')} className="flex min-w-0 flex-wrap gap-1">
      {tags.map((tag) => (
        <li key={tag}>
          <button
            type="button"
            dir="auto"
            title={t('hosts.filterByTag', { tag })}
            className="rounded bg-muted px-1.5 py-px text-[0.6875rem] leading-4 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setHostQuery(`#${tag}`)
            }}
          >
            #{tag}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Moves focus to the next or previous host in the list (Up and Down arrows). */
function moveFocus(from: HTMLElement, step: 1 | -1 | 'first' | 'last'): void {
  const container = from.closest('[data-host-list]')
  if (container === null) return
  const items = [...container.querySelectorAll<HTMLElement>('[data-host-item]')].filter(
    (item) => item.offsetParent !== null,
  )
  const index = items.indexOf(from)
  const target =
    step === 'first'
      ? items[0]
      : step === 'last'
        ? items.at(-1)
        : items[Math.min(Math.max(index + step, 0), items.length - 1)]
  target?.focus()
}

/** One saved host, as a card or as a compact row. */
export function HostItem({ host, layout }: { host: HostView; layout: HostLayout }) {
  const { t } = useTranslation()
  const openEdit = useHostFormStore((state) => state.openEdit)
  const openHost = useTabsStore((state) => state.openHost)
  const setFavorite = useHostsStore((state) => state.setFavorite)
  const askDeleteHost = useGroupFormStore((state) => state.askDeleteHost)
  const openKeychainDialog = useKeychainDialogStore((state) => state.open)
  const target = formatTarget(host)
  const connect = (): void => {
    void openHost(host.id)
  }
  const toggleFavorite = (): void => {
    void setFavorite(host.id, !host.favorite)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>): void => {
    if (event.target !== event.currentTarget) return
    const key = event.key
    const code = event.code
    if (key === 'Enter') {
      event.preventDefault()
      connect()
    } else if (key === 'Delete') {
      event.preventDefault()
      askDeleteHost(host)
    } else if (code === 'KeyE' && event.ctrlKey) {
      event.preventDefault()
      openEdit(host)
    } else if (code === 'KeyD' && event.ctrlKey) {
      event.preventDefault()
      toggleFavorite()
    } else if (code === 'KeyI' && event.ctrlKey && !event.shiftKey) {
      event.preventDefault()
      useImportStore.getState().open({ kind: 'hostInfo', host })
    } else if (code === 'KeyU' && event.ctrlKey && canUpgradeToKey(host)) {
      event.preventDefault()
      openKeychainDialog({ kind: 'upgrade', host })
    } else if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      event.preventDefault()
      moveFocus(
        event.currentTarget,
        key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : key === 'Home' ? 'first' : 'last',
      )
    }
  }

  const onDoubleClick = (event: MouseEvent<HTMLLIElement>): void => {
    if (!(event.target instanceof Element) || event.target.closest('button') === null) connect()
  }

  const favoriteLabel = host.favorite
    ? t('hosts.unfavorite', { name: host.name })
    : t('hosts.favorite', { name: host.name })

  const hasInfo = host.notes !== undefined || host.links.length > 0
  const actions = (
    <>
      {hasInfo && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('hostInfo.openFor', { name: host.name })}
          title={t('nav.withShortcut', {
            label: t('hostInfo.open'),
            shortcut: HOST_KEYS.info,
          })}
          onClick={() => {
            useImportStore.getState().open({ kind: 'hostInfo', host })
          }}
        >
          <NotebookText aria-hidden />
        </Button>
      )}
      {host.signIn.method === 'password' && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('security.copyPasswordOf', { name: host.name })}
          title={t('nav.withShortcut', {
            label: t('security.copyPassword'),
            shortcut: HOST_KEYS.copyPassword,
          })}
          onClick={() => void copySavedPassword('host', host.id)}
        >
          <ClipboardCopy aria-hidden />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label={favoriteLabel}
        aria-pressed={host.favorite}
        title={t('nav.withShortcut', {
          label: host.favorite ? t('hosts.unfavoriteShort') : t('hosts.favoriteShort'),
          shortcut: HOST_KEYS.favorite,
        })}
        onClick={toggleFavorite}
      >
        <Star aria-hidden className={cn(host.favorite && 'fill-amber-400 text-amber-500')} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('hosts.edit', { name: host.name })}
        title={t('nav.withShortcut', { label: t('common.edit'), shortcut: HOST_KEYS.edit })}
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
        title={t('nav.withShortcut', { label: t('common.delete'), shortcut: HOST_KEYS.remove })}
        onClick={() => {
          askDeleteHost(host)
        }}
      >
        <Trash2 aria-hidden />
      </Button>
    </>
  )

  const connectButton = (
    <Button
      size="sm"
      aria-label={t('hosts.connect', { name: host.name })}
      title={t('nav.withShortcut', { label: t('hosts.connectShort'), shortcut: HOST_KEYS.connect })}
      onClick={connect}
    >
      <Play aria-hidden />
      {t('hosts.connectShort')}
    </Button>
  )

  const common = {
    // Drag onto a group's header to move the host into that group.
    draggable: true,
    onDragStart: (event: DragEvent<HTMLLIElement>) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData(DRAG_TYPE, host.id)
      useDragStore.getState().start(hostDragItem(host))
    },
    onDragEnd: () => {
      useDragStore.getState().end()
    },
    tabIndex: 0,
    'aria-label': t('hosts.rowLabel', { name: host.name, target }),
    'aria-keyshortcuts': 'Enter Control+E Control+D Control+I Delete Control+Shift+A',
    'data-host-id': host.id,
    'data-host-item': '',
    onKeyDown,
    onDoubleClick,
  }
  const edge = host.color === undefined ? undefined : cn('border-s-4', COLOR_EDGE[host.color])

  if (layout === 'list') {
    return (
      <li
        {...common}
        className={cn(
          'group flex items-center gap-3 rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted',
          edge,
        )}
      >
        <OsBadge os={host.os} className="size-5 text-[0.625rem]" />
        <span className="min-w-0 shrink truncate text-sm font-medium">{host.name}</span>
        <span
          dir="ltr"
          className="min-w-0 flex-1 truncate text-start font-mono text-xs text-muted-foreground"
        >
          {target}
        </span>
        {host.jump !== undefined && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {t('hosts.via', { name: host.jump.name })}
          </span>
        )}
        {host.environment !== undefined && <EnvironmentBadge environment={host.environment} />}
        <div className="hidden max-w-[30%] lg:block">
          <TagChips tags={host.tags} />
        </div>
        <SignInIcon host={host} />
        {connectButton}
        {actions}
      </li>
    )
  }

  return (
    <li
      {...common}
      className={cn(
        'group flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3 hover:bg-muted',
        edge,
      )}
    >
      <div className="flex items-start gap-2">
        <OsBadge os={host.os} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{host.name}</span>
          <span dir="ltr" className="truncate text-start font-mono text-xs text-muted-foreground">
            {target}
          </span>
          {host.jump !== undefined && (
            <span className="truncate text-xs text-muted-foreground">
              {t('hosts.via', { name: host.jump.name })}
            </span>
          )}
        </div>
        <SignInIcon host={host} />
      </div>
      {(host.environment !== undefined || host.tags.length > 0) && (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {host.environment !== undefined && <EnvironmentBadge environment={host.environment} />}
          <TagChips tags={host.tags} />
        </div>
      )}
      <div className="mt-auto flex items-center gap-1">
        {connectButton}
        <div className="ms-auto flex items-center">{actions}</div>
      </div>
    </li>
  )
}
