import { randomUUID } from 'node:crypto'
import { groupDefaultsFor, resolveHostSettings } from '@shared/groups'
import type { HostView, ParsedHostSaveRequest } from '@shared/hosts'
import type { AuthRequest } from '@shared/keychain'
import type { AuthRef, HostRecord, Id, IdentityRecord } from '@shared/records'
import { AppError } from '../ipc/app-error'
import {
  applyAuth,
  checkAuth,
  credentialFor,
  live,
  retireAuth,
  toSignInView,
  type CheckedAuth,
} from '../keychain/auth-store'
import type { UsedCredential } from '../ssh/auth'
import type { ConnectTarget } from '../ssh/session-manager'
import type { VaultService } from '../vault/service'
import type { VaultData } from '../vault/vault'
import type { KeyFileImports, PendingKeyFile } from './key-files'

export { live } from '../keychain/auth-store'

/**
 * How a host signs in, after looking at its identity and its group:
 * - its own identity, or
 * - its own user name and auth, or
 * - with neither, its group's identity.
 */
export function effectiveSignIn(
  data: VaultData,
  host: HostRecord,
): {
  identity?: { record: IdentityRecord | undefined; from: 'host' | 'group' }
  username: string | undefined
  auth: AuthRef | undefined
} {
  const findIdentity = (id: Id): IdentityRecord | undefined =>
    data.identities.find((item) => item.id === id && live(item))
  if (host.identityId !== undefined) {
    const record = findIdentity(host.identityId)
    return { identity: { record, from: 'host' }, username: record?.username, auth: record?.auth }
  }
  if (host.username === undefined && host.auth === undefined) {
    const groupIdentity = groupDefaultsFor(host.groupId, data.groups.filter(live)).identityId.value
    if (groupIdentity !== undefined) {
      const record = findIdentity(groupIdentity)
      return {
        identity: { record, from: 'group' },
        username: record?.username,
        auth: record?.auth,
      }
    }
  }
  return { username: host.username, auth: host.auth }
}

export function toHostView(data: VaultData, host: HostRecord): HostView {
  const groups = data.groups.filter(live)
  const groupId = groups.some((group) => group.id === host.groupId) ? host.groupId : undefined
  const effective = resolveHostSettings({ ...host, groupId }, groups)
  const signIn = effectiveSignIn(data, { ...host, groupId })
  const identity = signIn.identity?.record
  return {
    id: host.id,
    name: host.name,
    address: host.address,
    port: effective.port.value,
    ...(host.port === undefined ? {} : { ownPort: host.port }),
    username: signIn.username ?? '',
    ...(host.username === undefined ? {} : { ownUsername: host.username }),
    ...(groupId === undefined ? {} : { groupId }),
    tags: host.tags,
    ...(host.color === undefined ? {} : { color: host.color }),
    ...(effective.environment.value === undefined
      ? {}
      : { environment: effective.environment.value }),
    ...(host.environment === undefined ? {} : { ownEnvironment: host.environment }),
    favorite: host.favorite === true,
    signIn: toSignInView(data, signIn.auth),
    ...(identity === undefined || signIn.identity === undefined
      ? {}
      : { identity: { id: identity.id, name: identity.name, from: signIn.identity.from } }),
    agentForward: host.agentForward === true,
    createdAt: host.createdAt,
    updatedAt: host.updatedAt,
    ...(host.lastConnectedAt === undefined ? {} : { lastConnectedAt: host.lastConnectedAt }),
  }
}

type OptionalHostField = 'port' | 'groupId' | 'color' | 'environment' | 'identityId' | 'username'

/** Sets an optional field, or removes it when the value is undefined. */
function setOptional<K extends OptionalHostField>(
  host: HostRecord,
  key: K,
  value: HostRecord[K],
): void {
  if (value === undefined) Reflect.deleteProperty(host, key)
  else host[key] = value
}

