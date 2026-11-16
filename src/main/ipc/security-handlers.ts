import type { HostService } from '../hosts/host-service'
import type { IdentityService } from '../keychain/identity-service'
import type { SecretClipboard } from '../security/secret-clipboard'
import type { DataTransfer } from '../vault/data-transfer'
import type { VaultService } from '../vault/service'
import type { InvokeEventLike, IpcRouter } from './router'

export interface SecurityHandlerDeps<E extends InvokeEventLike> {
  vaults: VaultService
  hosts: Pick<HostService, 'savedPassword'>
  identities: Pick<IdentityService, 'savedPassword'>
  clipboard: Pick<SecretClipboard, 'copy'>
  transfer: DataTransfer
  /** Native dialogs, run by main. null when the user cancels. */
  chooseExportPath: (event: E) => Promise<string | null>
  chooseImportPath: (event: E) => Promise<string | null>
}

/** No Electron imports here, so tests can drive these handlers through a fake ipcMain. */
export function registerSecurityHandlers<E extends InvokeEventLike>(
  router: IpcRouter<E>,
  deps: SecurityHandlerDeps<E>,
): void {
  const { vaults } = deps
  router.handle('vault:status', () => vaults.status())
  router.handle('vault:unlock', ({ password }) => vaults.unlock(password))
  router.handle('vault:lock', () => vaults.lock())
  router.handle('vault:setMasterPassword', ({ current, next }) =>
    vaults.setMasterPassword(current, next),
  )
  router.handle('vault:backups', () => vaults.backups())
  router.handle('vault:restore', ({ name }) => vaults.restore(name))

  router.handle('secret:copy', async ({ kind, id }) => {
    const password =
      kind === 'host' ? await deps.hosts.savedPassword(id) : await deps.identities.savedPassword(id)
    return { clearsIn: await deps.clipboard.copy(password) }
  })

  router.handle('data:export', async ({ password }, event) => {
    // Fail before the dialog when there is nothing to export (locked, broken).
    await vaults.get()
    const filePath = await deps.chooseExportPath(event)
    return filePath === null ? null : deps.transfer.exportTo(filePath, password)
  })
  router.handle('data:importPick', async (_payload, event) => {
    await vaults.get()
    const filePath = await deps.chooseImportPath(event)
    return filePath === null ? null : deps.transfer.pick(filePath)
  })
  router.handle('data:import', ({ token, password }) => deps.transfer.import(token, password))
}
