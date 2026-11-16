import { create } from 'zustand'
import { HOME_TAB, useTabsStore } from './tabs'

export type SectionId = 'hosts' | 'keychain' | 'settings'

interface UiState {
  section: SectionId
  /** Increments each time something asks for the Quick Connect input to take focus. */
  quickConnectFocusRequest: number
  /** Increments each time something asks for the host search to take focus. */
  hostSearchFocusRequest: number
  hostQuery: string
  /** Groups the user folded in the host list (for this run of the app). */
  collapsedGroups: ReadonlySet<string>
  paletteOpen: boolean
  shortcutsOpen: boolean
  /** Shows a section of the Home tab (and switches to Home). */
  showSection: (section: SectionId) => void
  focusQuickConnect: () => void
  focusHostSearch: () => void
  setHostQuery: (query: string) => void
  toggleGroup: (groupId: string) => void
  setPaletteOpen: (open: boolean) => void
  setShortcutsOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>()((set) => ({
  section: 'hosts',
  quickConnectFocusRequest: 0,
  hostSearchFocusRequest: 0,
  hostQuery: '',
  collapsedGroups: new Set(),
  paletteOpen: false,
  shortcutsOpen: false,
  showSection: (section) => {
    useTabsStore.getState().activate(HOME_TAB)
    set({ section })
  },
  focusQuickConnect: () => {
    useTabsStore.getState().activate(HOME_TAB)
    set((state) => ({
      section: 'hosts',
      quickConnectFocusRequest: state.quickConnectFocusRequest + 1,
    }))
  },
  focusHostSearch: () => {
    useTabsStore.getState().activate(HOME_TAB)
    set((state) => ({ section: 'hosts', hostSearchFocusRequest: state.hostSearchFocusRequest + 1 }))
  },
  setHostQuery: (hostQuery) => {
    set({ hostQuery })
  },
  toggleGroup: (groupId) => {
    set((state) => {
      const next = new Set(state.collapsedGroups)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return { collapsedGroups: next }
    })
  },
  setPaletteOpen: (paletteOpen) => {
    set({ paletteOpen })
  },
  setShortcutsOpen: (shortcutsOpen) => {
    set({ shortcutsOpen })
  },
}))
