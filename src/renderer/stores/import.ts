import { create } from 'zustand'
import type { HostView } from '@shared/hosts'
import type { ImportScan } from '@shared/importers'

/**
 * Which "getting data in" dialog is open:
 * - welcome: the first-run offer, with what was found;
 * - preview: the rows to import, from a scan already made or a new one;
 * - smartPaste: free text to fill the host form with;
 * - hostInfo: a host's notes and links.
 */
export type ImportDialog =
  | { kind: 'none' }
  | { kind: 'welcome'; scan: ImportScan }
  | { kind: 'preview'; scan?: ImportScan }
  | { kind: 'smartPaste'; text?: string }
  | { kind: 'hostInfo'; host: HostView }

interface ImportStore {
  dialog: ImportDialog
  open: (dialog: ImportDialog) => void
  close: () => void
}

export const useImportStore = create<ImportStore>()((set) => ({
  dialog: { kind: 'none' },
  open: (dialog) => {
    set({ dialog })
  },
  close: () => {
    set({ dialog: { kind: 'none' } })
  },
}))
