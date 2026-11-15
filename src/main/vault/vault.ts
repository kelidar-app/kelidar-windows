import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  hostRecordSchema,
  knownHostRecordSchema,
  secretRecordSchema,
  sshKeyRecordSchema,
} from '@shared/records'
import { writeFileAtomic } from '../fs/atomic-write'
import { generateVaultKey, open as openBox, seal, VAULT_KEY_BYTES } from './crypto'
import type { KeyWrapper } from './key-wrapper'

export const VAULT_FILE_NAME = 'vault.json'
export const VAULT_BACKUP_DIR = 'vault-backups'
export const VAULT_BACKUP_COUNT = 10
const FILE_FORMAT = 'vault'
const FILE_VERSION = 1
const DATA_VERSION = 1

/** The decrypted contents. Lives only in main-process memory. */
export const vaultDataSchema = z.object({
  version: z.literal(DATA_VERSION),
  hosts: z.array(hostRecordSchema),
  secrets: z.array(secretRecordSchema),
  keys: z.array(sshKeyRecordSchema),
  knownHosts: z.array(knownHostRecordSchema),
})
export type VaultData = z.infer<typeof vaultDataSchema>

export function emptyVaultData(): VaultData {
  return { version: DATA_VERSION, hosts: [], secrets: [], keys: [], knownHosts: [] }
}

const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/)

const keyWrapSchema = z.object({ type: z.literal('safeStorage'), wrappedKey: base64.min(1) })

/** vault.json on disk: a readable header and one encrypted body. */
const envelopeSchema = z.object({
  format: z.literal(FILE_FORMAT),
  version: z.literal(FILE_VERSION),
  keyWrap: keyWrapSchema,
  cipher: z.literal('aes-256-gcm'),
  nonce: base64,
  tag: base64,
  data: base64,
})
type Envelope = z.infer<typeof envelopeSchema>
type Header = Pick<Envelope, 'format' | 'version' | 'keyWrap' | 'cipher'>

/** The header is bound to the body as AAD, so changing any header field fails decryption. */
function headerAad(header: Header): Buffer {
  return Buffer.from(
    JSON.stringify([
      header.format,
      header.version,
      header.keyWrap.type,
      header.keyWrap.wrappedKey,
      header.cipher,
    ]),
    'utf8',
  )
}

export type VaultErrorCode =
  | 'VAULT_UNAVAILABLE'
  | 'VAULT_KEY_UNREADABLE'
  | 'VAULT_CORRUPT'
  | 'VAULT_NEWER_VERSION'
  | 'VAULT_WRITE_FAILED'

/** Carries a code only. Never put vault contents in the message. */
export class VaultError extends Error {
  readonly code: VaultErrorCode

  constructor(code: VaultErrorCode, options?: { cause?: unknown }) {
    super(code, options)
    this.name = 'VaultError'
    this.code = code
  }
}

export interface VaultOptions {
  directory: string
  wrapper: KeyWrapper
  /** Tests only: replace the atomic writer to simulate a failed save. */
  writeAtomic?: (filePath: string, contents: string) => Promise<void>
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/**
 * One encrypted file, <userData>/vault.json (AGENTS.md, architecture rule 5).
 * - AES-256-GCM with a random 256-bit key and a fresh nonce on every save.
 * - The key is wrapped by a KeyWrapper (safeStorage in Phase 1).
 * - Saves are atomic (temp file, then rename) and run one after another.
 * - Before each save the previous file is copied to vault-backups/; the ten
 *   newest copies are kept.
 * - A file that fails to decrypt or parse is never overwritten.
 * - No file is written until the first change.
 */
export class Vault {
  private data: VaultData
  private queue: Promise<void> = Promise.resolve()

  private constructor(
    readonly filePath: string,
    readonly backupDir: string,
    private readonly key: Buffer,
    private wrappedKey: string | null,
    private readonly wrapper: KeyWrapper,
    private readonly writeAtomic: (filePath: string, contents: string) => Promise<void>,
    initial: VaultData,
  ) {
    this.data = initial
  }

