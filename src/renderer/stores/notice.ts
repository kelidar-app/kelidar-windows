import type { ParseKeys } from 'i18next'
import { create } from 'zustand'
import type { ErrorCode } from '@shared/errors'

/** A short message at the bottom of the window: an i18n key, or an error code. */
export type Notice =
  | { kind: 'info'; key: ParseKeys; values?: Record<string, string | number> }
  | { kind: 'error'; code: ErrorCode }

interface NoticeStore {
  notice: (Notice & { id: number }) | null
  dismiss: () => void
}

const SHOW_MS = 6000
let timer: number | undefined
let counter = 0

export const useNoticeStore = create<NoticeStore>()((set) => ({
  notice: null,
  dismiss: () => {
    window.clearTimeout(timer)
    set({ notice: null })
  },
}))

export function showNotice(notice: Notice): void {
  window.clearTimeout(timer)
  counter += 1
  useNoticeStore.setState({ notice: { ...notice, id: counter } })
  timer = window.setTimeout(() => {
    useNoticeStore.setState({ notice: null })
  }, SHOW_MS)
}
