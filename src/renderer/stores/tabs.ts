import { create } from 'zustand'
import type { ErrorCode } from '@shared/errors'
import type {
  HostKeyInfo,
  SessionOpenResponse,
  SessionState,
  SessionStateEvent,
  SessionTarget,
} from '@shared/session'
import {
  neighbour,
  paneIds,
  paneLeaf,
  removePane,
  resizePane,
  setRatio,
  splitPane,
  type FocusDirection,
  type Layout,
  type LayoutPath,
  type SplitDirection,
} from '@renderer/features/terminal/layout'
import { api } from '@renderer/lib/api'
import { forgetSession, startSessionEvents } from '@renderer/lib/session-events'
import { useHostsStore } from './hosts'

export const HOME_TAB = 'home'

/** What a pane was opened from, so "Connect again" can do the same thing. */
export type TabSource = { kind: 'host'; hostId: string } | { kind: 'quick'; input: string }

/** One terminal: a session and what is known about its connection. */
export interface Pane {
  id: string
  sessionId: string
  source: TabSource
  title: string
  target: SessionTarget
  state: SessionState
  error?: ErrorCode
  hostKey?: HostKeyInfo
  /** The jump host an error happened on. */
  via?: string
  /** While reconnecting: attempt number and when the next try starts (epoch ms). */
  reconnecting?: { attempt: number; retryAt: number }
  /** For a sticky session: tmux started, resumed, or missing on the server. */
  sticky?: 'started' | 'resumed' | 'unavailable'
  /** A sudo password prompt is showing; canFill: the hotkey can type the saved password. */
  sudo?: { canFill: boolean }
  /** Increments on each reconnect; the terminal prints a divider. */
  generation: number
}

/** A tab in the title bar: one or more panes laid out by splits. */
export interface TerminalTab {
  id: string
  /** Set when the user renamed the tab. */
  customTitle?: string
  layout: Layout
  focusedPaneId: string
}

/** The size a terminal starts with before it is measured. */
const INITIAL_SIZE = { cols: 80, rows: 24 }

interface TabsState {
  tabs: TerminalTab[]
  panes: Record<string, Pane>
  activeId: string
  /** Error from the last failed open (before any pane existed). */
  openError: ErrorCode | null
  openHost: (hostId: string) => Promise<boolean>
  /** Quick Connect: what the user typed (already checked with parseQuickConnect). */
  openQuick: (input: string) => Promise<boolean>
  /** After "Save host": the pane now belongs to the saved host. */
  adoptHost: (sessionId: string, host: { id: string; name: string }) => void
  /** "Connect again" in a pane whose session ended: a new session in the same pane. */
  reconnect: (paneId: string) => Promise<void>
  /** While reconnecting: try now instead of waiting. */
  reconnectNow: (paneId: string) => void
  /** A new tab on the same connection as the active pane: a new channel, no new sign-in. */
  duplicate: (tabId: string) => Promise<boolean>
  /** Splits the active pane; the new pane opens on the same connection. */
  split: (direction: SplitDirection) => Promise<boolean>
  closePane: (paneId: string) => void
  focusPane: (paneId: string) => void
  moveFocus: (direction: FocusDirection) => void
  resizeFocused: (direction: FocusDirection) => void
  setSplitRatio: (tabId: string, path: LayoutPath, ratio: number) => void
  activate: (tabId: string) => void
  activateNext: (step: 1 | -1) => void
  /** Closes the tab and every pane in it. */
  close: (tabId: string) => void
  rename: (tabId: string, title: string) => void
  /** The tab whose title is being edited. */
  renamingId: string | null
  startRename: (tabId?: string) => void
  stopRename: () => void
  clearOpenError: () => void
}

/** State events that arrived before the open response created the pane. */
const earlyStates = new Map<string, SessionStateEvent[]>()