  static async open(options: VaultOptions): Promise<Vault> {
    const filePath = path.join(options.directory, VAULT_FILE_NAME)
    const backupDir = path.join(options.directory, VAULT_BACKUP_DIR)
    const writeAtomic = options.writeAtomic ?? writeFileAtomic
    const { wrapper } = options

    let text: string | null
    try {
      text = await readFile(filePath, 'utf8')
    } catch (error) {
      if (!isMissingFile(error)) throw new VaultError('VAULT_CORRUPT', { cause: error })
      text = null
    }

    if (!(await wrapper.isAvailable())) throw new VaultError('VAULT_UNAVAILABLE')

    if (text === null) {
      const key = generateVaultKey()
      const wrappedKey = await wrapper.wrap(key)
      return new Vault(filePath, backupDir, key, wrappedKey, wrapper, writeAtomic, emptyVaultData())
    }

    const envelope = parseEnvelope(text)
    let unwrapped: { key: Buffer; rewrap: boolean }
    try {
      unwrapped = await wrapper.unwrap(envelope.keyWrap.wrappedKey)
    } catch (error) {
      throw new VaultError('VAULT_KEY_UNREADABLE', { cause: error })
    }
    if (unwrapped.key.length !== VAULT_KEY_BYTES) throw new VaultError('VAULT_KEY_UNREADABLE')

    let plaintext: Buffer
    try {
      plaintext = openBox(
        unwrapped.key,
        {
          nonce: Buffer.from(envelope.nonce, 'base64'),
          tag: Buffer.from(envelope.tag, 'base64'),
          ciphertext: Buffer.from(envelope.data, 'base64'),
        },
        headerAad(envelope),
      )
    } catch (error) {
      throw new VaultError('VAULT_CORRUPT', { cause: error })
    }

    let raw: unknown
    try {
      raw = JSON.parse(plaintext.toString('utf8'))
    } catch (error) {
      throw new VaultError('VAULT_CORRUPT', { cause: error })
    }
    const parsed = vaultDataSchema.safeParse(raw)
    if (!parsed.success) throw new VaultError('VAULT_CORRUPT')

    return new Vault(
      filePath,
      backupDir,
      unwrapped.key,
      unwrapped.rewrap ? null : envelope.keyWrap.wrappedKey,
      wrapper,
      writeAtomic,
      parsed.data,
    )
  }

  /** A deep copy; changing it changes nothing. */
  read(): VaultData {
    return structuredClone(this.data)
  }

  /**
   * Applies `mutate` to a copy, validates the result and saves it. If the
   * save fails the in-memory data stays as it was.
   */
  async update<T>(mutate: (draft: VaultData) => T): Promise<T> {
    // The whole read-modify-write runs in the queue, so two updates never
    // start from the same old data.
    const run = this.queue.then(async () => {
      const draft = structuredClone(this.data)
      const result = mutate(draft)
      const next = vaultDataSchema.parse(draft)
      try {
        await this.persist(next)
      } catch (error) {
        throw new VaultError('VAULT_WRITE_FAILED', { cause: error })
      }
      this.data = next
      return result
    })
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** Resolves when every pending save has finished. */
  flush(): Promise<void> {
    return this.queue
  }

  private async persist(data: VaultData): Promise<void> {
    this.wrappedKey ??= await this.wrapper.wrap(this.key)
    const header: Header = {
      format: FILE_FORMAT,
      version: FILE_VERSION,
      keyWrap: { type: this.wrapper.type, wrappedKey: this.wrappedKey },
      cipher: 'aes-256-gcm',
    }
    const box = seal(this.key, Buffer.from(JSON.stringify(data), 'utf8'), headerAad(header))
    const envelope: Envelope = {
      ...header,
      nonce: box.nonce.toString('base64'),
      tag: box.tag.toString('base64'),
      data: box.ciphertext.toString('base64'),
    }
    await this.backupCurrentFile()
    await this.writeAtomic(this.filePath, `${JSON.stringify(envelope, null, 2)}\n`)
  }

  private async backupCurrentFile(): Promise<void> {
    await mkdir(this.backupDir, { recursive: true })
    try {
      await copyFile(this.filePath, path.join(this.backupDir, backupName()))
    } catch (error) {
      if (!isMissingFile(error)) throw error
    }
    const backups = await listBackups(this.backupDir)
    const excess = backups.slice(0, Math.max(0, backups.length - VAULT_BACKUP_COUNT))
    await Promise.all(excess.map((name) => rm(path.join(this.backupDir, name), { force: true })))
  }
}

function parseEnvelope(text: string): Envelope {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new VaultError('VAULT_CORRUPT', { cause: error })
  }
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'version' in raw &&
    typeof raw.version === 'number' &&
    raw.version > FILE_VERSION
  ) {
    throw new VaultError('VAULT_NEWER_VERSION')
  }
  const parsed = envelopeSchema.safeParse(raw)
  if (!parsed.success) throw new VaultError('VAULT_CORRUPT')
  return parsed.data
}

let backupCounter = 0

/** Sorts by time: vault-2026-11-16T10-20-30-123Z-0001.json */
function backupName(): string {
  backupCounter = (backupCounter + 1) % 10_000
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `vault-${stamp}-${String(backupCounter).padStart(4, '0')}.json`
}

/** Backup file names, oldest first. */
export async function listBackups(backupDir: string): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(backupDir)
  } catch (error) {
    if (isMissingFile(error)) return []
    throw error
  }
  return names.filter((name) => /^vault-[\w-]+\.json$/.test(name)).sort()
}
