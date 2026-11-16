import { randomUUID } from 'node:crypto'
import type { ParsedKey } from 'ssh2'
import type { AuthRequest, SignInView } from '@shared/keychain'
import type { AuthRef, Id } from '@shared/records'
import type { KeyFileImports, PendingKeyFile } from '../hosts/key-files'
import { AppError } from '../ipc/app-error'
import type { Credential } from '../ssh/auth'
import { describePublicKey, inspectPrivateKey } from '../ssh/keys'
import type { VaultData } from '../vault/vault'

/**
 * Sign-in storage shared by hosts and identities.
 * - A password belongs to the host or identity that saved it: replacing or
 *   deleting that record retires the secret.
 * - A key belongs to the Keychain: hosts and identities only point at it, and
 *   it is deleted only from the Keychain (never while something uses it).
 */

export function live(record: { deletedAt?: string | undefined }): boolean {
  return record.deletedAt === undefined
}

export function addSecret(data: VaultData, value: string, now: string): Id {
  const id = randomUUID()
  data.secrets.push({ id, createdAt: now, updatedAt: now, value })
  return id
}

/** Tombstone: keeps the id for merging later, drops the value. */
export function retireSecret(data: VaultData, id: Id, now: string): void {
  const secret = data.secrets.find((item) => item.id === id && live(item))
  if (secret === undefined) return
  secret.value = ''
  secret.deletedAt = now
  secret.updatedAt = now
}

/** Retires what the record owns: its password. Keys stay in the Keychain. */
export function retireAuth(data: VaultData, auth: AuthRef | undefined, now: string): void {
  if (auth?.type === 'password') retireSecret(data, auth.secretId, now)
}

export function secretValue(data: VaultData, id: Id | undefined): string | undefined {
  if (id === undefined) return undefined
  return data.secrets.find((item) => item.id === id && live(item))?.value
}

export interface NewKey {
  name: string
  privateKey: string
  parsed: ParsedKey
  /** Stored only when the key file is encrypted with it. */
  passphrase?: string | undefined
  encrypted: boolean
}

/** Adds a key to the Keychain and returns its id. */
export function addKey(data: VaultData, key: NewKey, now: string): Id {
  const id = randomUUID()
  data.keys.push({
    id,
    createdAt: now,
    updatedAt: now,
    name: key.name.slice(0, 260),
    ...describePublicKey(key.parsed),
    privateKeySecretId: addSecret(data, key.privateKey, now),
    ...(key.encrypted && key.passphrase !== undefined && key.passphrase !== ''
      ? { passphraseSecretId: addSecret(data, key.passphrase, now) }
      : {}),
  })
  return id
}

/** Checks a key file and its passphrase before anything is saved. */
export function checkKeyFile(file: PendingKeyFile, passphrase: string | undefined): NewKey {
  const inspected = inspectPrivateKey(file.content, passphrase)
  if (inspected.parsed === undefined) throw new AppError('KEY_PASSPHRASE_REQUIRED')
  return {
    name: file.fileName,
    privateKey: file.content,
    parsed: inspected.parsed,
    passphrase,
    encrypted: inspected.encrypted,
  }
}

export function toSignInView(data: VaultData, auth: AuthRef | undefined): SignInView {
  if (auth === undefined || auth.type === 'ask') return { method: 'ask' }
  if (auth.type === 'password') return { method: 'password' }
  if (auth.type === 'agent') return { method: 'agent' }
  const key = data.keys.find((item) => item.id === auth.keyId && live(item))
  if (key === undefined) return { method: 'ask' }
  return {
    method: 'key',
    keyId: key.id,
    keyName: key.name,
    keyType: key.type,
    hasPassphrase: key.passphraseSecretId !== undefined,
  }
}

/** Main only: the credential with its secret values. */
export function credentialFor(data: VaultData, auth: AuthRef | undefined): Credential {
  if (auth?.type === 'password') {
    const password = secretValue(data, auth.secretId)
    return password === undefined ? { type: 'ask' } : { type: 'password', password }
  }
  if (auth?.type === 'agent') return { type: 'agent' }
  if (auth?.type === 'key') {
    const key = data.keys.find((item) => item.id === auth.keyId && live(item))
    const privateKey = secretValue(data, key?.privateKeySecretId)
    if (key === undefined || privateKey === undefined) throw new AppError('KEY_REQUIRED')
    const passphrase = secretValue(data, key.passphraseSecretId)
    return {
      type: 'key',
      privateKey,
      keyName: key.name,
      ...(passphrase === undefined ? {} : { passphrase }),
    }
  }
  return { type: 'ask' }
}