function applyEvent(pane: Pane, event: SessionStateEvent): Pane {
  const next: Pane = { ...pane, state: event.state }
  // Back after a drop: the terminal marks where the new connection starts.
  if (pane.state === 'reconnecting' && event.state === 'ready') next.generation += 1
  if (event.state !== 'ready') delete next.sudo
  const optional = {
    error: event.error,
    hostKey: event.hostKey,
    via: event.via,
    reconnecting: event.reconnect,
  } as const
  for (const [key, value] of Object.entries(optional)) {
    if (value === undefined) Reflect.deleteProperty(next, key)
    else Reflect.set(next, key, value)
  }
  if (event.state === 'ready') {
    if (event.sticky === undefined) delete next.sticky
    else next.sticky = event.sticky
  }
  return next
}

function newPane(source: TabSource, opened: SessionOpenResponse): Pane {
  const queued = earlyStates.get(opened.sessionId) ?? []
  earlyStates.delete(opened.sessionId)
  return queued.reduce(applyEvent, {
    id: crypto.randomUUID(),
    sessionId: opened.sessionId,
    source,
    title: opened.title,
    target: opened.target,
    state: 'connecting',
    generation: 0,
  })
}

type Opened = { ok: true; data: SessionOpenResponse } | { ok: false; code: ErrorCode }

