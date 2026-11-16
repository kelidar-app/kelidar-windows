import { House, KeyRound, LockKeyhole, Plus, Search, X } from 'lucide-react'
import { useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionState } from '@shared/session'
import { cn } from '@renderer/lib/cn'
import { paneIds } from '@renderer/features/terminal/layout'
import { TAB_DRAG_TYPE, useTabDragStore } from '@renderer/features/terminal/tab-drag'
import { ENVIRONMENT_TAB, usePaneEnvironment } from '@renderer/features/terminal/use-environment'
import {
  focusedPane,
  HOME_TAB,
  tabTitle,
  useTabsStore,
  type TerminalTab,
} from '@renderer/stores/tabs'
import { useVaultStore } from '@renderer/stores/security'
import { useUiStore } from '@renderer/stores/ui'
import { shortcutOf, SHORTCUTS } from './shortcuts'

const DOT_CLASS: Record<SessionState, string> = {
  connecting: 'bg-amber-500 animate-pulse',
  'verifying-host-key': 'bg-amber-500 animate-pulse',
  authenticating: 'bg-amber-500 animate-pulse',
  ready: 'bg-emerald-500',
  reconnecting: 'bg-amber-500 animate-pulse',
  closed: 'bg-muted-foreground',
  error: 'bg-destructive',
}

const tabClass = (selected: boolean): string =>
  cn(
    'group flex h-8 shrink-0 items-center gap-2 rounded-t-md border border-b-0 px-3 text-sm',
    selected ? 'border-border bg-background' : 'border-transparent hover:bg-muted',
  )

/**
 * Custom title bar: app mark, tab strip (Home plus one tab per session) and
 * a new-tab button. The empty parts drag the window; Windows draws the
 * minimize, maximize and close buttons.
 */
export function TitleBar() {
  const { t } = useTranslation()
  const focusQuickConnect = useUiStore((state) => state.focusQuickConnect)
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen)
  const paletteLabel = t('nav.withShortcut', {
    label: t('palette.open'),
    shortcut: SHORTCUTS.palette.label,
  })
  const tabs = useTabsStore((state) => state.tabs)
  const activeId = useTabsStore((state) => state.activeId)
  const activate = useTabsStore((state) => state.activate)
  const newTabLabel = t('nav.withShortcut', {
    label: t('titleBar.newTab'),
    shortcut: SHORTCUTS.newTab.label,
  })

  return (
    <header className="app-drag relative h-(--titlebar-height) shrink-0 border-b border-border bg-titlebar text-titlebar-foreground">
      <div className="titlebar-area flex items-end gap-1 ps-3">
        <KeyRound aria-hidden className="mb-2.5 size-4 shrink-0 text-primary" />
        <div
          role="tablist"
          aria-label={t('titleBar.tabs')}
          className="app-no-drag ms-2 flex h-full min-w-0 items-end gap-0.5 overflow-x-auto"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeId === HOME_TAB}
            onClick={() => {
              activate(HOME_TAB)
            }}
            className={tabClass(activeId === HOME_TAB)}
          >
            <House aria-hidden className="size-3.5" />
            {t('titleBar.homeTab')}
          </button>
          {tabs.map((tab) => (
            <SessionTab key={tab.id} tab={tab} selected={tab.id === activeId} />
          ))}
        </div>
        <button
          type="button"
          aria-label={newTabLabel}
          title={newTabLabel}
          aria-keyshortcuts={SHORTCUTS.newTab.aria}
          onClick={focusQuickConnect}
          className="app-no-drag mb-1 flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-muted"
        >
          <Plus aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          aria-label={paletteLabel}
          title={paletteLabel}
          aria-keyshortcuts={SHORTCUTS.palette.aria}
          onClick={() => {
            setPaletteOpen(true)
          }}
          className="app-no-drag mb-1 flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-muted"
        >
          <Search aria-hidden className="size-4" />
        </button>
        <LockButton />
      </div>
    </header>
  )
}

