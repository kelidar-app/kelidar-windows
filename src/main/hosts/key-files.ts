import { randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { KeyFileInfo } from '@shared/hosts'
import { AppError } from '../ipc/app-error'
import { inspectPrivateKey, keyKindOf } from '../ssh/keys'

/** Real private keys are a few KB; anything bigger is not a key. */
export const MAX_KEY_FILE_BYTES = 64 * 1024
const TOKEN_TTL_MS = 30 * 60 * 1000

export interface PendingKeyFile {
  fileName: string
  content: string
  encrypted: boolean
}

/** Reads a key file from disk and checks that it is a private key. */
export async function readKeyFile(filePath: string): Promise<PendingKeyFile> {
  let content: string
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size > MAX_KEY_FILE_BYTES) throw new AppError('KEY_INVALID')
    content = await readFile(filePath, 'utf8')
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('KEY_FILE_UNREADABLE', { cause: error })
  }
  const inspected = inspectPrivateKey(content)
  return { fileName: path.basename(filePath), content, encrypted: inspected.encrypted }
}

/**
 * The user picks a key file in a native dialog run by main. The renderer gets
 * a random token and the file name, never the path or the key. hosts:save
 * then hands the token back and main takes the key from here.
 */
export class KeyFileImports {
  private readonly pending = new Map<string, PendingKeyFile & { expires: number }>()

  constructor(private readonly now: () => number = Date.now) {}

  async import(filePath: string): Promise<KeyFileInfo> {
    const file = await readKeyFile(filePath)
    this.prune()
    const token = randomBytes(16).toString('hex')
    this.pending.set(token, { ...file, expires: this.now() + TOKEN_TTL_MS })
    const parsed = file.encrypted ? undefined : inspectPrivateKey(file.content).parsed
    return {
      token,
      fileName: file.fileName,
      encrypted: file.encrypted,
      ...(parsed === undefined ? {} : { keyType: keyKindOf(parsed.type) }),
    }
  }

  /** The app locked: chosen key files leave memory. */
  clear(): void {
    this.pending.clear()
  }

  /** The pending file, kept until discard() so a wrong passphrase can be retried. */
  peek(token: string): PendingKeyFile {
    this.prune()
    const file = this.pending.get(token)
    if (file === undefined) throw new AppError('KEY_FILE_EXPIRED')
    return { fileName: file.fileName, content: file.content, encrypted: file.encrypted }
  }

  discard(token: string): void {
    this.pending.delete(token)
  }

  private prune(): void {
    const now = this.now()
    for (const [token, file] of this.pending) {
      if (file.expires <= now) this.pending.delete(token)
    }
  }
}