export const useTabsStore = create<TabsState>()((set, get) => {
  const openSession = async (source: TabSource): Promise<Opened> => {
    const result = await api.invoke(
      'session:open',
      source.kind === 'host'
        ? { hostId: source.hostId, ...INITIAL_SIZE }
        : { quick: source.input, ...INITIAL_SIZE },
    )
    return result.ok ? result : { ok: false, code: result.error.code }
  }

  /** A new session beside a pane: on the same connection when it is up, else a new one. */
  const openBeside = async (pane: Pane): Promise<Opened> => {
    if (pane.state !== 'closed' && pane.state !== 'error') {
      const result = await api.invoke('session:duplicate', {
        sessionId: pane.sessionId,
        ...INITIAL_SIZE,
      })
      if (result.ok) return result
    }
    return openSession(pane.source)
  }

  const activePane = (): { tab: TerminalTab; pane: Pane } | undefined => {
    const { tabs, panes, activeId } = get()
    const tab = tabs.find((item) => item.id === activeId)
    const pane = tab === undefined ? undefined : panes[tab.focusedPaneId]
    return tab === undefined || pane === undefined ? undefined : { tab, pane }
  }

  const updateTab = (tabId: string, change: (tab: TerminalTab) => TerminalTab): void => {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? change(tab) : tab)),
    }))
  }

  const endSession = (pane: Pane): void => {
    void api.invoke('session:close', { sessionId: pane.sessionId })
    forgetSession(pane.sessionId)
  }

  const openTab = async (source: TabSource): Promise<boolean> => {
    const result = await openSession(source)
    if (!result.ok) {
      set({ openError: result.code })
      return false
    }
    const pane = newPane(source, result.data)
    const tab: TerminalTab = {
      id: crypto.randomUUID(),
      layout: paneLeaf(pane.id),
      focusedPaneId: pane.id,
    }
    set((state) => ({
      tabs: [...state.tabs, tab],
      panes: { ...state.panes, [pane.id]: pane },
      activeId: tab.id,
      openError: null,
    }))
    return true
  }

  return {
    tabs: [],
    panes: {},
    activeId: HOME_TAB,
    openError: null,
    renamingId: null,

    openHost: (hostId) => openTab({ kind: 'host', hostId }),

    openQuick: (input) => openTab({ kind: 'quick', input }),

    adoptHost: (sessionId, host) => {
      set((state) => ({
        panes: Object.fromEntries(
          Object.entries(state.panes).map(([id, pane]) => [
            id,
            pane.sessionId === sessionId
              ? { ...pane, source: { kind: 'host', hostId: host.id }, title: host.name }
              : pane,
          ]),
        ),
      }))
    },

    reconnect: async (paneId) => {
      const pane = get().panes[paneId]
      if (pane === undefined) return
      endSession(pane)
      const result = await openSession(pane.source)
      set((state) => {
        const current = state.panes[paneId]
        if (current === undefined) return {}
        if (!result.ok) {
          return {
            panes: { ...state.panes, [paneId]: { ...current, state: 'error', error: result.code } },
          }
        }
        const queued = earlyStates.get(result.data.sessionId) ?? []
        earlyStates.delete(result.data.sessionId)
        const next: Pane = {
          ...current,
          sessionId: result.data.sessionId,
          target: result.data.target,
          state: 'connecting',
          generation: current.generation + 1,
        }
        delete next.error
        delete next.hostKey
        delete next.via
        return { panes: { ...state.panes, [paneId]: queued.reduce(applyEvent, next) } }
      })
    },

    reconnectNow: (paneId) => {
      const pane = get().panes[paneId]
      if (pane?.state === 'reconnecting') {
        void api.invoke('session:reconnectNow', { sessionId: pane.sessionId })
      }
    },

    duplicate: async (tabId) => {
      const tab = get().tabs.find((item) => item.id === tabId)
      const pane = tab === undefined ? undefined : get().panes[tab.focusedPaneId]
      if (tab === undefined || pane === undefined) return false
      const result = await api.invoke('session:duplicate', {
        sessionId: pane.sessionId,
        ...INITIAL_SIZE,
      })
      if (!result.ok) {
        set({ openError: result.error.code })
        return false
      }
      const copy = newPane(pane.source, result.data)
      const created: TerminalTab = {
        id: crypto.randomUUID(),
        layout: paneLeaf(copy.id),
        focusedPaneId: copy.id,
      }
      set((state) => {
        const index = state.tabs.findIndex((item) => item.id === tabId)
        const tabs = [...state.tabs]
        tabs.splice(index + 1, 0, created)
        return { tabs, panes: { ...state.panes, [copy.id]: copy }, activeId: created.id }
      })
      return true
    },

    split: async (direction) => {
      const active = activePane()
      if (active === undefined) return false
      const result = await openBeside(active.pane)
      if (!result.ok) {
        set({ openError: result.code })
        return false
      }
      const pane = newPane(active.pane.source, result.data)
      set((state) => ({
        panes: { ...state.panes, [pane.id]: pane },
        tabs: state.tabs.map((tab) =>
          tab.id === active.tab.id
            ? {
                ...tab,
                layout: splitPane(tab.layout, active.pane.id, pane.id, direction),
                focusedPaneId: pane.id,
              }
            : tab,
        ),
      }))
      return true
    },

    closePane: (paneId) => {
      const tab = get().tabs.find((item) => paneIds(item.layout).includes(paneId))
      const pane = get().panes[paneId]
      if (tab === undefined || pane === undefined) return
      const layout = removePane(tab.layout, paneId)
      if (layout === null) {
        get().close(tab.id)
        return
      }
      endSession(pane)
      const order = paneIds(tab.layout)
      const index = order.indexOf(paneId)
      const remaining = paneIds(layout)
      const focus =
        tab.focusedPaneId === paneId
          ? (remaining[Math.min(index, remaining.length - 1)] ?? remaining[0] ?? '')
          : tab.focusedPaneId
      set((state) => {
        const panes = Object.fromEntries(
          Object.entries(state.panes).filter(([id]) => id !== paneId),
        )
        return {
          panes,
          tabs: state.tabs.map((item) =>
            item.id === tab.id ? { ...item, layout, focusedPaneId: focus } : item,
          ),
        }
      })
    },

    focusPane: (paneId) => {
      const tab = get().tabs.find((item) => paneIds(item.layout).includes(paneId))
      if (tab !== undefined && tab.focusedPaneId !== paneId) {
        updateTab(tab.id, (item) => ({ ...item, focusedPaneId: paneId }))
      }
    },

    moveFocus: (direction) => {
      const active = activePane()
      if (active === undefined) return
      const target = neighbour(active.tab.layout, active.pane.id, direction)
      if (target !== undefined)
        updateTab(active.tab.id, (tab) => ({ ...tab, focusedPaneId: target }))
    },

    resizeFocused: (direction) => {
      const active = activePane()
      if (active === undefined) return
      updateTab(active.tab.id, (tab) => ({
        ...tab,
        layout: resizePane(tab.layout, active.pane.id, direction),
      }))
    },

    setSplitRatio: (tabId, path, ratio) => {
      updateTab(tabId, (tab) => ({ ...tab, layout: setRatio(tab.layout, path, ratio) }))
    },

    activate: (tabId) => {
      if (tabId === HOME_TAB || get().tabs.some((tab) => tab.id === tabId)) {
        set({ activeId: tabId })
      }
    },

    activateNext: (step) => {
      const ids = [HOME_TAB, ...get().tabs.map((tab) => tab.id)]
      const index = ids.indexOf(get().activeId)
      const next = ids[(index + step + ids.length) % ids.length]
      if (next !== undefined) set({ activeId: next })
    },

    close: (tabId) => {
      const { tabs, activeId, panes } = get()
      const index = tabs.findIndex((tab) => tab.id === tabId)
      const tab = tabs[index]
      if (tab === undefined) return
      const closing = paneIds(tab.layout)
      for (const id of closing) {
        const pane = panes[id]
        if (pane !== undefined) endSession(pane)
      }
      const remaining = tabs.filter((item) => item.id !== tabId)
      // Closing the active tab moves to its neighbour, like a browser.
      const neighbourTab = remaining[Math.min(index, remaining.length - 1)]
      const nextPanes = Object.fromEntries(
        Object.entries(panes).filter(([id]) => !closing.includes(id)),
      )
      set({
        tabs: remaining,
        panes: nextPanes,
        activeId: activeId === tabId ? (neighbourTab?.id ?? HOME_TAB) : activeId,
      })
    },

    rename: (tabId, title) => {
      const clean = title.trim().slice(0, 100)
      const tab = get().tabs.find((item) => item.id === tabId)
      const own = tab === undefined ? undefined : get().panes[tab.focusedPaneId]?.title
      updateTab(tabId, (item) => {
        const next = { ...item }
        if (clean === '' || clean === own) delete next.customTitle
        else next.customTitle = clean
        return next
      })
    },

    startRename: (tabId) => {
      const id = tabId ?? get().activeId
      if (id !== HOME_TAB) set({ renamingId: id })
    },

    stopRename: () => {
      set({ renamingId: null })
    },

    clearOpenError: () => {
      set({ openError: null })
    },
  }
})

