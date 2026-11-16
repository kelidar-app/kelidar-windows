import type { ImportSummary } from '@shared/security'
import { MAX_GROUP_DEPTH, type AuthRef, type BaseRecord } from '@shared/records'
import type { VaultData } from './vault'

const COLLECTIONS = ['hosts', 'groups', 'identities', 'secrets', 'keys', 'knownHosts'] as const
/** What the summary counts: the records the user sees by name. */
const COUNTED: ReadonlySet<string> = new Set(['hosts', 'groups', 'identities', 'keys'])

function mergeRecords<T extends BaseRecord>(
  current: T[],
  incoming: T[],
  count: (change: 'added' | 'updated' | 'unchanged', record: T) => void,
): T[] {
  const byId = new Map(current.map((record) => [record.id, record]))
  for (const record of incoming) {
    const existing = byId.get(record.id)
    if (existing === undefined) {
      byId.set(record.id, record)
      count('added', record)
    } else if (Date.parse(record.updatedAt) > Date.parse(existing.updatedAt)) {
      byId.set(record.id, record)
      count('updated', record)
    } else {
      count('unchanged', record)
    }
  }
  return [...byId.values()]
}

/**
 * Merges an import into the vault by record id: a record the vault lacks is
 * added, and a record both have keeps the copy changed last (deletions
 * included, as they are records with deletedAt). Nothing is lost: an older
 * import never overwrites newer changes.
 */
export function mergeVaultData(
  current: VaultData,
  incoming: VaultData,
): { data: VaultData; summary: ImportSummary } {
  const summary: ImportSummary = { added: 0, updated: 0, unchanged: 0 }
  const data = structuredClone(current)
  for (const name of COLLECTIONS) {
    const count = (change: keyof ImportSummary, record: BaseRecord): void => {
      if (COUNTED.has(name) && record.deletedAt === undefined) summary[change] += 1
    }
    // Each collection merges with its own record type.
    switch (name) {
      case 'hosts':
        data.hosts = mergeRecords(data.hosts, incoming.hosts, count)
        break
      case 'groups':
        data.groups = mergeRecords(data.groups, incoming.groups, count)
        break
      case 'identities':
        data.identities = mergeRecords(data.identities, incoming.identities, count)
        break
      case 'secrets':
        data.secrets = mergeRecords(data.secrets, incoming.secrets, count)
        break
      case 'keys':
        data.keys = mergeRecords(data.keys, incoming.keys, count)
        break
      case 'knownHosts':
        data.knownHosts = mergeRecords(data.knownHosts, incoming.knownHosts, count)
        break
    }
  }
  keepNewestServerKey(data)
  return { data, summary }
}

/** One trusted key per server: when both copies trust one, the newer stays. */
function keepNewestServerKey(data: VaultData): void {
  const newest = new Map<string, VaultData['knownHosts'][number]>()
  for (const item of data.knownHosts) {
    if (item.deletedAt !== undefined) continue
    const where = `${item.host}:${String(item.port)}`
    const kept = newest.get(where)
    if (kept === undefined || Date.parse(item.updatedAt) > Date.parse(kept.updatedAt)) {
      newest.set(where, item)
    }
  }
  for (const item of data.knownHosts) {
    if (item.deletedAt !== undefined) continue
    if (newest.get(`${item.host}:${String(item.port)}`) !== item) {
      item.deletedAt = item.updatedAt
    }
  }
}

/**
 * Checks what the schema cannot: the references of live records point at
 * records that exist, and groups do not loop. A file that fails is not
 * imported.
 */
export function isConsistent(data: VaultData): boolean {
  const ids = (records: BaseRecord[]): Set<string> => new Set(records.map((record) => record.id))
  const groups = new Map(data.groups.map((group) => [group.id, group]))
  const hosts = ids(data.hosts)
  const identities = ids(data.identities)
  const secrets = ids(data.secrets)
  const keys = ids(data.keys)
  const has = (set: Set<string>, id: string | undefined): boolean => id === undefined || set.has(id)
  const authOk = (auth: AuthRef | undefined): boolean =>
    auth === undefined ||
    (auth.type === 'password' && secrets.has(auth.secretId)) ||
    (auth.type === 'key' && keys.has(auth.keyId)) ||
    auth.type === 'agent' ||
    auth.type === 'ask'
  const live = <T extends BaseRecord>(records: T[]): T[] =>
    records.filter((record) => record.deletedAt === undefined)

  for (const group of live(data.groups)) {
    let parent = group.parentId
    for (let depth = 0; parent !== undefined; depth++) {
      if (depth >= MAX_GROUP_DEPTH || parent === group.id) return false
      const next = groups.get(parent)
      if (next === undefined) return false
      parent = next.parentId
    }
    if (!has(identities, group.defaults?.identityId)) return false
    if (!has(hosts, group.defaults?.jumpHostId)) return false
  }
  for (const identity of live(data.identities)) {
    if (!authOk(identity.auth)) return false
  }
  for (const key of live(data.keys)) {
    if (!secrets.has(key.privateKeySecretId) || !has(secrets, key.passphraseSecretId)) return false
  }
  for (const host of live(data.hosts)) {
    if (!has(new Set(groups.keys()), host.groupId)) return false
    if (!has(identities, host.identityId) || !has(hosts, host.jumpHostId)) return false
    if (!authOk(host.auth) || !has(secrets, host.proxy?.secretId)) return false
  }
  return true
}
