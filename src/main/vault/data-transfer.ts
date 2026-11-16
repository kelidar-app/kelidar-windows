import { randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ImportSummary } from '@shared/security'
import { writeFileAtomic } from '../fs/atomic-write'
import { AppError } from '../ipc/app-error'
import {
  checkExport,
  createExport,
  ExportFileError,
  MAX_EXPORT_BYTES,
  readExport,
} from './export-file'
import { isConsistent, mergeVaultData } from './merge'
import type { ScryptCost } from './password-wrap'
import type { VaultService } from './service'

const TOKEN_TTL_MS = 10 * 60 * 1000

function importError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (error instanceof ExportFileError) {
    if (error.reason === 'password') return new AppError('IMPORT_PASSWORD_WRONG')
    if (error.reason === 'newer') return new AppError('IMPORT_FILE_NEWER')
  }
  return new AppError('IMPORT_FILE_INVALID', { cause: error })
}

/**
 * Manual export and import of the whole vault in one password-protected
 * file. Main runs the file dialogs: the renderer gets a token and a file
 * name, never a path, and never the data.
 */
export class DataTransfer {
  private readonly pending = new Map<string, { text: string; expires: number }>()

  constructor(
    private readonly vaults: VaultService,
    private readonly options: {
      now?: () => number
      scryptCost?: ScryptCost
      writeAtomic?: (filePath: string, contents: string) => Promise<void>
    } = {},
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  async exportTo(filePath: string, password: string): Promise<{ fileName: string }> {
    const data = (await this.vaults.get()).read()
    const text = await createExport(data, password, this.options.scryptCost)
    try {
      await (this.options.writeAtomic ?? writeFileAtomic)(filePath, text)
    } catch (error) {
      throw new AppError('EXPORT_WRITE_FAILED', { cause: error })
    }
    return { fileName: path.basename(filePath) }
  }

  /** Import, step 1: reads and checks the chosen file; the password comes next. */
  async pick(filePath: string): Promise<{ token: string; fileName: string }> {
    let text: string
    try {
      const info = await stat(filePath)
      if (!info.isFile() || info.size > MAX_EXPORT_BYTES) throw new AppError('IMPORT_FILE_INVALID')
      text = await readFile(filePath, 'utf8')
      checkExport(text)
    } catch (error) {
      throw importError(error)
    }
    this.prune()
    const token = randomBytes(16).toString('hex')
    this.pending.set(token, { text, expires: this.now() + TOKEN_TTL_MS })
    return { token, fileName: path.basename(filePath) }
  }

  /** Import, step 2: opens the file with its password and merges it into the vault. */
  async import(token: string, password: string): Promise<ImportSummary> {
    this.prune()
    const file = this.pending.get(token)
    if (file === undefined) throw new AppError('IMPORT_EXPIRED')
    const vault = await this.vaults.get()
    let incoming
    try {
      incoming = await readExport(file.text, password)
    } catch (error) {
      throw importError(error)
    }
    const summary = await vault.update((data) => {
      const merged = mergeVaultData(data, incoming)
      if (!isConsistent(merged.data)) throw new AppError('IMPORT_FILE_INVALID')
      Object.assign(data, merged.data)
      return merged.summary
    })
    this.pending.delete(token)
    return summary
  }

  private prune(): void {
    const now = this.now()
    for (const [token, file] of this.pending) {
      if (file.expires <= now) this.pending.delete(token)
    }
  }
}
