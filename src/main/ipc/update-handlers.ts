import { AppError } from './app-error'
import type { UpdateService } from '../updates/update-service'
import type { InvokeEventLike, IpcRouter } from './router'

/** No Electron imports here, so tests can drive these handlers through a fake ipcMain. */
export function registerUpdateHandlers<E extends InvokeEventLike>(
  router: IpcRouter<E>,
  deps: { updates: UpdateService },
): void {
  router.handle('update:status', () => deps.updates.get())
  router.handle('update:check', () => deps.updates.check())
  router.handle('update:install', () => {
    if (!deps.updates.install()) throw new AppError('UPDATE_NOT_READY')
    return undefined
  })
}
