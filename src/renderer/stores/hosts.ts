import { create } from 'zustand'
import type { ErrorCode } from '@shared/errors'
import type { GroupSaveRequest, GroupView } from '@shared/groups'
import type { HostSaveRequest, HostView } from '@shared/hosts'
import { api } from '@renderer/lib/api'

type Result<T> = { ok: true; data: T } | { ok: false; code: ErrorCode }

/** Hosts and groups as main reports them. Never holds a password, key or passphrase. */
interface HostsState {
  hosts: HostView[]
  groups: GroupView[]
  loaded: boolean
  error: ErrorCode | null
  load: () => Promise<void>
  save: (request: HostSaveRequest) => Promise<Result<HostView>>
  remove: (id: string) => Promise<Result<undefined>>
  setFavorite: (id: string, favorite: boolean) => Promise<Result<HostView>>
  /** A session to the host is ready: main has recorded it, show it under Recent now. */
  markConnected: (id: string) => void
  saveGroup: (request: GroupSaveRequest) => Promise<Result<GroupView>>
  removeGroup: (id: string) => Promise<Result<undefined>>
}

export const useHostsStore = create<HostsState>()((set, get) => ({
  hosts: [],
  groups: [],
  loaded: false,
  error: null,
  load: async () => {
    const [hosts, groups] = await Promise.all([api.invoke('hosts:list'), api.invoke('groups:list')])
    if (hosts.ok && groups.ok) {
      set({ hosts: hosts.data, groups: groups.data, loaded: true, error: null })
    } else {
      const failed = hosts.ok ? (groups.ok ? null : groups.error) : hosts.error
      set({ loaded: true, error: failed?.code ?? 'INTERNAL' })
    }
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
  setFavorite: async (id, favorite) => {
    const result = await api.invoke('hosts:setFavorite', { id, favorite })
    if (!result.ok) return { ok: false, code: result.error.code }
    set((state) => ({ hosts: state.hosts.map((host) => (host.id === id ? result.data : host)) }))
    return { ok: true, data: result.data }
  },
  markConnected: (id) => {
    const now = new Date().toISOString()
    set((state) => ({
      hosts: state.hosts.map((host) => (host.id === id ? { ...host, lastConnectedAt: now } : host)),
    }))
  },
  saveGroup: async (request) => {
    const result = await api.invoke('groups:save', request)
    if (!result.ok) return { ok: false, code: result.error.code }
    await get().load()
    return { ok: true, data: result.data }
  },
  removeGroup: async (id) => {
    const result = await api.invoke('groups:delete', { id })
    if (!result.ok) return { ok: false, code: result.error.code }
    await get().load()
    return { ok: true, data: undefined }
  },
}))

/** Which host form is open, if any. Prefill comes from Quick Connect's "Save host" or a group. */
export interface HostPrefill {
  address?: string
  port?: number
  username?: string
  groupId?: string
  /** The Quick Connect session whose sign-in can be saved. */
  sessionId?: string
}

export type HostFormState =
  { mode: 'closed' } | { mode: 'new'; prefill?: HostPrefill } | { mode: 'edit'; host: HostView }

interface HostFormStore {
  form: HostFormState
  openNew: (prefill?: HostPrefill) => void
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

export type GroupFormState =
  { mode: 'closed' } | { mode: 'new'; parentId?: string } | { mode: 'edit'; group: GroupView }

/** The group form, and the group waiting for delete confirmation. */
interface GroupFormStore {
  form: GroupFormState
  deleting: GroupView | null
  deletingHost: HostView | null
  openNew: (parentId?: string) => void
  openEdit: (group: GroupView) => void
  close: () => void
  askDelete: (group: GroupView | null) => void
  askDeleteHost: (host: HostView | null) => void
}

export const useGroupFormStore = create<GroupFormStore>()((set) => ({
  form: { mode: 'closed' },
  deleting: null,
  deletingHost: null,
  openNew: (parentId) => {
    set({ form: parentId === undefined ? { mode: 'new' } : { mode: 'new', parentId } })
  },
  openEdit: (group) => {
    set({ form: { mode: 'edit', group } })
  },
  close: () => {
    set({ form: { mode: 'closed' } })
  },
  askDelete: (group) => {
    set({ deleting: group })
  },
  askDeleteHost: (host) => {
    set({ deletingHost: host })
  },
}))
