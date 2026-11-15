import { randomUUID } from 'node:crypto'
import type { KnownHostRecord } from '@shared/records'
import type { HostKeyInfo } from '@shared/session'
import type { VaultService } from '../vault/service'
import { sha256Fingerprint } from './keys'

/** The algorithm name at the start of an SSH wire-format public key. */
export function keyTypeOf(blob: Buffer): string {
  if (blob.length < 4) return 'unknown'
  const length = blob.readUInt32BE(0)
  if (length === 0 || length > 64 || blob.length < 4 + length) return 'unknown'
  const name = blob.subarray(4, 4 + length).toString('ascii')
  return /^[\w@.-]+$/.test(name) ? name : 'unknown'
}

export function describeHostKey(host: string, port: number, blob: Buffer): HostKeyInfo {
  return { host, port, keyType: keyTypeOf(blob), fingerprint: sha256Fingerprint(blob) }
}

export type HostKeyCheck =
  { status: 'trusted' } | { status: 'unknown' } | { status: 'changed'; known: KnownHostRecord }

/**
 * Trust on first use, stored in the vault. One trusted key per address and
 * port: a different key, of any type, counts as changed and blocks the
 * connection until the user removes the old key on purpose.
 */
export class KnownHosts {
  constructor(
    private readonly vaults: VaultService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async check(info: HostKeyInfo): Promise<HostKeyCheck> {
    const data = (await this.vaults.get()).read()
    const known = data.knownHosts.find(
      (item) =>
        item.deletedAt === undefined &&
        item.host === info.host.toLowerCase() &&
        item.port === info.port,
    )
    if (known === undefined) return { status: 'unknown' }
    return known.fingerprint === info.fingerprint
      ? { status: 'trusted' }
      : { status: 'changed', known }
  }

  async trust(info: HostKeyInfo): Promise<void> {
    const vault = await this.vaults.get()
    await vault.update((data) => {
      const now = this.now().toISOString()
      const host = info.host.toLowerCase()
      for (const item of data.knownHosts) {
        if (item.deletedAt === undefined && item.host === host && item.port === info.port) {
          item.deletedAt = now
          item.updatedAt = now
        }
      }
      data.knownHosts.push({
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        host,
        port: info.port,
        keyType: info.keyType,
        fingerprint: info.fingerprint,
      })
    })
  }

  async forget(host: string, port: number): Promise<void> {
    const vault = await this.vaults.get()
    await vault.update((data) => {
      const now = this.now().toISOString()
      for (const item of data.knownHosts) {
        if (
          item.deletedAt === undefined &&
          item.host === host.toLowerCase() &&
          item.port === port
        ) {
          item.deletedAt = now
          item.updatedAt = now
        }
      }
    })
  }
}
