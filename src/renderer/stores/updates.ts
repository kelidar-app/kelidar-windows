import { create } from 'zustand'
import type { UpdateStatus } from '@shared/updates'
import { api } from '@renderer/lib/api'
import { useTabsStore } from './tabs'

interface UpdatesStore {
  status: UpdateStatus | null
  /** "Restart to update" asked while sessions are open: confirm first. */
  confirming: boolean
  check: () => Promise<void>
  /** Restarts now, or asks first when terminals are open. */
  restart: () => void
  confirmRestart: () => Promise<void>
  cancelRestart: () => void
}

export const useUpdatesStore = create<UpdatesStore>()((set) => ({
  status: null,
  confirming: false,
  check: async () => {
    const result = await api.invoke('update:check')
    if (result.ok) set({ status: result.data })
  },
  restart: () => {
    if (useTabsStore.getState().tabs.length > 0) set({ confirming: true })
    else void api.invoke('update:install')
  },
  confirmRestart: async () => {
    set({ confirming: false })
    await api.invoke('update:install')
  },
  cancelRestart: () => {
    set({ confirming: false })
  },
}))

export const updateReady = (): boolean => useUpdatesStore.getState().status?.state === 'ready'

/** Loads the current state and follows changes from main. */
export function subscribeToUpdates(): () => void {
  void api.invoke('update:status').then((result) => {
    if (result.ok) useUpdatesStore.setState({ status: result.data })
  })
  return api.on('update:status', (status) => {
    useUpdatesStore.setState({ status })
  })
}
