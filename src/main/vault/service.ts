import path from 'node:path'
import type { ErrorCode } from '@shared/errors'
import type { VaultStatus } from '@shared/security'
import { writeFileAtomic } from '../fs/atomic-write'
import { AppError } from '../ipc/app-error'
import type { KeyWrapper } from './key-wrapper'
import type { ScryptCost } from './password-wrap'
import {
  backupFile,
  checkVaultText,
  describeBackups,
  readBackup,
  Vault,
  VAULT_BACKUP_DIR,
  VAULT_FILE_NAME,
  VaultError,
  type BackupInfo,
} from './vault'

export interface VaultServiceOptions {
  directory: string
  wrapper: KeyWrapper
  /** Tests only: a cheaper scrypt cost. */
  scryptCost?: ScryptCost
  /** Tests only. */
  writeAtomic?: (filePath: string, contents: string) => Promise<void>
  /** Tests only: the wait after repeated wrong passwords. */
  sleep?: (ms: number) => Promise<void>
}

/** Wrong master passwords before each further try waits a little longer. */
const FREE_TRIES = 3
const MAX_DELAY_MS = 30_000

type State =
  | { status: 'opening'; vault: Promise<Vault> }
  | { status: 'unlocked'; vault: Vault }
  | { status: 'locked' }
  | { status: 'failed'; code: ErrorCode }

function codeOf(error: unknown): ErrorCode {
  if (error instanceof VaultError || error instanceof AppError) return error.code
  return 'VAULT_CORRUPT'
}

/**
 * Owns the open vault and its state:
 * - unlocked: services read and change it;
 * - locked: a master password is set and has not been typed yet, or the app
 *   was locked. The key and the data are not in memory;
 * - failed: the file could not be opened. The file is left untouched and a
 *   backup can be restored.
 */
