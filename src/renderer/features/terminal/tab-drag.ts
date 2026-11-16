import { create } from 'zustand'

/** The drag data type for a tab from the title bar. */
export const TAB_DRAG_TYPE = 'application/x-kelidar-tab'

/** Which tab is being dragged from the title bar (dragover cannot read the drag data). */
interface TabDragState {
  sourceTabId: string | null
  start: (tabId: string) => void
  end: () => void
}

export const useTabDragStore = create<TabDragState>()((set) => ({
  sourceTabId: null,
  start: (sourceTabId) => {
    set({ sourceTabId })
  },
  end: () => {
    set({ sourceTabId: null })
  },
}))
