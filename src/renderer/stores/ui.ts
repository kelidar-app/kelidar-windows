import { create } from 'zustand'
import { HOME_TAB, useTabsStore } from './tabs'

export type SectionId = 'hosts' | 'settings'

interface UiState {
  section: SectionId
  /** Increments each time something asks for the Quick Connect input to take focus. */
  quickConnectFocusRequest: number
  /** Shows a section of the Home tab (and switches to Home). */
  showSection: (section: SectionId) => void
  focusQuickConnect: () => void
}

export const useUiStore = create<UiState>()((set) => ({
  section: 'hosts',
  quickConnectFocusRequest: 0,
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
}))
