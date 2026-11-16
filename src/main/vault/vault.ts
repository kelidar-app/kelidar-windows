import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import type { ErrorCode } from '@shared/errors'
import {
  groupRecordSchema,
  hostRecordSchema,
  identityRecordSchema,
  knownHostRecordSchema,
  secretRecordSchema,
  sshKeyRecordSchema,
} from '@shared/records'
import { writeFileAtomic } from '../fs/atomic-write'
import { generateVaultKey, open as openBox, seal, VAULT_KEY_BYTES } from './crypto'
import { CURRENT_DATA_VERSION, migrateVaultData } from './migrations'
import type { KeyWrapper } from './key-wrapper'
import {
  passwordKeyWrapSchema,
  SCRYPT_COST,
  unwrapWithPassword,
  wrapWithPassword,
  WrongPasswordError,
  type PasswordKeyWrap,
  type ScryptCost,
} from './password-wrap'

export const VAULT_FILE_NAME = 'vault.json'
export const VAULT_BACKUP_DIR = 'vault-backups'
export const VAULT_BACKUP_COUNT = 10
const FILE_FORMAT = 'vault'
const FILE_VERSION = 1
const DATA_VERSION = CURRENT_DATA_VERSION

/** The decrypted contents. Lives only in main-process memory. */
export const vaultDataSchema = z.object({
  version: z.literal(DATA_VERSION),
  hosts: z.array(hostRecordSchema),
  groups: z.array(groupRecordSchema),
  identities: z.array(identityRecordSchema),
  secrets: z.array(secretRecordSchema),
  keys: z.array(sshKeyRecordSchema),
  knownHosts: z.array(knownHostRecordSchema),
})
export type VaultData = z.infer<typeof vaultDataSchema>

export function emptyVaultData(): VaultData {
  return {
    version: DATA_VERSION,
    hosts: [],
    groups: [],
    identities: [],
    secrets: [],
    keys: [],
    knownHosts: [],
  }
}

const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/)

const safeStorageKeyWrapSchema = z.object({
  type: z.literal('safeStorage'),
  wrappedKey: base64.min(1),
})
const keyWrapSchema = z.discriminatedUnion('type', [
  safeStorageKeyWrapSchema,
  passwordKeyWrapSchema,
])
type KeyWrap = z.infer<typeof keyWrapSchema>

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
  const wrap = header.keyWrap
  const fields: (string | number)[] = [
    header.format,
    header.version,
    wrap.type,
    wrap.wrappedKey,
    header.cipher,
  ]
  if (wrap.type === 'password') {
    fields.push(wrap.kdf, wrap.N, wrap.r, wrap.p, wrap.salt, wrap.nonce, wrap.tag)
  }
  return Buffer.from(JSON.stringify(fields), 'utf8')
}

function sealEnvelope(key: Buffer, keyWrap: KeyWrap, plaintext: Buffer): string {
  const header: Header = {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    keyWrap,
    cipher: 'aes-256-gcm',
  }
  const box = seal(key, plaintext, headerAad(header))
  const envelope: Envelope = {
    ...header,
    nonce: box.nonce.toString('base64'),
    tag: box.tag.toString('base64'),
    data: box.ciphertext.toString('base64'),
  }
  return `${JSON.stringify(envelope, null, 2)}\n`
}