/** What a save does to the host's sign-in. */
type SignInPlan =
  | { kind: 'identity'; identityId: Id }
  | { kind: 'inherit' }
  | { kind: 'own'; username: string; checked: CheckedAuth }

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

  async view(id: Id): Promise<HostView> {
    const data = (await this.vaults.get()).read()
    return toHostView(data, this.find(data, id))
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

    // Everything is checked before the vault changes, so an error saves nothing.
    const plan = this.planSignIn(before, request, existing, fromSession)

    const saved = await vault.update((data) => {
      const now = this.now().toISOString()
      const current = data.hosts.find((host) => host.id === request.id && live(host))
      const host: HostRecord = current ?? {
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        name: request.name,
        address: request.address,
        tags: [],
      }
      Object.assign(host, {
        name: request.name,
        address: request.address,
        tags: request.tags ?? [],
        updatedAt: now,
      })
      setOptional(host, 'port', request.port)
      setOptional(host, 'groupId', request.groupId)
      setOptional(host, 'color', request.color)
      setOptional(host, 'environment', request.environment)
      if (request.agentForward === true) host.agentForward = true
      else delete host.agentForward

      if (plan.kind === 'own') {
        host.auth = applyAuth(data, plan.checked, current?.auth, now)
        host.username = plan.username
        delete host.identityId
      } else {
        retireAuth(data, current?.auth, now)
        delete host.auth
        delete host.username
        setOptional(host, 'identityId', plan.kind === 'identity' ? plan.identityId : undefined)
      }
      if (current === undefined) data.hosts.push(host)
      return toHostView(data, host)
    })
    if (plan.kind === 'own' && plan.checked.type === 'newKey' && plan.checked.token !== undefined) {
      this.keyFiles.discard(plan.checked.token)
    }
    return saved
  }

  private planSignIn(
    data: VaultData,
    request: ParsedHostSaveRequest,
    existing: HostRecord | undefined,
    fromSession: UsedCredential | undefined,
  ): SignInPlan {
    const auth = request.auth
    if (auth.type === 'identity') {
      if (!data.identities.some((item) => item.id === auth.identityId && live(item))) {
        throw new AppError('IDENTITY_NOT_FOUND')
      }
      return { kind: 'identity', identityId: auth.identityId }
    }
    if (auth.type === 'inherit') return { kind: 'inherit' }
    if (request.username === undefined) throw new AppError('USERNAME_REQUIRED')

    // "Use the sign-in from this connection" becomes a password or a key file.
    let authRequest: AuthRequest
    let sessionKey: PendingKeyFile | undefined
    if (auth.type !== 'fromSession') authRequest = auth
    else if (fromSession === undefined) authRequest = { type: 'password', password: '' }
    else if (fromSession.type === 'password') {
      authRequest = { type: 'password', password: fromSession.password }
    } else {
      authRequest = {
        type: 'key',
        ...(fromSession.passphrase === undefined ? {} : { passphrase: fromSession.passphrase }),
      }
      sessionKey = {
        fileName: fromSession.keyName,
        content: fromSession.privateKey,
        encrypted: fromSession.passphrase !== undefined,
      }
    }
    // A host that used an identity has no auth of its own to keep.
    const previous = existing?.identityId === undefined ? existing?.auth : undefined
    return {
      kind: 'own',
      username: request.username,
      checked: checkAuth(data, authRequest, previous, this.keyFiles, sessionKey),
    }
  }

  async setFavorite(id: Id, favorite: boolean): Promise<HostView> {
    const vault = await this.vaults.get()
    return vault.update((data) => {
      const host = this.find(data, id)
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

  /**
   * After "Upgrade to key login": the host signs in with the key from now on
   * and its saved password is removed.
   */
  async switchToKey(id: Id, keyId: Id): Promise<HostView> {
    const vault = await this.vaults.get()
    return vault.update((data) => {
      const host = this.find(data, id)
      if (!data.keys.some((key) => key.id === keyId && live(key))) {
        throw new AppError('KEY_NOT_FOUND')
      }
      const now = this.now().toISOString()
      const signIn = effectiveSignIn(data, host)
      if (signIn.username === undefined) throw new AppError('USERNAME_REQUIRED')
      retireAuth(data, host.auth, now)
      host.username = signIn.username
      host.auth = { type: 'key', keyId }
      delete host.identityId
      host.updatedAt = now
      return toHostView(data, host)
    })
  }

  async delete(id: Id): Promise<void> {
    const vault = await this.vaults.get()
    await vault.update((data) => {
      const host = this.find(data, id)
      const now = this.now().toISOString()
      retireAuth(data, host.auth, now)
      host.deletedAt = now
      host.updatedAt = now
    })
  }

  /** Main only: everything a session needs, including the secret values. */
  async connectTarget(id: Id): Promise<ConnectTarget> {
    const data = (await this.vaults.get()).read()
    const host = this.find(data, id)
    const signIn = effectiveSignIn(data, host)
    if (signIn.identity !== undefined && signIn.identity.record === undefined) {
      throw new AppError('IDENTITY_NOT_FOUND')
    }
    if (signIn.username === undefined) throw new AppError('USERNAME_REQUIRED')
    return {
      hostId: host.id,
      title: host.name,
      address: host.address,
      port: toHostView(data, host).port,
      username: signIn.username,
      credential: credentialFor(data, signIn.auth),
      ...(host.agentForward === true ? { agentForward: true } : {}),
    }
  }

  private find(data: VaultData, id: Id): HostRecord {
    const host = data.hosts.find((item) => item.id === id && live(item))
    if (host === undefined) throw new AppError('HOST_NOT_FOUND')
    return host
  }
}
