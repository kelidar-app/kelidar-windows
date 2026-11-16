import type { ParsedKey } from 'ssh2'
import type { GeneratedKeyType, KeyView } from '@shared/keychain'
import type { Id, SshKeyRecord } from '@shared/records'
import type { KeyFileImports } from '../hosts/key-files'
import { AppError } from '../ipc/app-error'
import { generateKey } from '../ssh/keys'
import type { VaultService } from '../vault/service'
import type { VaultData } from '../vault/vault'
import { addKey, checkKeyFile, live, retireSecret } from './auth-store'

/** Hosts and identities whose sign-in points at the key. */
export function keyUsage(data: VaultData, keyId: Id): number {
  const uses = (auth: { type: string; keyId?: string } | undefined): boolean =>
    auth?.type === 'key' && auth.keyId === keyId
  return (
    data.hosts.filter((host) => live(host) && uses(host.auth)).length +
    data.identities.filter((identity) => live(identity) && uses(identity.auth)).length
  )
}

export function toKeyView(data: VaultData, key: SshKeyRecord): KeyView {
  return {
    id: key.id,
    name: key.name,
    type: key.type,
    fingerprint: key.fingerprint,
    publicKey: key.publicKey,
    hasPassphrase: key.passphraseSecretId !== undefined,
    usedBy: keyUsage(data, key.id),
    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
  }
}

/**
 * The Keychain's keys. Private keys and passphrases stay in the vault; the
 * renderer gets names, types, fingerprints and public keys only.
 */
export class KeyService {
  constructor(
    private readonly vaults: VaultService,
    private readonly keyFiles: KeyFileImports,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<KeyView[]> {
    const data = (await this.vaults.get()).read()
    return data.keys
      .filter(live)
      .map((key) => toKeyView(data, key))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }

  async generate(request: {
    name: string
    type: GeneratedKeyType
    passphrase?: string | undefined
  }): Promise<KeyView> {
    const generated = await generateKey(request.type, request.passphrase)
    const vault = await this.vaults.get()
    return vault.update((data) => {
      const id = addKey(
        data,
        {
          name: request.name,
          privateKey: generated.privateKey,
          parsed: generated.parsed,
          passphrase: request.passphrase,
          encrypted: request.passphrase !== undefined && request.passphrase !== '',
        },
        this.now().toISOString(),
      )
      return toKeyView(data, this.find(data, id))
    })
  }

  /** Keeps a key made elsewhere in main (Upgrade to key login), without a passphrase. */
  async adopt(key: { name: string; privateKey: string; parsed: ParsedKey }): Promise<KeyView> {
    const vault = await this.vaults.get()
    return vault.update((data) => {
      const id = addKey(data, { ...key, encrypted: false }, this.now().toISOString())
      return toKeyView(data, this.find(data, id))
    })
  }

  async import(request: {
    keyFileToken: string
    name?: string | undefined
    passphrase?: string | undefined
  }): Promise<KeyView> {
    const checked = checkKeyFile(this.keyFiles.peek(request.keyFileToken), request.passphrase)
    const vault = await this.vaults.get()
    const view = await vault.update((data) => {
      const id = addKey(
        data,
        { ...checked, name: request.name ?? checked.name },
        this.now().toISOString(),
      )
      return toKeyView(data, this.find(data, id))
    })
    this.keyFiles.discard(request.keyFileToken)
    return view
  }

  async rename(id: Id, name: string): Promise<KeyView> {
    const vault = await this.vaults.get()
    return vault.update((data) => {
      const key = this.find(data, id)
      key.name = name
      key.updatedAt = this.now().toISOString()
      return toKeyView(data, key)
    })
  }

  /** Refused while anything signs in with the key. */
  async delete(id: Id): Promise<void> {
    const vault = await this.vaults.get()
    await vault.update((data) => {
      const key = this.find(data, id)
      if (keyUsage(data, id) > 0) throw new AppError('KEY_IN_USE')
      const now = this.now().toISOString()
      retireSecret(data, key.privateKeySecretId, now)
      if (key.passphraseSecretId !== undefined) retireSecret(data, key.passphraseSecretId, now)
      key.deletedAt = now
      key.updatedAt = now
    })
  }

  private find(data: VaultData, id: Id): SshKeyRecord {
    const key = data.keys.find((item) => item.id === id && live(item))
    if (key === undefined) throw new AppError('KEY_NOT_FOUND')
    return key
  }
}
