import { create } from 'zustand'
import type { ErrorCode } from '@shared/errors'
import type { VaultStatus } from '@shared/security'
import { api } from '@renderer/lib/api'
import { useGroupFormStore, useHostFormStore, useHostsStore } from './hosts'
import { useKeychainDialogStore, useKeychainStore } from './keychain'
import { showNotice } from './notice'
import { useUiStore } from './ui'

interface VaultStore {
  status: VaultStatus
  /** Main reported a new state (vault:state event, or a reply). */
  apply: (status: VaultStatus) => void
  unlock: (password: string) => Promise<ErrorCode | null>
  lock: () => Promise<void>
  /** The vault's contents changed under the views (import, restore): read them again. */
  reloadData: () => void
}

const isOpen = (status: VaultStatus): boolean => status.state === 'unlocked'

/**
 * Locking empties everything the renderer knows about the vault: hosts,
 * groups, keys, identities and every open form. Terminals stay (hidden).
 */
function forgetVaultData(): void {
  useHostsStore.setState({ hosts: [], groups: [], loaded: false, error: null })
  useKeychainStore.setState({ keys: [], identities: [], loaded: false, error: null })
  useHostFormStore.getState().close()
  useGroupFormStore.getState().close()
  useKeychainDialogStore.getState().close()
  useSecurityDialogStore.getState().close()
  useUiStore.getState().setPaletteOpen(false)
  useUiStore.getState().setShortcutsOpen(false)
}

export const useVaultStore = create<VaultStore>()((set, get) => ({
  status: { state: 'opening', masterPassword: false },
  apply: (status) => {
    const before = get().status
    set({ status })
    if (status.state === 'locked') forgetVaultData()
    else if (!isOpen(before)) get().reloadData()
  },
  reloadData: () => {
    if (!isOpen(get().status)) return
    void useHostsStore.getState().load()
    void useKeychainStore.getState().load()
  },
  unlock: async (password) => {
    const result = await api.invoke('vault:unlock', { password })
    if (!result.ok) return result.error.code
    get().apply(result.data)
    return null
  },
  lock: async () => {
    const result = await api.invoke('vault:lock')
    if (result.ok) get().apply(result.data)
  },
}))

/** Listens for state changes from main (auto-lock, Windows locked, restore). */
export function subscribeToVault(): () => void {
  return api.on('vault:state', (status) => {
    useVaultStore.getState().apply(status)
  })
}

export const isLocked = (): boolean => useVaultStore.getState().status.state === 'locked'

export type SecurityDialog = 'masterPassword' | 'export' | 'import' | 'restore'

interface SecurityDialogStore {
  open: SecurityDialog | null
  show: (dialog: SecurityDialog) => void
  close: () => void
}

export const useSecurityDialogStore = create<SecurityDialogStore>()((set) => ({
  open: null,
  show: (dialog) => {
    set({ open: dialog })
  },
  close: () => {
    set({ open: null })
  },
}))

/**
 * "Copy password": main puts the saved password on the clipboard and clears
 * it later. The renderer only says which host or identity.
 */
export async function copySavedPassword(kind: 'host' | 'identity', id: string): Promise<void> {
  const result = await api.invoke('secret:copy', { kind, id })
  if (!result.ok) {
    showNotice({ kind: 'error', code: result.error.code })
    return
  }
  showNotice(
    result.data.clearsIn > 0
      ? { kind: 'info', key: 'security.copiedClears', values: { seconds: result.data.clearsIn } }
      : { kind: 'info', key: 'security.copied' },
  )
}
