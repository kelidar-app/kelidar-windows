import { AppError } from '../ipc/app-error'
import { type Vault, VaultError } from './vault'

/**
 * Opens the vault once at startup and hands it to services. If opening
 * failed, every caller gets the same error code (the user restarts after
 * fixing the cause; the file itself is left untouched).
 */
export class VaultService {
  private readonly opening: Promise<Vault>

  constructor(open: () => Promise<Vault>) {
    this.opening = open()
    // Avoid an unhandled rejection; callers see the error through get().
    this.opening.catch(() => undefined)
  }

  async get(): Promise<Vault> {
    try {
      return await this.opening
    } catch (error) {
      if (error instanceof VaultError) throw new AppError(error.code, { cause: error })
      throw new AppError('VAULT_CORRUPT', { cause: error })
    }
  }

  /** Waits for pending saves; resolves even when the vault never opened. */
  async flush(): Promise<void> {
    const vault = await this.opening.catch(() => null)
    await vault?.flush()
  }
}
