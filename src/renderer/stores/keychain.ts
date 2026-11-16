import { create } from 'zustand'
import type { ErrorCode } from '@shared/errors'
import type {
  AgentStatus,
  IdentitySaveRequest,
  IdentityView,
  KeyGenerateRequest,
  KeyImportRequest,
  KeyView,
} from '@shared/keychain'
import type { HostView } from '@shared/hosts'
import { api } from '@renderer/lib/api'
import { useHostsStore } from './hosts'

type Result<T> = { ok: true; data: T } | { ok: false; code: ErrorCode }

/**
 * Keys and identities as main reports them: names, fingerprints and public
 * keys. Never a private key, passphrase or password.
 */
interface KeychainState {
  keys: KeyView[]
  identities: IdentityView[]
  agent: AgentStatus | null
  loaded: boolean
  error: ErrorCode | null
  load: () => Promise<void>
  loadAgent: () => Promise<void>
  generateKey: (request: KeyGenerateRequest) => Promise<Result<KeyView>>
  importKey: (request: KeyImportRequest) => Promise<Result<KeyView>>
  renameKey: (id: string, name: string) => Promise<Result<KeyView>>
  deleteKey: (id: string) => Promise<Result<undefined>>
  saveIdentity: (request: IdentitySaveRequest) => Promise<Result<IdentityView>>
  deleteIdentity: (id: string) => Promise<Result<undefined>>
}

function fail(code: ErrorCode): { ok: false; code: ErrorCode } {
  return { ok: false, code }
}

export const useKeychainStore = create<KeychainState>()((set, get) => {
  /** Reloads keys and identities (and hosts, whose sign-in may show them). */
  const refresh = async (): Promise<void> => {
    await Promise.all([get().load(), useHostsStore.getState().load()])
  }
  return {
    keys: [],
    identities: [],
    agent: null,
    loaded: false,
    error: null,
    load: async () => {
      const [keys, identities] = await Promise.all([
        api.invoke('keys:list'),
        api.invoke('identities:list'),
      ])
      if (keys.ok && identities.ok) {
        set({ keys: keys.data, identities: identities.data, loaded: true, error: null })
      } else {
        const failed = keys.ok ? (identities.ok ? null : identities.error) : keys.error
        set({ loaded: true, error: failed?.code ?? 'INTERNAL' })
      }
    },
    loadAgent: async () => {
      const result = await api.invoke('agent:status')
      if (result.ok) set({ agent: result.data })
    },
    generateKey: async (request) => {
      const result = await api.invoke('keys:generate', request)
      if (!result.ok) return fail(result.error.code)
      await get().load()
      return { ok: true, data: result.data }
    },
    importKey: async (request) => {
      const result = await api.invoke('keys:import', request)
      if (!result.ok) return fail(result.error.code)
      await get().load()
      return { ok: true, data: result.data }
    },
    renameKey: async (id, name) => {
      const result = await api.invoke('keys:rename', { id, name })
      if (!result.ok) return fail(result.error.code)
      await refresh()
      return { ok: true, data: result.data }
    },
    deleteKey: async (id) => {
      const result = await api.invoke('keys:delete', { id })
      if (!result.ok) return fail(result.error.code)
      await get().load()
      return { ok: true, data: undefined }
    },
    saveIdentity: async (request) => {
      const result = await api.invoke('identities:save', request)
      if (!result.ok) return fail(result.error.code)
      await refresh()
      return { ok: true, data: result.data }
    },
    deleteIdentity: async (id) => {
      const result = await api.invoke('identities:delete', { id })
      if (!result.ok) return fail(result.error.code)
      await get().load()
      return { ok: true, data: undefined }
    },
  }
})

/** Which Keychain dialog is open. Secrets typed in them stay in component state. */
export type KeychainDialog =
  | { kind: 'none' }
  | { kind: 'generateKey' }
  | { kind: 'importKey' }
  | { kind: 'renameKey'; key: KeyView }
  | { kind: 'deleteKey'; key: KeyView }
  | { kind: 'identity'; identity?: IdentityView }
  | { kind: 'deleteIdentity'; identity: IdentityView }
  | { kind: 'upgrade'; host: HostView }

interface KeychainDialogStore {
  dialog: KeychainDialog
  open: (dialog: KeychainDialog) => void
  close: () => void
}

export const useKeychainDialogStore = create<KeychainDialogStore>()((set) => ({
  dialog: { kind: 'none' },
  open: (dialog) => {
    set({ dialog })
  },
  close: () => {
    set({ dialog: { kind: 'none' } })
  },
}))
