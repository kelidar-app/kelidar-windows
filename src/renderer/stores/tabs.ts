import { create } from 'zustand'
import type { ErrorCode } from '@shared/errors'
import type {
  HostKeyInfo,
  SessionOpenResponse,
  SessionState,
  SessionStateEvent,
  SessionTarget,
} from '@shared/session'
import { api } from '@renderer/lib/api'
import { forgetSession, startSessionEvents } from '@renderer/lib/session-events'

export const HOME_TAB = 'home'

/** What a tab was opened from, so "Connect again" can do the same thing. */
export type TabSource = { kind: 'host'; hostId: string } | { kind: 'quick'; input: string }

export interface TerminalTab {
  id: string
  sessionId: string
  source: TabSource
  title: string
  /** Set when the user renamed the tab. */
  customTitle?: string
  target: SessionTarget
  state: SessionState
  error?: ErrorCode
  hostKey?: HostKeyInfo
  /** Increments on each reconnect; the terminal prints a divider. */
  generation: number
}

/** The size a terminal starts with before it is measured. */
const INITIAL_SIZE = { cols: 80, rows: 24 }

interface TabsState {
  tabs: TerminalTab[]
  activeId: string
  /** Error from the last failed open (before any tab existed). */
  openError: ErrorCode | null
  openHost: (hostId: string) => Promise<boolean>
  reconnect: (tabId: string) => Promise<void>
  activate: (tabId: string) => void
  activateNext: (step: 1 | -1) => void
  close: (tabId: string) => void
  rename: (tabId: string, title: string) => void
  /** The tab whose title is being edited. */
  renamingId: string | null
  startRename: (tabId?: string) => void
  stopRename: () => void
  clearOpenError: () => void
}

/** State events that arrived before the open response created the tab. */
const earlyStates = new Map<string, SessionStateEvent[]>()

function applyEvent(tab: TerminalTab, event: SessionStateEvent): TerminalTab {
  const next: TerminalTab = { ...tab, state: event.state }
  if (event.error === undefined) delete next.error
  else next.error = event.error
  if (event.hostKey === undefined) delete next.hostKey
  else next.hostKey = event.hostKey
  return next
}

export const useTabsStore = create<TabsState>()((set, get) => {
  const openSession = async (
    source: TabSource,
  ): Promise<{ ok: true; data: SessionOpenResponse } | { ok: false; code: ErrorCode }> => {
    if (source.kind !== 'host') return { ok: false, code: 'INTERNAL' }
    const result = await api.invoke('session:open', { hostId: source.hostId, ...INITIAL_SIZE })
    return result.ok ? result : { ok: false, code: result.error.code }
  }

  const withEarlyStates = (tab: TerminalTab): TerminalTab => {
    const queued = earlyStates.get(tab.sessionId) ?? []
    earlyStates.delete(tab.sessionId)
    return queued.reduce(applyEvent, tab)
  }

  return {
    tabs: [],
    activeId: HOME_TAB,
    openError: null,
    renamingId: null,

    openHost: async (hostId) => {
      const source: TabSource = { kind: 'host', hostId }
      const result = await openSession(source)
      if (!result.ok) {
        set({ openError: result.code })
        return false
      }
      const tab = withEarlyStates({
        id: crypto.randomUUID(),
        sessionId: result.data.sessionId,
        source,
        title: result.data.title,
        target: result.data.target,
        state: 'connecting',
        generation: 0,
      })
      set((state) => ({ tabs: [...state.tabs, tab], activeId: tab.id, openError: null }))
      return true
    },

    reconnect: async (tabId) => {
      const tab = get().tabs.find((item) => item.id === tabId)
      if (tab === undefined) return
      void api.invoke('session:close', { sessionId: tab.sessionId })
      forgetSession(tab.sessionId)
      const result = await openSession(tab.source)
      set((state) => ({
        tabs: state.tabs.map((item) => {
          if (item.id !== tabId) return item
          if (!result.ok) return { ...item, state: 'error', error: result.code }
          const next: TerminalTab = {
            ...item,
            sessionId: result.data.sessionId,
            target: result.data.target,
            state: 'connecting',
            generation: item.generation + 1,
          }
          delete next.error
          delete next.hostKey
          return withEarlyStates(next)
        }),
      }))
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
      const { tabs, activeId } = get()
      const index = tabs.findIndex((tab) => tab.id === tabId)
      const tab = tabs[index]
      if (tab === undefined) return
      void api.invoke('session:close', { sessionId: tab.sessionId })
      forgetSession(tab.sessionId)
      const remaining = tabs.filter((item) => item.id !== tabId)
      // Closing the active tab moves to its neighbour, like a browser.
      const neighbour = remaining[Math.min(index, remaining.length - 1)]
      set({
        tabs: remaining,
        activeId: activeId === tabId ? (neighbour?.id ?? HOME_TAB) : activeId,
      })
    },

    rename: (tabId, title) => {
      const clean = title.trim().slice(0, 100)
      set((state) => ({
        tabs: state.tabs.map((tab) => {
          if (tab.id !== tabId) return tab
          const next = { ...tab }
          if (clean === '' || clean === tab.title) delete next.customTitle
          else next.customTitle = clean
          return next
        }),
      }))
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

/** Call once at startup: routes session:state events into the store. */
export function startTabs(): void {
  startSessionEvents((event) => {
    const { tabs } = useTabsStore.getState()
    if (!tabs.some((tab) => tab.sessionId === event.sessionId)) {
      const queue = earlyStates.get(event.sessionId) ?? []
      queue.push(event)
      earlyStates.set(event.sessionId, queue)
      // Events of sessions whose tab is already gone would pile up; keep a few.
      if (earlyStates.size > 32) {
        const oldest = earlyStates.keys().next().value
        if (oldest !== undefined) earlyStates.delete(oldest)
      }
      return
    }
    useTabsStore.setState({
      tabs: tabs.map((tab) => (tab.sessionId === event.sessionId ? applyEvent(tab, event) : tab)),
    })
  })
}

export function tabTitle(tab: TerminalTab): string {
  return tab.customTitle ?? tab.title
}
