import { randomBytes, scrypt } from 'node:crypto'
import { z } from 'zod'
import { open as openBox, seal, VAULT_KEY_BYTES } from './crypto'

/**
 * Master password: the vault key is encrypted (AES-256-GCM) with a key that
 * scrypt derives from the password (AGENTS.md, architecture rule 5). Only the
 * salt, the scrypt cost and the encrypted vault key are stored.
 */
export interface ScryptCost {
  N: number
  r: number
  p: number
}

/** N=2^17, r=8, p=1: about 128 MiB and a fraction of a second per try. */
export const SCRYPT_COST: ScryptCost = { N: 2 ** 17, r: 8, p: 1 }
const SALT_BYTES = 16

const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/)
const powerOfTwo = z
  .int()
  // 2^14 (tests) up to 2^20; a file cannot ask for an absurd amount of memory.
  .min(2 ** 14)
  .max(2 ** 20)
  .refine((n) => (n & (n - 1)) === 0)

export const passwordKeyWrapSchema = z.object({
  type: z.literal('password'),
  kdf: z.literal('scrypt'),
  N: powerOfTwo,
  r: z.int().min(1).max(32),
  p: z.int().min(1).max(4),
  salt: base64.min(1),
  nonce: base64.min(1),
  tag: base64.min(1),
  wrappedKey: base64.min(1),
})
export type PasswordKeyWrap = z.infer<typeof passwordKeyWrapSchema>

/** Thrown when the password does not open the key. Carries no detail. */
export class WrongPasswordError extends Error {
  constructor() {
    super('wrong password')
    this.name = 'WrongPasswordError'
  }
}

function derive(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // scrypt needs 128 * N * r bytes; allow twice that.
    const maxmem = 256 * cost.N * cost.r
    scrypt(
      password.normalize('NFC'),
      salt,
      32,
      { N: cost.N, r: cost.r, p: cost.p, maxmem },
      (error, key) => {
        if (error === null) resolve(key)
        else reject(error)
      },
    )
  })
}

function wrapAad(wrap: Pick<PasswordKeyWrap, 'kdf' | 'N' | 'r' | 'p' | 'salt'>): Buffer {
  return Buffer.from(
    JSON.stringify(['kelidar-key-wrap', wrap.kdf, wrap.N, wrap.r, wrap.p, wrap.salt]),
    'utf8',
  )
}

export async function wrapWithPassword(
  vaultKey: Buffer,
  password: string,
  cost: ScryptCost = SCRYPT_COST,
): Promise<PasswordKeyWrap> {
  const salt = randomBytes(SALT_BYTES)
  const derived = await derive(password, salt, cost)
  const header = { kdf: 'scrypt' as const, ...cost, salt: salt.toString('base64') }
  try {
    const box = seal(derived, vaultKey, wrapAad(header))
    return {
      type: 'password',
      ...header,
      nonce: box.nonce.toString('base64'),
      tag: box.tag.toString('base64'),
      wrappedKey: box.ciphertext.toString('base64'),
    }
  } finally {
    derived.fill(0)
  }
}

export async function unwrapWithPassword(wrap: PasswordKeyWrap, password: string): Promise<Buffer> {
  const derived = await derive(password, Buffer.from(wrap.salt, 'base64'), wrap)
  try {
    const key = openBox(
      derived,
      {
        nonce: Buffer.from(wrap.nonce, 'base64'),
        tag: Buffer.from(wrap.tag, 'base64'),
        ciphertext: Buffer.from(wrap.wrappedKey, 'base64'),
      },
      wrapAad(wrap),
    )
    if (key.length !== VAULT_KEY_BYTES) throw new WrongPasswordError()
    return key
  } catch {
    throw new WrongPasswordError()
  } finally {
    derived.fill(0)
  }
}