/** An auth request whose key material has been checked, ready for applyAuth. */
export type CheckedAuth =
  | { type: 'password'; password: string | undefined }
  | { type: 'newKey'; key: NewKey; token?: string | undefined }
  | { type: 'keepKey'; newPassphrase?: string | undefined }
  | { type: 'savedKey'; keyId: Id }
  | { type: 'agent' }

/**
 * Validates a request outside the vault update, so a wrong passphrase or a
 * missing key saves nothing. `sessionKey` is a key from a Quick Connect session.
 */
export function checkAuth(
  data: VaultData,
  request: AuthRequest,
  previous: AuthRef | undefined,
  keyFiles: KeyFileImports,
  sessionKey?: PendingKeyFile,
): CheckedAuth {
  if (request.type === 'password') return { type: 'password', password: request.password }
  if (request.type === 'agent') return { type: 'agent' }
  if (request.type === 'savedKey') {
    if (!data.keys.some((key) => key.id === request.keyId && live(key))) {
      throw new AppError('KEY_NOT_FOUND')
    }
    return { type: 'savedKey', keyId: request.keyId }
  }
  if (sessionKey !== undefined || request.keyFileToken !== undefined) {
    const file = sessionKey ?? keyFiles.peek(request.keyFileToken ?? '')
    return {
      type: 'newKey',
      key: checkKeyFile(file, request.passphrase),
      token: request.keyFileToken,
    }
  }
  // Keep the key in use, maybe with a new passphrase.
  if (previous?.type !== 'key') throw new AppError('KEY_REQUIRED')
  const key = data.keys.find((item) => item.id === previous.keyId && live(item))
  const content = secretValue(data, key?.privateKeySecretId)
  if (key === undefined || content === undefined) throw new AppError('KEY_REQUIRED')
  if (request.passphrase === undefined || request.passphrase === '') return { type: 'keepKey' }
  return inspectPrivateKey(content, request.passphrase).encrypted
    ? { type: 'keepKey', newPassphrase: request.passphrase }
    : { type: 'keepKey' }
}

function sameAuth(a: AuthRef | undefined, b: AuthRef): boolean {
  if (a === undefined || a.type !== b.type) return false
  if (a.type === 'password' && b.type === 'password') return a.secretId === b.secretId
  if (a.type === 'key' && b.type === 'key') return a.keyId === b.keyId
  return true
}

/** Runs inside a vault update. Returns the new auth and retires what it replaced. */
export function applyAuth(
  data: VaultData,
  checked: CheckedAuth,
  previous: AuthRef | undefined,
  now: string,
): AuthRef {
  let next: AuthRef
  if (checked.type === 'password') {
    const password = checked.password
    if (password === undefined) {
      next = previous?.type === 'password' ? previous : { type: 'ask' }
    } else if (password === '') {
      next = { type: 'ask' }
    } else if (previous?.type === 'password') {
      const secret = data.secrets.find((item) => item.id === previous.secretId && live(item))
      if (secret === undefined) {
        next = { type: 'password', secretId: addSecret(data, password, now) }
      } else {
        secret.value = password
        secret.updatedAt = now
        next = previous
      }
    } else {
      next = { type: 'password', secretId: addSecret(data, password, now) }
    }
  } else if (checked.type === 'newKey') {
    next = { type: 'key', keyId: addKey(data, checked.key, now) }
  } else if (checked.type === 'savedKey') {
    next = { type: 'key', keyId: checked.keyId }
  } else if (checked.type === 'agent') {
    next = { type: 'agent' }
  } else {
    if (previous?.type !== 'key') throw new AppError('KEY_REQUIRED')
    next = previous
    const key = data.keys.find((item) => item.id === previous.keyId && live(item))
    if (key !== undefined && checked.newPassphrase !== undefined) {
      if (key.passphraseSecretId !== undefined) retireSecret(data, key.passphraseSecretId, now)
      key.passphraseSecretId = addSecret(data, checked.newPassphrase, now)
      key.updatedAt = now
    }
  }
  if (!sameAuth(previous, next)) retireAuth(data, previous, now)
  return next
}
