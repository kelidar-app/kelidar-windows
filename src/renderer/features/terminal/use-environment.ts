import type { Environment } from '@shared/records'
import { useHostsStore } from '@renderer/stores/hosts'
import type { Pane } from '@renderer/stores/tabs'

/** The environment tag (production, staging…) of the host a pane is connected to. */
export function usePaneEnvironment(pane: Pane | undefined): Environment | undefined {
  return useHostsStore((state) => {
    const source = pane?.source
    if (source?.kind !== 'host') return undefined
    return state.hosts.find((host) => host.id === source.hostId)?.environment
  })
}

/** Border and accent classes per environment. Full class names, so Tailwind finds them. */
export const ENVIRONMENT_BORDER: Record<Environment, string> = {
  production: 'border-red-500',
  staging: 'border-amber-500',
  development: 'border-green-500',
}

export const ENVIRONMENT_TAB: Record<Environment, string> = {
  production: 'border-t-red-500 bg-red-500/10',
  staging: 'border-t-amber-500 bg-amber-500/10',
  development: 'border-t-green-500 bg-green-500/10',
}
