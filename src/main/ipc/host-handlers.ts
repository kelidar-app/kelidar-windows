import type { GroupService } from '../hosts/group-service'
import type { HostService } from '../hosts/host-service'
import type { KeyFileImports } from '../hosts/key-files'
import type { UsedCredential } from '../ssh/auth'
import type { InvokeEventLike, IpcRouter } from './router'

export interface HostHandlerDeps<E extends InvokeEventLike> {
  hosts: HostService
  groups: GroupService
  keyFiles: KeyFileImports
  /** Shows the native open dialog for the window that sent `event`. */
  chooseKeyFile: (event: E) => Promise<string | null>
  /** The sign-in that worked in one of the sender's sessions (Quick Connect "Save host"). */
  sessionCredential: (event: E, sessionId: string) => UsedCredential | undefined
}

/** No Electron imports here, so tests can drive these handlers through a fake ipcMain. */
export function registerHostHandlers<E extends InvokeEventLike>(
  router: IpcRouter<E>,
  deps: HostHandlerDeps<E>,
): void {
  router.handle('hosts:list', () => deps.hosts.list())
  router.handle('hosts:save', (request, event) => {
    const used =
      request.auth.type === 'fromSession'
        ? deps.sessionCredential(event, request.auth.sessionId)
        : undefined
    return deps.hosts.save(request, used)
  })
  router.handle('hosts:delete', async ({ id }) => {
    await deps.hosts.delete(id)
    return undefined
  })
  router.handle('hosts:setFavorite', ({ id, favorite }) => deps.hosts.setFavorite(id, favorite))
  router.handle('groups:list', () => deps.groups.list())
  router.handle('groups:save', (request) => deps.groups.save(request))
  router.handle('groups:delete', async ({ id }) => {
    await deps.groups.delete(id)
    return undefined
  })
  router.handle('hosts:pickKeyFile', async (_payload, event) => {
    const filePath = await deps.chooseKeyFile(event)
    if (filePath === null) return null
    return deps.keyFiles.import(filePath)
  })
}
