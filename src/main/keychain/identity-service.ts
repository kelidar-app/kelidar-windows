import { randomUUID } from 'node:crypto'
import type { IdentityView, ParsedIdentitySaveRequest } from '@shared/keychain'
import type { Id, IdentityRecord } from '@shared/records'
import type { KeyFileImports } from '../hosts/key-files'
import { AppError } from '../ipc/app-error'
import type { VaultService } from '../vault/service'
import type { VaultData } from '../vault/vault'
import { applyAuth, checkAuth, live, retireAuth, secretValue, toSignInView } from './auth-store'

/** Hosts and groups that name the identity (hosts that only inherit it are not counted). */
export function identityUsage(data: VaultData, identityId: Id): number {
  return (
    data.hosts.filter((host) => live(host) && host.identityId === identityId).length +
    data.groups.filter((group) => live(group) && group.defaults?.identityId === identityId).length
  )
}

export function toIdentityView(data: VaultData, identity: IdentityRecord): IdentityView {
  return {
    id: identity.id,
    name: identity.name,
    username: identity.username,
    signIn: toSignInView(data, identity.auth),
    usedBy: identityUsage(data, identity.id),
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
  }
}

/** A user name plus sign-in that many hosts share; editing it changes them all. */
export class IdentityService {
  constructor(
    private readonly vaults: VaultService,
    private readonly keyFiles: KeyFileImports,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Main only, for "Copy password": the identity's saved password. */
  async savedPassword(id: Id): Promise<string> {
    const data = (await this.vaults.get()).read()
    const identity = data.identities.find((item) => item.id === id && live(item))
    if (identity === undefined) throw new AppError('IDENTITY_NOT_FOUND')
    const auth = identity.auth
    const password = auth.type === 'password' ? secretValue(data, auth.secretId) : undefined
    if (password === undefined) throw new AppError('PASSWORD_NOT_SAVED')
    return password
  }

  async list(): Promise<IdentityView[]> {
    const data = (await this.vaults.get()).read()
    return data.identities
      .filter(live)
      .map((identity) => toIdentityView(data, identity))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }

  async save(request: ParsedIdentitySaveRequest): Promise<IdentityView> {
    const vault = await this.vaults.get()
    const before = vault.read()
    const existing =
      request.id === undefined
        ? undefined
        : before.identities.find((item) => item.id === request.id && live(item))
    if (request.id !== undefined && existing === undefined) {
      throw new AppError('IDENTITY_NOT_FOUND')
    }
    const checked = checkAuth(before, request.auth, existing?.auth, this.keyFiles)

    const view = await vault.update((data) => {
      const now = this.now().toISOString()
      const current = data.identities.find((item) => item.id === request.id && live(item))
      const auth = applyAuth(data, checked, current?.auth, now)
      const identity: IdentityRecord = current ?? {
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        name: request.name,
        username: request.username,
        auth,
      }
      Object.assign(identity, {
        name: request.name,
        username: request.username,
        auth,
        updatedAt: now,
      })
      if (current === undefined) data.identities.push(identity)
      return toIdentityView(data, identity)
    })
    if (checked.type === 'newKey' && checked.token !== undefined) {
      this.keyFiles.discard(checked.token)
    }
    return view
  }

  /** Refused while a host or group names the identity. Its password goes with it. */
  async delete(id: Id): Promise<void> {
    const vault = await this.vaults.get()
    await vault.update((data) => {
      const identity = data.identities.find((item) => item.id === id && live(item))
      if (identity === undefined) throw new AppError('IDENTITY_NOT_FOUND')
      if (identityUsage(data, id) > 0) throw new AppError('IDENTITY_IN_USE')
      const now = this.now().toISOString()
      retireAuth(data, identity.auth, now)
      identity.deletedAt = now
      identity.updatedAt = now
    })
  }
}
