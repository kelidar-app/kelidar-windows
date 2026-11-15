import { create } from 'zustand'

export type SectionId = 'hosts' | 'settings'

interface UiState {
  section: SectionId
  /** Increments each time something asks for the Quick Connect input to take focus. */
  quickConnectFocusRequest: number
  showSection: (section: SectionId) => void
  focusQuickConnect: () => void
}

export const useUiStore = create<UiState>()((set) => ({
  section: 'hosts',
  quickConnectFocusRequest: 0,
  showSection: (section) => {
    set({ section })
  },
  focusQuickConnect: () => {
    set((state) => ({
      section: 'hosts',
      quickConnectFocusRequest: state.quickConnectFocusRequest + 1,
    }))
  },
}))
