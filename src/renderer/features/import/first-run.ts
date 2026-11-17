import { useEffect } from 'react'
import { api } from '@renderer/lib/api'
import { useHostsStore } from '@renderer/stores/hosts'
import { useImportStore } from '@renderer/stores/import'
import { useSettingsStore } from '@renderer/stores/settings'

/**
 * The first-run offer: once, when the vault opens empty, look for an ssh
 * config and PuTTY sessions. Found something: offer to import it. Either
 * way the offer is not made again.
 */
export function useFirstRunImport(): void {
  const loaded = useHostsStore((state) => state.loaded && state.error === null)
  const empty = useHostsStore((state) => state.hosts.length === 0 && state.groups.length === 0)
  const offered = useSettingsStore((state) => state.settings.importOffered)
  useEffect(() => {
    if (!loaded || !empty || offered) return
    const run = { alive: true }
    void (async () => {
      const scan = await api.invoke('import:scan')
      if (!run.alive) return
      await useSettingsStore.getState().update({ importOffered: true })
      if (scan.ok && scan.data.candidates.length > 0) {
        useImportStore.getState().open({ kind: 'welcome', scan: scan.data })
      }
    })()
    return () => {
      run.alive = false
    }
  }, [loaded, empty, offered])
}