export class VaultService {
  private state: State
  private failures = 0
  private readonly listeners = new Set<(status: VaultStatus) => void>()
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly options: VaultServiceOptions) {
    this.sleep =
      options.sleep ??
      ((ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms)
        }))
    this.state = { status: 'locked' }
    this.start()
  }

  private get backupDir(): string {
    return path.join(this.options.directory, VAULT_BACKUP_DIR)
  }

  private get filePath(): string {
    return path.join(this.options.directory, VAULT_FILE_NAME)
  }

  /** Opens the vault at startup or after a restore: locked when a master password is set. */
  private start(open: { key?: Buffer } = {}): void {
    const vault = (async () => {
      const kind = await Vault.inspect(this.options.directory)
      if (kind === 'password' && open.key === undefined) throw new VaultError('VAULT_LOCKED')
      return Vault.open({ ...this.vaultOptions(), ...open })
    })()
    this.state = { status: 'opening', vault }
    vault.then(
      (opened) => {
        if (this.state.status === 'opening' && this.state.vault === vault) {
          this.setState({ status: 'unlocked', vault: opened })
        }
      },
      (error: unknown) => {
        if (this.state.status !== 'opening' || this.state.vault !== vault) return
        const code = codeOf(error)
        this.setState(code === 'VAULT_LOCKED' ? { status: 'locked' } : { status: 'failed', code })
      },
    )
  }

  private vaultOptions() {
    return {
      directory: this.options.directory,
      wrapper: this.options.wrapper,
      ...(this.options.scryptCost === undefined ? {} : { scryptCost: this.options.scryptCost }),
      ...(this.options.writeAtomic === undefined ? {} : { writeAtomic: this.options.writeAtomic }),
    }
  }

  private setState(state: State): void {
    this.state = state
    const status = this.statusNow()
    for (const listener of this.listeners) listener(status)
  }

  /** Called with every change of state (to tell the window, to lock the clipboard...). */
  onChange(listener: (status: VaultStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private statusNow(): VaultStatus {
    switch (this.state.status) {
      case 'opening':
        return { state: 'opening', masterPassword: false }
      case 'unlocked':
        return { state: 'unlocked', masterPassword: this.state.vault.hasMasterPassword }
      case 'locked':
        return { state: 'locked', masterPassword: true }
      case 'failed':
        return { state: 'failed', masterPassword: false, error: this.state.code }
    }
  }

  /** Read anew after an await: the state may have changed meanwhile. */
  private isLocked(): boolean {
    return this.state.status === 'locked'
  }

  /** Waits for the startup open to settle. */
  async status(): Promise<VaultStatus> {
    if (this.state.status === 'opening') await this.state.vault.catch(() => undefined)
    return this.statusNow()
  }

  /** The open vault. Throws AppError VAULT_LOCKED while locked, or the open error. */
  async get(): Promise<Vault> {
    const state = this.state
    if (state.status === 'unlocked') return state.vault
    if (state.status === 'locked') throw new AppError('VAULT_LOCKED')
    if (state.status === 'failed') throw new AppError(state.code)
    try {
      return await state.vault
    } catch (error) {
      throw new AppError(codeOf(error), { cause: error })
    }
  }

  async unlock(password: string): Promise<VaultStatus> {
    if (this.state.status === 'opening') await this.status()
    if (this.state.status !== 'locked') return this.statusNow()
    // After a few wrong tries, each try waits longer (guessing gets slow).
    if (this.failures >= FREE_TRIES) {
      await this.sleep(Math.min(MAX_DELAY_MS, 1000 * 2 ** (this.failures - FREE_TRIES)))
    }
    let vault: Vault
    try {
      vault = await Vault.open({ ...this.vaultOptions(), password })
    } catch (error) {
      const code = codeOf(error)
      if (code === 'VAULT_PASSWORD_WRONG') {
        this.failures += 1
        throw new AppError(code)
      }
      this.setState({ status: 'failed', code })
      throw new AppError(code, { cause: error })
    }
    if (!this.isLocked()) {
      // Restored or locked again meanwhile: this copy is not the one in use.
      vault.close()
      return this.statusNow()
    }
    this.failures = 0
    this.setState({ status: 'unlocked', vault })
    return this.statusNow()
  }

  /** Only with a master password: without one there is nothing to unlock with. */
  async lock(): Promise<VaultStatus> {
    const state = this.state
    if (state.status !== 'unlocked' || !state.vault.hasMasterPassword) return this.statusNow()
    await state.vault.flush()
    state.vault.close()
    this.setState({ status: 'locked' })
    return this.statusNow()
  }

  /**
   * Sets, changes or removes (next null) the master password. When one is set
   * already, `current` must match it.
   */
  async setMasterPassword(current: string | undefined, next: string | null): Promise<VaultStatus> {
    const vault = await this.get()
    if (vault.hasMasterPassword) {
      if (current === undefined || !(await vault.checkPassword(current))) {
        throw new AppError('VAULT_PASSWORD_WRONG')
      }
    } else if (next === null) {
      return this.statusNow()
    }
    try {
      await vault.setMasterPassword(next)
    } catch (error) {
      throw new AppError(codeOf(error), { cause: error })
    }
    this.setState({ status: 'unlocked', vault })
    return this.statusNow()
  }

  /** The automatic backups, newest first. Not while locked. */
  async backups(): Promise<BackupInfo[]> {
    await this.status()
    if (this.state.status === 'locked') throw new AppError('VAULT_LOCKED')
    return describeBackups(this.backupDir)
  }

  /**
   * Puts a backup in place of vault.json. The current file becomes a backup
   * first, so a restore can be undone. While unlocked, only a backup the
   * current key opens is accepted, and it opens without asking again.
   */
  async restore(name: string): Promise<VaultStatus> {
    await this.status()
    const state = this.state
    if (state.status === 'locked' || state.status === 'opening') {
      throw new AppError('VAULT_LOCKED')
    }
    let text: string
    try {
      text = await readBackup(this.backupDir, name)
      checkVaultText(text)
    } catch (error) {
      throw new AppError(
        error instanceof VaultError && error.code === 'VAULT_NEWER_VERSION'
          ? 'VAULT_NEWER_VERSION'
          : 'VAULT_BACKUP_UNREADABLE',
        { cause: error },
      )
    }
    let key: Buffer | undefined
    if (state.status === 'unlocked') {
      if (!state.vault.opens(text)) throw new AppError('VAULT_BACKUP_UNREADABLE')
      await state.vault.flush()
      key = state.vault.copyKey()
    }
    const write = this.options.writeAtomic ?? writeFileAtomic
    try {
      await backupFile(this.filePath, this.backupDir)
      await write(this.filePath, text)
    } catch (error) {
      key?.fill(0)
      throw new AppError('VAULT_WRITE_FAILED', { cause: error })
    }
    if (state.status === 'unlocked') state.vault.close()
    this.start(key === undefined ? {} : { key })
    const status = await this.status()
    key?.fill(0)
    return status
  }

  /** Waits for pending saves; resolves even when the vault never opened. */
  async flush(): Promise<void> {
    const state = this.state
    if (state.status === 'unlocked') await state.vault.flush()
    if (state.status === 'opening') {
      const vault = await state.vault.catch(() => null)
      await vault?.flush()
    }
  }
}
