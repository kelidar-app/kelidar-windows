import { randomUUID } from 'node:crypto'
import { groupDefaultsFor, resolveHostSettings } from '@shared/groups'
import type { HostView, ParsedHostSaveRequest } from '@shared/hosts'
import type { AuthRequest } from '@shared/keychain'
import {
  MAX_JUMP_HOSTS,
  type AuthRef,
  type HostRecord,
  type Id,
  type IdentityRecord,
} from '@shared/records'
import { AppError } from '../ipc/app-error'
import {
  addSecret,
  applyAuth,
  checkAuth,
  credentialFor,
  live,
  retireAuth,
  retireSecret,
  secretValue,
  toSignInView,
  type CheckedAuth,
} from '../keychain/auth-store'
import type { ProxyConfig } from '../ssh/proxy'
import type { UsedCredential } from '../ssh/auth'
import type { ConnectTarget, HopTarget } from '../ssh/session-manager'
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

/** The host this one connects through: its own choice, else its group's. */
export function effectiveJump(
  data: VaultData,
  host: HostRecord,
): { hostId: Id; from: 'host' | 'group' } | undefined {
  if (host.directConnect === true) return undefined
  if (host.jumpHostId !== undefined) return { hostId: host.jumpHostId, from: 'host' }
  const fromGroup = groupDefaultsFor(host.groupId, data.groups.filter(live)).jumpHostId.value
  return fromGroup === undefined || fromGroup === host.id
    ? undefined
    : { hostId: fromGroup, from: 'group' }
}

/**
 * The jump hosts in the order they are reached from this computer. Fails on a
 * missing host, a loop, or more than MAX_JUMP_HOSTS hops.
 */
export function jumpChain(data: VaultData, host: HostRecord): HostRecord[] {
  const chain: HostRecord[] = []
  const seen = new Set<Id>([host.id])
  let current = host
  for (;;) {
    const jump = effectiveJump(data, current)
    if (jump === undefined) return chain
    if (seen.has(jump.hostId) || chain.length >= MAX_JUMP_HOSTS) {
      throw new AppError('JUMP_HOST_LOOP')
    }
    const next = data.hosts.find((item) => item.id === jump.hostId && live(item))
    if (next === undefined) throw new AppError('JUMP_HOST_NOT_FOUND')
    chain.unshift(next)
    seen.add(next.id)
    current = next
  }
}

export function toHostView(data: VaultData, host: HostRecord): HostView {
  const groups = data.groups.filter(live)
  const groupId = groups.some((group) => group.id === host.groupId) ? host.groupId : undefined
  const effective = resolveHostSettings({ ...host, groupId }, groups)
  const signIn = effectiveSignIn(data, { ...host, groupId })
  const identity = signIn.identity?.record
  const jump = effectiveJump(data, host)
  const jumpHost =
    jump === undefined
      ? undefined
      : data.hosts.find((item) => item.id === jump.hostId && live(item))
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
    ...(jump === undefined || jumpHost === undefined
      ? {}
      : { jump: { hostId: jumpHost.id, name: jumpHost.name, from: jump.from } }),
    ownJump:
      host.directConnect === true
        ? { type: 'none' }
        : host.jumpHostId === undefined
          ? { type: 'inherit' }
          : { type: 'host', hostId: host.jumpHostId },
    ...(host.proxy === undefined
      ? {}
      : {
          proxy: {
            type: host.proxy.type,
            host: host.proxy.host,
            port: host.proxy.port,
            ...(host.proxy.username === undefined ? {} : { username: host.proxy.username }),
            hasPassword: host.proxy.secretId !== undefined,
          },
        }),
    ...(host.startupCommand === undefined ? {} : { startupCommand: host.startupCommand }),
    stickySession: host.stickySession === true,
    createdAt: host.createdAt,
    updatedAt: host.updatedAt,
    ...(host.lastConnectedAt === undefined ? {} : { lastConnectedAt: host.lastConnectedAt }),
  }
}

function hopTarget(data: VaultData, host: HostRecord): HopTarget {
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
  }
}

function proxyConfig(data: VaultData, host: HostRecord): ProxyConfig | undefined {
  const proxy = host.proxy
  if (proxy === undefined) return undefined
  const password = secretValue(data, proxy.secretId)
  return {
    type: proxy.type,
    host: proxy.host,
    port: proxy.port,
    ...(proxy.username === undefined ? {} : { username: proxy.username }),
    ...(password === undefined ? {} : { password }),
  }
}

