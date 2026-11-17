import type { HostImports } from '../importers/import-service'
import type { InvokeEventLike, IpcRouter } from './router'

/** No Electron imports here, so tests can drive these handlers through a fake ipcMain. */
export function registerImportHandlers<E extends InvokeEventLike>(
  router: IpcRouter<E>,
  deps: { imports: HostImports },
): void {
  router.handle('import:scan', () => deps.imports.scan())
  router.handle('import:apply', ({ token, ids }) => deps.imports.apply(token, ids))
}
