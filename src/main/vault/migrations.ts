/**
 * The decrypted vault data has its own version, separate from the file
 * envelope. Each step turns version `from` into `from + 1`; the file is
 * rewritten in the new shape on the next save (after the usual backup of the
 * old file).
 */
export const CURRENT_DATA_VERSION = 4

type Data = Record<string, unknown>

interface DataMigration {
  from: number
  migrate: (data: Data) => Data
}

/**
 * Version 2 (Phase 2) added groups, version 3 identities, version 4 host
 * notes, links and system. Version 4 only adds optional fields, but the bump
 * stops an older app from opening the vault and dropping them on save.
 */
const MIGRATIONS: readonly DataMigration[] = [
  { from: 1, migrate: (v1) => ({ ...v1, version: 2, groups: [] }) },
  { from: 2, migrate: (v2) => ({ ...v2, version: 3, identities: [] }) },
  { from: 3, migrate: (v3) => ({ ...v3, version: 4 }) },
]

export type DataMigrationResult =
  { status: 'ok'; data: Data } | { status: 'future' } | { status: 'invalid' }

function isRecord(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function migrateVaultData(
  raw: unknown,
  current: number = CURRENT_DATA_VERSION,
  migrations: readonly DataMigration[] = MIGRATIONS,
): DataMigrationResult {
  if (!isRecord(raw)) return { status: 'invalid' }
  const version = raw['version']
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { status: 'invalid' }
  }
  if (version > current) return { status: 'future' }
  let data = raw
  for (let v = version; v < current; v++) {
    const step = migrations.find((migration) => migration.from === v)
    if (step === undefined) return { status: 'invalid' }
    data = step.migrate(data)
  }
  return { status: 'ok', data }
}
