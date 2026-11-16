import { create } from 'zustand'

/** Zoom steps add to the font size from Settings, in points. */
export const MIN_ZOOM = -6
export const MAX_ZOOM = 16

export interface PasteRequest {
  paneId: string
  text: string
  /** The pane's host is tagged production: the dialog asks for an extra confirmation. */
  production: boolean
}

interface TerminalUiState {
  /** Points added to every terminal's font size (Ctrl+= / Ctrl+- / Ctrl+wheel). Not saved. */
  zoom: number
  zoomBy: (step: number) => void
  resetZoom: () => void
  /** A paste waiting for the user to look at it. */
  paste: PasteRequest | null
  /** Shows the paste preview; resolves true when the user confirms. */
  askPaste: (request: PasteRequest) => Promise<boolean>
  answerPaste: (confirmed: boolean) => void
}

let pending: ((confirmed: boolean) => void) | null = null

export const useTerminalUiStore = create<TerminalUiState>()((set) => ({
  zoom: 0,
  zoomBy: (step) => {
    set((state) => ({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom + step)) }))
  },
  resetZoom: () => {
    set({ zoom: 0 })
  },
  paste: null,
  askPaste: (request) => {
    // A newer paste replaces one still waiting.
    pending?.(false)
    set({ paste: request })
    return new Promise((resolve) => {
      pending = resolve
    })
  },
  answerPaste: (confirmed) => {
    const resolve = pending
    pending = null
    set({ paste: null })
    resolve?.(confirmed)
  },
}))

/** Text with a line break runs as soon as it is pasted into a shell. */
export function isMultiLine(text: string): boolean {
  return /[\r\n]/.test(text)
}
