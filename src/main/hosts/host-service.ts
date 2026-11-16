import { randomUUID } from 'node:crypto'
import { resolveHostSettings } from '@shared/groups'
import type { HostView, ParsedHostSaveRequest } from '@shared/hosts'
import type { AuthRef, HostRecord, Id } from '@shared/records'
import { AppError } from '../ipc/app-error'
import type { Credential, UsedCredential } from '../ssh/auth'
import { describePublicKey, inspectPrivateKey } from '../ssh/keys'
import type { ConnectTarget } from '../ssh/session-manager'
import type { VaultService } from '../vault/service'
import type { VaultData } from '../vault/vault'
import type { KeyFileImports, PendingKeyFile } from './key-files'

export function live(record: { deletedAt?: string | undefined }): boolean {
  return record.deletedAt === undefined
}

/** Tombstone: keeps the id for merging later, drops the value. */
function retireSecret(data: VaultData, id: Id, now: string): void {
  const secret = data.secrets.find((item) => item.id === id && live(item))
  if (secret === undefined) return
  secret.value = ''
  secret.deletedAt = now
  secret.updatedAt = now
}

function retireAuth(data: VaultData, auth: AuthRef | undefined, now: string): void {
  if (auth?.type === 'password') retireSecret(data, auth.secretId, now)
  if (auth?.type === 'key') {
    const key = data.keys.find((item) => item.id === auth.keyId && live(item))
    if (key === undefined) return
    key.deletedAt = now
    key.updatedAt = now
    retireSecret(data, key.privateKeySecretId, now)
    if (key.passphraseSecretId !== undefined) retireSecret(data, key.passphraseSecretId, now)
  }
}

function addSecret(data: VaultData, value: string, now: string): Id {
  const id = randomUUID()
  data.secrets.push({ id, createdAt: now, updatedAt: now, value })
  return id
}

function sameAuth(a: AuthRef | undefined, b: AuthRef): boolean {
  if (a === undefined || a.type !== b.type) return false
  if (a.type === 'password' && b.type === 'password') return a.secretId === b.secretId
  if (a.type === 'key' && b.type === 'key') return a.keyId === b.keyId
  return true
}

export function toHostView(data: VaultData, host: HostRecord): HostView {
  const auth = host.auth ?? { type: 'ask' }
  let signIn: HostView['signIn'] = { method: 'ask' }
  if (auth.type === 'password') signIn = { method: 'password' }
  if (auth.type === 'key') {
    const key = data.keys.find((item) => item.id === auth.keyId)
    signIn =
      key === undefined
        ? { method: 'ask' }
        : {
            method: 'key',
            keyName: key.name,
            keyType: key.type,
            hasPassphrase: key.passphraseSecretId !== undefined,
          }
  }
  const groups = data.groups.filter(live)
  const groupId = groups.some((group) => group.id === host.groupId) ? host.groupId : undefined
  const effective = resolveHostSettings({ ...host, groupId }, groups)
  return {
    id: host.id,
    name: host.name,
    address: host.address,
    port: effective.port.value,
    ...(host.port === undefined ? {} : { ownPort: host.port }),
    username: host.username ?? '',
    ...(groupId === undefined ? {} : { groupId }),
    tags: host.tags,
    ...(host.color === undefined ? {} : { color: host.color }),
    ...(effective.environment.value === undefined
      ? {}
      : { environment: effective.environment.value }),
    ...(host.environment === undefined ? {} : { ownEnvironment: host.environment }),
    favorite: host.favorite === true,
    signIn,
    createdAt: host.createdAt,
    updatedAt: host.updatedAt,
    ...(host.lastConnectedAt === undefined ? {} : { lastConnectedAt: host.lastConnectedAt }),
  }
}

/** Sets an optional field, or removes it when the value is undefined. */
function setOptional<K extends 'port' | 'groupId' | 'color' | 'environment'>(
  host: HostRecord,
  key: K,
  value: HostRecord[K],
): void {
  if (value === undefined) Reflect.deleteProperty(host, key)
  else host[key] = value
}

/** Checks a new key file (and its passphrase) before anything is saved. */
function checkNewKey(file: PendingKeyFile, passphrase: string | undefined) {
  const inspected = inspectPrivateKey(file.content, passphrase)
  if (inspected.parsed === undefined) throw new AppError('KEY_PASSPHRASE_REQUIRED')
  return { parsed: inspected.parsed, encrypted: inspected.encrypted }
}