function paneOfSession(sessionId: string): Pane | undefined {
  return Object.values(useTabsStore.getState().panes).find((pane) => pane.sessionId === sessionId)
}

function updatePane(paneId: string, change: (pane: Pane) => Pane): void {
  useTabsStore.setState((state) => {
    const pane = state.panes[paneId]
    return pane === undefined ? {} : { panes: { ...state.panes, [paneId]: change(pane) } }
  })
}

/** Call once at startup: routes session events into the store. */
export function startTabs(): void {
  startSessionEvents(
    (event) => {
      const pane = paneOfSession(event.sessionId)
      if (pane === undefined) {
        const queue = earlyStates.get(event.sessionId) ?? []
        queue.push(event)
        earlyStates.set(event.sessionId, queue)
        // Events of sessions whose pane is already gone would pile up; keep a few.
        if (earlyStates.size > 32) {
          const oldest = earlyStates.keys().next().value
          if (oldest !== undefined) earlyStates.delete(oldest)
        }
        return
      }
      if (event.state === 'ready' && pane.state !== 'ready' && pane.source.kind === 'host') {
        useHostsStore.getState().markConnected(pane.source.hostId)
      }
      updatePane(pane.id, (current) => applyEvent(current, event))
    },
    ({ sessionId, prompt, canFill }) => {
      const pane = paneOfSession(sessionId)
      if (pane === undefined) return
      updatePane(pane.id, (current) => {
        const next = { ...current }
        if (prompt) next.sudo = { canFill }
        else delete next.sudo
        return next
      })
    },
  )
}

/** The pane the tab shows as its own: the focused one. */
export function focusedPane(
  tab: TerminalTab,
  panes: Readonly<Record<string, Pane>>,
): Pane | undefined {
  return panes[tab.focusedPaneId]
}

export function tabTitle(tab: TerminalTab, panes: Readonly<Record<string, Pane>>): string {
  return tab.customTitle ?? focusedPane(tab, panes)?.title ?? ''
}

/** The pane keyboard actions go to: the focused pane of the active tab. */
export function activePaneId(): string | undefined {
  const { tabs, activeId } = useTabsStore.getState()
  return tabs.find((tab) => tab.id === activeId)?.focusedPaneId
}
