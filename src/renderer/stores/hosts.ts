import { create } from 'zustand'
import type { ErrorCode } from '@shared/errors'
import type { HostSaveRequest, HostView } from '@shared/hosts'
import { api } from '@renderer/lib/api'

type Result<T> = { ok: true; data: T } | { ok: false; code: ErrorCode }

/** Hosts as main reports them. Never holds a password, key or passphrase. */
interface HostsState {
  hosts: HostView[]
  loaded: boolean
  error: ErrorCode | null
  load: () => Promise<void>
  save: (request: HostSaveRequest) => Promise<Result<HostView>>
  remove: (id: string) => Promise<Result<undefined>>
}

export const useHostsStore = create<HostsState>()((set, get) => ({
  hosts: [],
  loaded: false,
  error: null,
  load: async () => {
    const result = await api.invoke('hosts:list')
    if (result.ok) set({ hosts: result.data, loaded: true, error: null })
    else set({ loaded: true, error: result.error.code })
  },
  save: async (request) => {
    const result = await api.invoke('hosts:save', request)
    if (!result.ok) return { ok: false, code: result.error.code }
    await get().load()
    return { ok: true, data: result.data }
  },
  remove: async (id) => {
    const result = await api.invoke('hosts:delete', { id })
    if (!result.ok) return { ok: false, code: result.error.code }
    await get().load()
    return { ok: true, data: undefined }
  },
}))

/** Which host form is open, if any. Prefill comes from Quick Connect's "Save host". */
export type HostFormState =
  | { mode: 'closed' }
  | { mode: 'new'; prefill?: { address: string; port: number; username: string } }
  | { mode: 'edit'; host: HostView }

interface HostFormStore {
  form: HostFormState
  openNew: (prefill?: { address: string; port: number; username: string }) => void
  openEdit: (host: HostView) => void
  close: () => void
}

export const useHostFormStore = create<HostFormStore>()((set) => ({
  form: { mode: 'closed' },
  openNew: (prefill) => {
    set({ form: prefill === undefined ? { mode: 'new' } : { mode: 'new', prefill } })
  },
  openEdit: (host) => {
    set({ form: { mode: 'edit', host } })
  },
  close: () => {
    set({ form: { mode: 'closed' } })
  },
}))
