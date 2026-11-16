import type { KeyUpgrades } from '../hosts/key-upgrade'
import type { Agents } from '../keychain/agents'
import type { IdentityService } from '../keychain/identity-service'
import type { KeyService } from '../keychain/key-service'
import type { EventSink } from '../ssh/event-sink'
import type { InvokeEventLike, IpcRouter } from './router'

export interface KeychainHandlerDeps<E extends InvokeEventLike> {
  keys: KeyService
  identities: IdentityService
  agents: Pick<Agents, 'status'>
  upgrades: KeyUpgrades
  /** The window that sent the request: upgrade questions go to it, and only it may run its plan. */
  ownerOf: (event: E) => EventSink
}

/** No Electron imports here, so tests can drive these handlers through a fake ipcMain. */
export function registerKeychainHandlers<E extends InvokeEventLike>(
  router: IpcRouter<E>,
  deps: KeychainHandlerDeps<E>,
): void {
  router.handle('keys:list', () => deps.keys.list())
  router.handle('keys:generate', (request) => deps.keys.generate(request))
  router.handle('keys:import', (request) => deps.keys.import(request))
  router.handle('keys:rename', ({ id, name }) => deps.keys.rename(id, name))
  router.handle('keys:delete', async ({ id }) => {
    await deps.keys.delete(id)
    return undefined
  })
  router.handle('identities:list', () => deps.identities.list())
  router.handle('identities:save', (request) => deps.identities.save(request))
  router.handle('identities:delete', async ({ id }) => {
    await deps.identities.delete(id)
    return undefined
  })
  router.handle('agent:status', () => deps.agents.status())
  router.handle('hosts:upgradePrepare', ({ hostId, key }, event) =>
    deps.upgrades.prepare(deps.ownerOf(event), hostId, key),
  )
  router.handle('hosts:upgradeRun', ({ upgradeId }, event) =>
    deps.upgrades.run(deps.ownerOf(event), upgradeId),
  )
}