/**
 * Saved hosts. All reads and writes go through the vault; the renderer only
 * ever receives HostView objects.
 */
export class HostService {
  constructor(
    private readonly vaults: VaultService,
    private readonly keyFiles: KeyFileImports,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<HostView[]> {
    const data = (await this.vaults.get()).read()
    return data.hosts
      .filter(live)
      .map((host) => toHostView(data, host))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }

  /**
   * `fromSession` is the sign-in that worked in the Quick Connect session the
   * request names (looked up by the IPC handler); undefined means none.
   */
  async save(request: ParsedHostSaveRequest, fromSession?: UsedCredential): Promise<HostView> {
    const vault = await this.vaults.get()
    const before = vault.read()
    const existing =
      request.id === undefined
        ? undefined
        : before.hosts.find((host) => host.id === request.id && live(host))
    if (request.id !== undefined && existing === undefined) throw new AppError('HOST_NOT_FOUND')
    if (
      request.groupId !== undefined &&
      !before.groups.some((group) => group.id === request.groupId && live(group))
    ) {
      throw new AppError('GROUP_NOT_FOUND')
    }

    // "Use the sign-in from this connection" becomes a password or a key file.
    let auth: Exclude<ParsedHostSaveRequest['auth'], { type: 'fromSession' }>
    let sessionKey: PendingKeyFile | undefined
    if (request.auth.type !== 'fromSession') auth = request.auth
    else if (fromSession === undefined) auth = { type: 'password', password: '' }
    else if (fromSession.type === 'password') {
      auth = { type: 'password', password: fromSession.password }
    } else {
      auth = {
        type: 'key',
        ...(fromSession.passphrase === undefined ? {} : { passphrase: fromSession.passphrase }),
      }
      sessionKey = {
        fileName: fromSession.keyName,
        content: fromSession.privateKey,
        encrypted: fromSession.passphrase !== undefined,
      }
    }

    // Validate key material first, so a wrong passphrase saves nothing.
    let newKey: { file: PendingKeyFile; checked: ReturnType<typeof checkNewKey> } | undefined
    let keptKeyPassphrase: string | undefined
    if (auth.type === 'key') {
      if (auth.keyFileToken !== undefined || sessionKey !== undefined) {
        const file = sessionKey ?? this.keyFiles.peek(auth.keyFileToken ?? '')
        newKey = { file, checked: checkNewKey(file, auth.passphrase) }
      } else {
        const keyAuth = existing?.auth
        if (keyAuth?.type !== 'key') throw new AppError('KEY_REQUIRED')
        if (auth.passphrase !== undefined && auth.passphrase !== '') {
          const key = before.keys.find((item) => item.id === keyAuth.keyId)
          const content = before.secrets.find((item) => item.id === key?.privateKeySecretId)
          if (content === undefined) throw new AppError('KEY_REQUIRED')
          if (inspectPrivateKey(content.value, auth.passphrase).encrypted) {
            keptKeyPassphrase = auth.passphrase
          }
        }
      }
    }

    const saved = await vault.update((data) => {
      const now = this.now().toISOString()
      const current = data.hosts.find((host) => host.id === request.id && live(host))
      const previousAuth = current?.auth
      let nextAuth: AuthRef

      if (auth.type === 'password') {
        if (auth.password === undefined) {
          nextAuth = previousAuth?.type === 'password' ? previousAuth : { type: 'ask' }
        } else if (auth.password === '') {
          nextAuth = { type: 'ask' }
        } else if (previousAuth?.type === 'password') {
          const secret = data.secrets.find((item) => item.id === previousAuth.secretId)
          if (secret === undefined) {
            nextAuth = { type: 'password', secretId: addSecret(data, auth.password, now) }
          } else {
            secret.value = auth.password
            secret.updatedAt = now
            nextAuth = previousAuth
          }
        } else {
          nextAuth = { type: 'password', secretId: addSecret(data, auth.password, now) }
        }
      } else if (newKey !== undefined) {
        const { file, checked } = newKey
        const keyId = randomUUID()
        const passphrase = auth.passphrase
        data.keys.push({
          id: keyId,
          createdAt: now,
          updatedAt: now,
          name: file.fileName,
          ...describePublicKey(checked.parsed),
          privateKeySecretId: addSecret(data, file.content, now),
          ...(checked.encrypted && passphrase !== undefined
            ? { passphraseSecretId: addSecret(data, passphrase, now) }
            : {}),
        })
        nextAuth = { type: 'key', keyId }
      } else {
        // Keep the saved key; maybe with a new passphrase.
        if (previousAuth?.type !== 'key') throw new AppError('KEY_REQUIRED')
        nextAuth = previousAuth
        const key = data.keys.find((item) => item.id === previousAuth.keyId)
        if (key !== undefined && keptKeyPassphrase !== undefined) {
          if (key.passphraseSecretId !== undefined) retireSecret(data, key.passphraseSecretId, now)
          key.passphraseSecretId = addSecret(data, keptKeyPassphrase, now)
          key.updatedAt = now
        }
      }

      if (!sameAuth(previousAuth, nextAuth)) retireAuth(data, previousAuth, now)

      const fields = {
        name: request.name,
        address: request.address,
        username: request.username,
        auth: nextAuth,
        tags: request.tags ?? [],
      }
      const host: HostRecord = current ?? {
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        ...fields,
      }
      Object.assign(host, fields, { updatedAt: now })
      setOptional(host, 'port', request.port)
      setOptional(host, 'groupId', request.groupId)
      setOptional(host, 'color', request.color)
      setOptional(host, 'environment', request.environment)
      if (current === undefined) data.hosts.push(host)
      return toHostView(data, host)
    })
    if (auth.type === 'key' && auth.keyFileToken !== undefined) {
      this.keyFiles.discard(auth.keyFileToken)
    }
    return saved
  }

  async setFavorite(id: Id, favorite: boolean): Promise<HostView> {
    const vault = await this.vaults.get()
    return vault.update((data) => {
      const host = data.hosts.find((item) => item.id === id && live(item))
      if (host === undefined) throw new AppError('HOST_NOT_FOUND')
      if (favorite) host.favorite = true
      else delete host.favorite
      host.updatedAt = this.now().toISOString()
      return toHostView(data, host)
    })
  }

  /**
   * Remembers when a session to the host was last ready, for "Recent".
   * Not an edit, so updatedAt stays.
   */
  async markConnected(id: Id): Promise<void> {
    const vault = await this.vaults.get()
    await vault.update((data) => {
      const host = data.hosts.find((item) => item.id === id && live(item))
      if (host !== undefined) host.lastConnectedAt = this.now().toISOString()
    })
  }

  async delete(id: Id): Promise<void> {
    const vault = await this.vaults.get()
    await vault.update((data) => {
      const host = data.hosts.find((item) => item.id === id && live(item))
      if (host === undefined) throw new AppError('HOST_NOT_FOUND')
      const now = this.now().toISOString()
      retireAuth(data, host.auth, now)
      host.deletedAt = now
      host.updatedAt = now
    })
  }

  /** Main only: everything a session needs, including the secret values. */
  async connectTarget(id: Id): Promise<ConnectTarget> {
    const data = (await this.vaults.get()).read()
    const host = data.hosts.find((item) => item.id === id && live(item))
    if (host === undefined) throw new AppError('HOST_NOT_FOUND')
    const secret = (secretId: Id | undefined): string | undefined =>
      data.secrets.find((item) => item.id === secretId && live(item))?.value

    let credential: Credential = { type: 'ask' }
    const auth = host.auth
    if (auth?.type === 'password') {
      const password = secret(auth.secretId)
      if (password !== undefined) credential = { type: 'password', password }
    } else if (auth?.type === 'key') {
      const key = data.keys.find((item) => item.id === auth.keyId && live(item))
      const privateKey = secret(key?.privateKeySecretId)
      if (key === undefined || privateKey === undefined) throw new AppError('KEY_REQUIRED')
      const passphrase = secret(key.passphraseSecretId)
      credential = {
        type: 'key',
        privateKey,
        keyName: key.name,
        ...(passphrase === undefined ? {} : { passphrase }),
      }
    }
    return {
      hostId: host.id,
      title: host.name,
      address: host.address,
      port: toHostView(data, host).port,
      username: host.username ?? '',
      credential,
    }
  }
}