/** Lock now: shown only with a master password (without one there is nothing to unlock with). */
function LockButton() {
  const { t } = useTranslation()
  const canLock = useVaultStore(
    (state) => state.status.state === 'unlocked' && state.status.masterPassword,
  )
  const lock = useVaultStore((state) => state.lock)
  if (!canLock) return null
  const shortcut = shortcutOf('lockNow')
  const label = t('nav.withShortcut', { label: t('security.lockNow'), shortcut: shortcut.label })
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-keyshortcuts={shortcut.aria}
      data-lock-button=""
      onClick={() => void lock()}
      className="app-no-drag mb-1 flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-muted"
    >
      <LockKeyhole aria-hidden className="size-4" />
    </button>
  )
}

function SessionTab({ tab, selected }: { tab: TerminalTab; selected: boolean }) {
  const { t } = useTranslation()
  const activate = useTabsStore((state) => state.activate)
  const close = useTabsStore((state) => state.close)
  const rename = useTabsStore((state) => state.rename)
  const editing = useTabsStore((state) => state.renamingId === tab.id)
  const startRename = useTabsStore((state) => state.startRename)
  const stopRename = useTabsStore((state) => state.stopRename)
  const panes = useTabsStore((state) => state.panes)
  const pane = focusedPane(tab, panes)
  const environment = usePaneEnvironment(pane)
  const state = pane?.state ?? 'closed'
  const title = tabTitle(tab, panes)
  const paneCount = paneIds(tab.layout).length
  const dragging = useTabDragStore((state) => state.sourceTabId)
  const switchTimer = useRef<number | undefined>(undefined)
  const cancelSwitch = (): void => {
    window.clearTimeout(switchTimer.current)
    switchTimer.current = undefined
  }

  const stateLabel = t(`terminal.state.${state}`)
  const closeLabel = t('nav.withShortcut', {
    label: t('titleBar.closeTab', { title }),
    shortcut: SHORTCUTS.closeTab.label,
  })

  if (editing) {
    const finish = (value: string | null): void => {
      if (value !== null) rename(tab.id, value)
      stopRename()
    }
    return (
      <div className={tabClass(selected)}>
        <input
          aria-label={t('titleBar.renameTab')}
          defaultValue={title}
          autoFocus
          maxLength={100}
          onFocus={(event) => {
            event.currentTarget.select()
          }}
          onBlur={(event) => {
            finish(event.currentTarget.value)
          }}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') finish(event.currentTarget.value)
            if (event.key === 'Escape') finish(null)
          }}
          className="w-36 rounded-sm border border-input bg-card px-1 text-sm"
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        tabClass(selected),
        environment !== undefined && cn('border-t-2', ENVIRONMENT_TAB[environment]),
        dragging === tab.id && 'opacity-50',
      )}
      data-tab-state={state}
      data-environment={environment}
      data-tab-id={tab.id}
      // Drag a tab into another tab's panes to show both side by side.
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData(TAB_DRAG_TYPE, tab.id)
        useTabDragStore.getState().start(tab.id)
      }}
      onDragEnd={() => {
        cancelSwitch()
        useTabDragStore.getState().end()
      }}
      onDragEnter={() => {
        // Hovering a tab with another tab shows it, so the drop can go into its panes.
        if (dragging === null || dragging === tab.id || selected) return
        cancelSwitch()
        switchTimer.current = window.setTimeout(() => {
          switchTimer.current = undefined
          activate(tab.id)
        }, 400)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) cancelSwitch()
      }}
    >
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        aria-description={
          environment === undefined
            ? stateLabel
            : `${stateLabel}, ${t(`environments.${environment}`)}`
        }
        title={`${title} (${stateLabel})`}
        onClick={() => {
          activate(tab.id)
        }}
        onDoubleClick={() => {
          startRename(tab.id)
        }}
        onAuxClick={(event) => {
          if (event.button === 1) close(tab.id)
        }}
        className="flex max-w-48 min-w-0 items-center gap-2"
      >
        <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT_CLASS[state])} />
        <span className="truncate">{title}</span>
        {paneCount > 1 && (
          <span
            aria-label={t('titleBar.paneCount', { count: paneCount })}
            className="shrink-0 rounded bg-muted px-1 text-[0.6875rem] text-muted-foreground"
          >
            {paneCount}
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label={closeLabel}
        title={closeLabel}
        onClick={() => {
          close(tab.id)
        }}
        className="flex size-5 shrink-0 items-center justify-center rounded-sm opacity-60 hover:bg-muted hover:opacity-100"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  )
}
