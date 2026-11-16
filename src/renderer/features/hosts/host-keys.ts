import type { HostView } from '@shared/hosts'

/** Keys on a focused host in the list. The shortcut cheat sheet shows them too. */
export const HOST_KEYS = {
  connect: 'Enter',
  edit: 'Ctrl+E',
  favorite: 'Ctrl+D',
  remove: 'Delete',
  upgrade: 'Ctrl+U',
  copyPassword: 'Ctrl+Shift+A',
  move: '↑ ↓',
} as const

/** "Upgrade to key login" is offered for hosts that sign in with a password of their own. */
export function canUpgradeToKey(host: HostView): boolean {
  return (
    host.identity === undefined &&
    (host.signIn.method === 'password' || host.signIn.method === 'ask')
  )
}
