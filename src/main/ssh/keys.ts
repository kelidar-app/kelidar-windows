import { createHash } from 'node:crypto'
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
