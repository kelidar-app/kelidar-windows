import { randomBytes, scrypt } from 'node:crypto'
import { z } from 'zod'
import { APP } from '@shared/app'
import { open as openBox, seal } from './crypto'
import { migrateVaultData } from './migrations'
import { SCRYPT_COST, type ScryptCost } from './password-wrap'
import { vaultDataSchema, type VaultData } from './vault'

/**
 * A manual backup: the whole vault in one file, encrypted with a password
 * the user picks for it (scrypt, then AES-256-GCM). It opens on any
 * computer, unlike the automatic backups that need this Windows account.
 */
export const EXPORT_FORMAT = 'kelidar-export'
const EXPORT_VERSION = 1
export const EXPORT_EXTENSION = APP.protocolHost
/** Bigger files are not exports; checked before reading. */
export const MAX_EXPORT_BYTES = 64 * 1024 * 1024

const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/)
const exportHeaderSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  kdf: z.literal('scrypt'),
  N: z
    .int()
    .min(2 ** 14)
    .max(2 ** 20)
    .refine((n) => (n & (n - 1)) === 0),
  r: z.int().min(1).max(32),
  p: z.int().min(1).max(4),
  salt: base64.min(1),
  cipher: z.literal('aes-256-gcm'),
})
const exportFileSchema = exportHeaderSchema.extend({
  nonce: base64.min(1),
  tag: base64.min(1),
  data: base64,
})
type ExportHeader = z.infer<typeof exportHeaderSchema>

/** Why an export file could not be read; carries no detail. */
export class ExportFileError extends Error {
  constructor(readonly reason: 'invalid' | 'password' | 'newer') {
    super(reason)
    this.name = 'ExportFileError'
  }
}

function deriveKey(password: string, header: ExportHeader): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFC'),
      Buffer.from(header.salt, 'base64'),
      32,
      { N: header.N, r: header.r, p: header.p, maxmem: 256 * header.N * header.r },
      (error, key) => {
        if (error === null) resolve(key)
        else reject(error)
      },
    )
  })
}

function headerAad(header: ExportHeader): Buffer {
  return Buffer.from(
    JSON.stringify([
      header.format,
      header.version,
      header.kdf,
      header.N,
      header.r,
      header.p,
      header.salt,
      header.cipher,
    ]),
    'utf8',
  )
}

export async function createExport(
  data: VaultData,
  password: string,
  cost: ScryptCost = SCRYPT_COST,
  now: Date = new Date(),
): Promise<string> {
  const header: ExportHeader = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    kdf: 'scrypt',
    ...cost,
    salt: randomBytes(16).toString('base64'),
    cipher: 'aes-256-gcm',
  }
  const key = await deriveKey(password, header)
  try {
    const body = JSON.stringify({ exportedAt: now.toISOString(), vault: data })
    const box = seal(key, Buffer.from(body, 'utf8'), headerAad(header))
    const file = {
      ...header,
      nonce: box.nonce.toString('base64'),
      tag: box.tag.toString('base64'),
      data: box.ciphertext.toString('base64'),
    }
    return `${JSON.stringify(file, null, 2)}\n`
  } finally {
    key.fill(0)
  }
}

/** Throws ExportFileError unless the text looks like an export (no password needed). */
export function checkExport(text: string): void {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ExportFileError('invalid')
  }
  const parsed = exportFileSchema.safeParse(raw)
  if (parsed.success) return
  const header = z.object({ format: z.literal(EXPORT_FORMAT), version: z.int() }).safeParse(raw)
  if (header.success && header.data.version > EXPORT_VERSION) throw new ExportFileError('newer')
  throw new ExportFileError('invalid')
}

export async function readExport(text: string, password: string): Promise<VaultData> {
  checkExport(text)
  const file = exportFileSchema.parse(JSON.parse(text))
  const key = await deriveKey(password, file)
  let plaintext: Buffer
  try {
    plaintext = openBox(
      key,
      {
        nonce: Buffer.from(file.nonce, 'base64'),
        tag: Buffer.from(file.tag, 'base64'),
        ciphertext: Buffer.from(file.data, 'base64'),
      },
      headerAad(file),
    )
  } catch {
    throw new ExportFileError('password')
  } finally {
    key.fill(0)
  }
  let body: unknown
  try {
    body = JSON.parse(plaintext.toString('utf8'))
  } catch {
    throw new ExportFileError('invalid')
  }
  const vault = z.object({ vault: z.unknown() }).safeParse(body)
  if (!vault.success) throw new ExportFileError('invalid')
  const migrated = migrateVaultData(vault.data.vault)
  if (migrated.status === 'future') throw new ExportFileError('newer')
  if (migrated.status === 'invalid') throw new ExportFileError('invalid')
  const parsed = vaultDataSchema.safeParse(migrated.data)
  if (!parsed.success) throw new ExportFileError('invalid')
  return parsed.data
}