type OptionalHostField =
  | 'port'
  | 'groupId'
  | 'color'
  | 'environment'
  | 'identityId'
  | 'username'
  | 'jumpHostId'
  | 'startupCommand'

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
      if (request.stickySession === true) host.stickySession = true
      else delete host.stickySession
      setOptional(
        host,
        'startupCommand',
        request.startupCommand === '' ? undefined : request.startupCommand,
      )
      const jump = request.jump ?? { type: 'inherit' }
      setOptional(host, 'jumpHostId', jump.type === 'host' ? jump.hostId : undefined)
      if (jump.type === 'none') host.directConnect = true
      else delete host.directConnect
      if (jump.type === 'host') {
        if (jump.hostId === host.id) throw new AppError('JUMP_HOST_LOOP')
        if (!data.hosts.some((item) => item.id === jump.hostId && live(item))) {
          throw new AppError('JUMP_HOST_NOT_FOUND')
        }
      }
      this.applyProxy(data, host, request.proxy, now)

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
      // A jump host that leads back here (directly or through groups) is refused.
      jumpChain(data, host)
      return toHostView(data, host)
    })
    if (plan.kind === 'own' && plan.checked.type === 'newKey' && plan.checked.token !== undefined) {
      this.keyFiles.discard(plan.checked.token)
    }
    return saved
  }

  /** The proxy password is a secret owned by the host, like its own password. */
  private applyProxy(
    data: VaultData,
    host: HostRecord,
    request: ParsedHostSaveRequest['proxy'],
    now: string,
  ): void {
    const previous = host.proxy
    if (request === undefined) {
      if (previous?.secretId !== undefined) retireSecret(data, previous.secretId, now)
      delete host.proxy
      return
    }
    let secretId = previous?.secretId
    if (request.password === '' && secretId !== undefined) {
      retireSecret(data, secretId, now)
      secretId = undefined
    } else if (request.password !== undefined && request.password !== '') {
      const secret =
        secretId === undefined
          ? undefined
          : data.secrets.find((item) => item.id === secretId && live(item))
      if (secret === undefined) secretId = addSecret(data, request.password, now)
      else {
        secret.value = request.password
        secret.updatedAt = now
      }
    }
    host.proxy = {
      type: request.type,
      host: request.host,
      port: request.port,
      ...(request.username === undefined ? {} : { username: request.username }),
      ...(secretId === undefined ? {} : { secretId }),
    }
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

  /**
   * Moves a host into a group, or out of any group. Nothing else changes; the
   * host now inherits from the new group (port, identity, jump host…).
   */
  async move(id: Id, groupId: Id | undefined): Promise<HostView> {
    const vault = await this.vaults.get()
    return vault.update((data) => {
      const host = this.find(data, id)
      if (groupId !== undefined && !data.groups.some((g) => g.id === groupId && live(g))) {
        throw new AppError('GROUP_NOT_FOUND')
      }
      setOptional(host, 'groupId', groupId)
      host.updatedAt = this.now().toISOString()
      // The new group's jump host must not lead back to this host.
      jumpChain(data, host)
      return toHostView(data, host)
    })
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
      if (host.proxy?.secretId !== undefined) retireSecret(data, host.proxy.secretId, now)
      host.deletedAt = now
      host.updatedAt = now
    })
  }

  /**
   * Main only: everything a session needs, including the secret values: the
   * jump hosts on the way, and the proxy of the first connection.
   */
  async connectTarget(id: Id): Promise<ConnectTarget> {
    const data = (await this.vaults.get()).read()
    const host = this.find(data, id)
    const chain = jumpChain(data, host)
    const first = chain[0] ?? host
    const proxy = proxyConfig(data, first)
    return {
      ...hopTarget(data, host),
      ...(host.agentForward === true ? { agentForward: true } : {}),
      ...(chain.length === 0 ? {} : { via: chain.map((hop) => hopTarget(data, hop)) }),
      ...(proxy === undefined ? {} : { proxy }),
      ...(host.startupCommand === undefined ? {} : { startupCommand: host.startupCommand }),
      ...(host.stickySession === true ? { stickySession: true } : {}),
    }
  }

  private find(data: VaultData, id: Id): HostRecord {
    const host = data.hosts.find((item) => item.id === id && live(item))
    if (host === undefined) throw new AppError('HOST_NOT_FOUND')
    return host
  }
}
