import { createHash, randomBytes } from 'node:crypto'
import { utils, type ParsedKey } from 'ssh2'
import type { KeyKind } from '@shared/records'
import { AppError } from '../ipc/app-error'

/** OpenSSH style: SHA256:<base64 without padding> of the SSH wire-format key. */
export function sha256Fingerprint(publicKeyBlob: Buffer): string {
  const digest = createHash('sha256').update(publicKeyBlob).digest('base64')
  return `SHA256:${digest.replace(/=+$/, '')}`
}

export function keyKindOf(type: ParsedKey['type']): KeyKind {
  if (type === 'ssh-ed25519') return 'ed25519'
  if (type === 'ssh-rsa') return 'rsa'
  if (type === 'ssh-dss') return 'dsa'
  return 'ecdsa'
}

export interface InspectedKey {
  encrypted: boolean
  /** Known only once the key can be read (not encrypted, or the passphrase was right). */
  parsed?: ParsedKey
}

function firstKey(result: ParsedKey | ParsedKey[] | Error): ParsedKey | Error {
  if (Array.isArray(result)) return result[0] ?? new Error('No key found')
  return result
}

/** True when ssh2 refused the key only because it needs a passphrase. */
function needsPassphrase(error: Error): boolean {
  return /passphrase|encrypted/i.test(error.message)
}

/**
 * Reads a private key file (OpenSSH, PEM or PuTTY PPK). Error messages from
 * the parser are never passed on: they only become codes.
 */
export function inspectPrivateKey(content: string, passphrase?: string): InspectedKey {
  const plain = firstKey(utils.parseKey(content))
  if (!(plain instanceof Error)) {
    if (!plain.isPrivateKey()) throw new AppError('KEY_INVALID')
    return { encrypted: false, parsed: plain }
  }
  if (!needsPassphrase(plain)) throw new AppError('KEY_INVALID')
  if (passphrase === undefined || passphrase === '') return { encrypted: true }
  const unlocked = firstKey(utils.parseKey(content, passphrase))
  if (unlocked instanceof Error) throw new AppError('KEY_PASSPHRASE_WRONG')
  if (!unlocked.isPrivateKey()) throw new AppError('KEY_INVALID')
  return { encrypted: true, parsed: unlocked }
}

export function describePublicKey(parsed: ParsedKey): {
  type: KeyKind
  publicKey: string
  fingerprint: string
} {
  const blob = parsed.getPublicSSH()
  return {
    type: keyKindOf(parsed.type),
    publicKey: `${parsed.type} ${blob.toString('base64')}`,
    fingerprint: sha256Fingerprint(blob),
  }
}

export type GeneratedKeyKind = 'ed25519' | 'rsa'

/** RSA keys are generated at 4096 bits; ed25519 has a fixed size. */
export const RSA_BITS = 4096

function generatePair(
  type: GeneratedKeyKind,
  passphrase: string | undefined,
): Promise<{ private: string; public: string }> {
  const encryption =
    passphrase === undefined || passphrase === ''
      ? {}
      : { passphrase, cipher: 'aes256-ctr', rounds: 16 }
  const options = { comment: 'kelidar', ...encryption }
  return new Promise((resolve, reject) => {
    const done = (error: Error | null, pair: { private: string; public: string }): void => {
      if (error === null) resolve(pair)
      else reject(error)
    }
    if (type === 'rsa') utils.generateKeyPair('rsa', { bits: RSA_BITS, ...options }, done)
    else utils.generateKeyPair('ed25519', options, done)
  })
}

/**
 * Makes a new key pair. ssh2 now and then (about 1 in 200 ed25519 keys)
 * returns a private key its own parser refuses, so every key is read back
 * and must sign and verify before it is used; a bad one is replaced.
 */
export async function generateKey(
  type: GeneratedKeyKind,
  passphrase?: string,
): Promise<{ privateKey: string; parsed: ParsedKey }> {
  for (let attempt = 0; attempt < 10; attempt++) {
    let pair: { private: string; public: string }
    try {
      pair = await generatePair(type, passphrase)
    } catch (error) {
      throw new AppError('KEY_GENERATE_FAILED', { cause: error })
    }
    const parsed = firstKey(
      utils.parseKey(pair.private, passphrase === '' ? undefined : passphrase),
    )
    if (parsed instanceof Error || !parsed.isPrivateKey()) continue
    const probe = randomBytes(32)
    const signature = parsed.sign(probe)
    if (signature instanceof Error || !parsed.verify(probe, signature)) continue
    return { privateKey: pair.private, parsed }
  }
  throw new AppError('KEY_GENERATE_FAILED')
}