/** The decrypted body. Throws VAULT_CORRUPT when the key is wrong or a byte changed. */
function openEnvelope(key: Buffer, envelope: Envelope): Buffer {
  try {
    return openBox(
      key,
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
}

function parseData(plaintext: Buffer): VaultData {
  let raw: unknown
  try {
    raw = JSON.parse(plaintext.toString('utf8'))
  } catch (error) {
    throw new VaultError('VAULT_CORRUPT', { cause: error })
  }
  const migrated = migrateVaultData(raw)
  if (migrated.status === 'future') throw new VaultError('VAULT_NEWER_VERSION')
  if (migrated.status === 'invalid') throw new VaultError('VAULT_CORRUPT')
  const parsed = vaultDataSchema.safeParse(migrated.data)
  if (!parsed.success) throw new VaultError('VAULT_CORRUPT')
  return parsed.data
}

export type VaultErrorCode = Extract<ErrorCode, `VAULT_${string}`>

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
  /** Opens a vault protected by a master password. */
  password?: string
  /** Main only: opens a restored backup with the key already in memory. */
  key?: Buffer
  /** Tests only: a cheaper scrypt cost for new master passwords. */
  scryptCost?: ScryptCost
  /** Tests only: replace the atomic writer to simulate a failed save. */
  writeAtomic?: (filePath: string, contents: string) => Promise<void>
}

/** How the vault key is kept on disk. */
type KeyLock =
  /** wrappedKey is null when safeStorage asked for a fresh wrap on the next save. */
  | { type: 'safeStorage'; wrappedKey: string | null }
  | { type: 'password'; keyWrap: PasswordKeyWrap }

export type VaultProtection = 'safeStorage' | 'password'

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/**
 * One encrypted file, <userData>/vault.json (AGENTS.md, architecture rule 5).
 * - AES-256-GCM with a random 256-bit key and a fresh nonce on every save.
 * - The key is wrapped by safeStorage (DPAPI) or, with a master password, by
 *   a key derived with scrypt.
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
    private key: Buffer,
    private lock: KeyLock,
    private readonly wrapper: KeyWrapper,
    private readonly scryptCost: ScryptCost,
    private readonly writeAtomic: (filePath: string, contents: string) => Promise<void>,
    initial: VaultData,
  ) {
    this.data = initial
  }

  /**
   * Without opening anything: is there a vault, and does it need the master
   * password? Throws VaultError for a file that cannot be read.
   */
  static async inspect(directory: string): Promise<VaultProtection | 'missing'> {
    const text = await readVaultText(path.join(directory, VAULT_FILE_NAME))
    if (text === null) return 'missing'
    return parseEnvelope(text).keyWrap.type
  }

  static async open(options: VaultOptions): Promise<Vault> {
    const filePath = path.join(options.directory, VAULT_FILE_NAME)
    const backupDir = path.join(options.directory, VAULT_BACKUP_DIR)
    const writeAtomic = options.writeAtomic ?? writeFileAtomic
    const scryptCost = options.scryptCost ?? SCRYPT_COST
    const { wrapper } = options
    const make = (key: Buffer, lock: KeyLock, data: VaultData): Vault =>
      new Vault(filePath, backupDir, key, lock, wrapper, scryptCost, writeAtomic, data)

    const text = await readVaultText(filePath)
    if (text === null) {
      if (!(await wrapper.isAvailable())) throw new VaultError('VAULT_UNAVAILABLE')
      const key = generateVaultKey()
      const wrappedKey = await wrapper.wrap(key)
      return make(key, { type: 'safeStorage', wrappedKey }, emptyVaultData())
    }

    const envelope = parseEnvelope(text)
    const { key, lock } = await unlockKey(envelope.keyWrap, options)
    try {
      return make(key, lock, parseData(openEnvelope(key, envelope)))
    } catch (error) {
      key.fill(0)
      throw error
    }
  }

  /** A deep copy; changing it changes nothing. */
  read(): VaultData {
    return structuredClone(this.data)
  }

  get hasMasterPassword(): boolean {
    return this.lock.type === 'password'
  }

  /**
   * Applies `mutate` to a copy, validates the result and saves it. If the
   * save fails the in-memory data stays as it was.
   */
  async update<T>(mutate: (draft: VaultData) => T): Promise<T> {
    // The whole read-modify-write runs in the queue, so two updates never
    // start from the same old data.
    return this.enqueue(async () => {
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
  }

  /** Resolves when every pending save has finished. */
  flush(): Promise<void> {
    return this.queue
  }

  /** True when `password` is the master password. False without one. */
  async checkPassword(password: string): Promise<boolean> {
    if (this.lock.type !== 'password') return false
    try {
      const key = await unwrapWithPassword(this.lock.keyWrap, password)
      const same = key.length === this.key.length && timingSafeEqual(key, this.key)
      key.fill(0)
      return same
    } catch {
      return false
    }
  }

  /**
   * Sets, changes (a string) or removes (null) the master password. A new
   * vault key is made each time and every backup is encrypted again with it,
   * so no older copy can be opened the old way: a backup kept under the
   * Windows key would get around a new master password.
   */
  async setMasterPassword(password: string | null): Promise<void> {
    await this.enqueue(async () => {
      const key = generateVaultKey()
      const lock: KeyLock =
        password === null
          ? { type: 'safeStorage', wrappedKey: await this.wrapper.wrap(key) }
          : { type: 'password', keyWrap: await wrapWithPassword(key, password, this.scryptCost) }
      const keyWrap = keyWrapOf(lock)
      try {
        // Backups first: if this stops halfway, the vault still opens as before.
        await this.rekeyBackups(key, keyWrap, lock.type === 'password')
        await this.writeAtomic(
          this.filePath,
          sealEnvelope(key, keyWrap, Buffer.from(JSON.stringify(this.data), 'utf8')),
        )
      } catch (error) {
        key.fill(0)
        throw new VaultError('VAULT_WRITE_FAILED', { cause: error })
      }
      this.key.fill(0)
      this.key = key
      this.lock = lock
    })
  }

  /** Whether a vault file's body opens with this vault's key (a backup to restore). */
  opens(text: string): boolean {
    try {
      openEnvelope(this.key, parseEnvelope(text))
      return true
    } catch {
      return false
    }
  }

  /** A copy of the key, to reopen a restored backup without asking again. */
  copyKey(): Buffer {
    return Buffer.from(this.key)
  }

  /** Locked or replaced: the key and the data leave memory. Call after flush(). */
  close(): void {
    this.key.fill(0)
    this.data = emptyVaultData()
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async persist(data: VaultData): Promise<void> {
    if (this.lock.type === 'safeStorage') {
      this.lock.wrappedKey ??= await this.wrapper.wrap(this.key)
    }
    const text = sealEnvelope(
      this.key,
      keyWrapOf(this.lock),
      Buffer.from(JSON.stringify(data), 'utf8'),
    )
    await backupFile(this.filePath, this.backupDir)
    await this.writeAtomic(this.filePath, text)
  }

  private async rekeyBackups(key: Buffer, keyWrap: KeyWrap, toPassword: boolean): Promise<void> {
    for (const name of await listBackups(this.backupDir)) {
      const file = path.join(this.backupDir, name)
      let envelope: Envelope
      try {
        envelope = parseEnvelope(await readFile(file, 'utf8'))
      } catch {
        continue
      }
      let plaintext: Buffer
      try {
        plaintext = openEnvelope(this.key, envelope)
      } catch {
        // Not this vault's key (left from an interrupted change). One that
        // Windows alone can open must not outlive a new master password.
        if (toPassword && envelope.keyWrap.type === 'safeStorage') await rm(file, { force: true })
        continue
      }
      await this.writeAtomic(file, sealEnvelope(key, keyWrap, plaintext))
    }
  }
}

function keyWrapOf(lock: KeyLock): KeyWrap {
  if (lock.type === 'password') return lock.keyWrap
  if (lock.wrappedKey === null) throw new Error('The key is not wrapped yet')
  return { type: 'safeStorage', wrappedKey: lock.wrappedKey }
}

async function unlockKey(
  keyWrap: KeyWrap,
  options: VaultOptions,
): Promise<{ key: Buffer; lock: KeyLock }> {
  const lockOf = (key: Buffer, rewrap: boolean): { key: Buffer; lock: KeyLock } => ({
    key,
    lock:
      keyWrap.type === 'password'
        ? { type: 'password', keyWrap }
        : { type: 'safeStorage', wrappedKey: rewrap ? null : keyWrap.wrappedKey },
  })
  if (options.key !== undefined) return lockOf(Buffer.from(options.key), false)

  if (keyWrap.type === 'password') {
    if (options.password === undefined) throw new VaultError('VAULT_LOCKED')
    try {
      return lockOf(await unwrapWithPassword(keyWrap, options.password), false)
    } catch (error) {
      if (error instanceof WrongPasswordError) throw new VaultError('VAULT_PASSWORD_WRONG')
      throw new VaultError('VAULT_KEY_UNREADABLE', { cause: error })
    }
  }

  if (!(await options.wrapper.isAvailable())) throw new VaultError('VAULT_UNAVAILABLE')
  let unwrapped: { key: Buffer; rewrap: boolean }
  try {
    unwrapped = await options.wrapper.unwrap(keyWrap.wrappedKey)
  } catch (error) {
    throw new VaultError('VAULT_KEY_UNREADABLE', { cause: error })
  }
  if (unwrapped.key.length !== VAULT_KEY_BYTES) throw new VaultError('VAULT_KEY_UNREADABLE')
  return lockOf(unwrapped.key, unwrapped.rewrap)
}

async function readVaultText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return null
    throw new VaultError('VAULT_CORRUPT', { cause: error })
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

/** Copies the file into the backup folder (if it exists) and keeps the ten newest. */
export async function backupFile(filePath: string, backupDir: string): Promise<void> {
  await mkdir(backupDir, { recursive: true })
  try {
    await copyFile(filePath, path.join(backupDir, backupName()))
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
  const backups = await listBackups(backupDir)
  const excess = backups.slice(0, Math.max(0, backups.length - VAULT_BACKUP_COUNT))
  await Promise.all(excess.map((name) => rm(path.join(backupDir, name), { force: true })))
}

let backupCounter = 0

/** Sorts by time: vault-2026-11-16T10-20-30-123Z-0001.json */
function backupName(): string {
  backupCounter = (backupCounter + 1) % 10_000
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `vault-${stamp}-${String(backupCounter).padStart(4, '0')}.json`
}

const BACKUP_NAME = /^vault-[\w-]+\.json$/

/** Backup file names, oldest first. */
export async function listBackups(backupDir: string): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(backupDir)
  } catch (error) {
    if (isMissingFile(error)) return []
    throw error
  }
  return names.filter((name) => BACKUP_NAME.test(name)).sort()
}

export interface BackupInfo {
  name: string
  /** When the copy was made (the file's time). */
  savedAt: string
  size: number
  /** null when the file cannot be read as a vault. */
  protection: VaultProtection | null
}

/** The automatic backups, newest first, with what the restore screen shows. */
export async function describeBackups(backupDir: string): Promise<BackupInfo[]> {
  const names = await listBackups(backupDir)
  const infos = await Promise.all(
    names.map(async (name): Promise<BackupInfo | null> => {
      const file = path.join(backupDir, name)
      try {
        const [info, text] = await Promise.all([stat(file), readFile(file, 'utf8')])
        let protection: VaultProtection | null = null
        try {
          protection = parseEnvelope(text).keyWrap.type
        } catch {
          protection = null
        }
        return { name, savedAt: info.mtime.toISOString(), size: info.size, protection }
      } catch {
        return null
      }
    }),
  )
  return infos.filter((info) => info !== null).reverse()
}

/** The text of one backup, by a name from listBackups (never a path). */
export async function readBackup(backupDir: string, name: string): Promise<string> {
  if (!BACKUP_NAME.test(name) || !(await listBackups(backupDir)).includes(name)) {
    throw new VaultError('VAULT_BACKUP_UNREADABLE')
  }
  try {
    return await readFile(path.join(backupDir, name), 'utf8')
  } catch (error) {
    throw new VaultError('VAULT_BACKUP_UNREADABLE', { cause: error })
  }
}

/** Throws VaultError unless `text` is a vault file this app version can read. */
export function checkVaultText(text: string): VaultProtection {
  return parseEnvelope(text).keyWrap.type
}
