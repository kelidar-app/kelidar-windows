import type { HostService } from '../hosts/host-service'
import type { KeyFileImports } from '../hosts/key-files'
import type { InvokeEventLike, IpcRouter } from './router'

export interface HostHandlerDeps<E extends InvokeEventLike> {
  hosts: HostService
  keyFiles: KeyFileImports
  /** Shows the native open dialog for the window that sent `event`. */
  chooseKeyFile: (event: E) => Promise<string | null>
}

/** No Electron imports here, so tests can drive these handlers through a fake ipcMain. */
export function registerHostHandlers<E extends InvokeEventLike>(
  router: IpcRouter<E>,
  deps: HostHandlerDeps<E>,
): void {
  router.handle('hosts:list', () => deps.hosts.list())
  router.handle('hosts:save', (request) => deps.hosts.save(request))
  router.handle('hosts:delete', async ({ id }) => {
    await deps.hosts.delete(id)
    return undefined
  })
  router.handle('hosts:pickKeyFile', async (_payload, event) => {
    const filePath = await deps.chooseKeyFile(event)
    if (filePath === null) return null
    return deps.keyFiles.import(filePath)
  })
}
