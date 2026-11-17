import { DEFAULT_UI_SETTINGS, SETTINGS_VERSION } from '@shared/settings'

export type SettingsData = Record<string, unknown>

/** Turns version `from` into version `from + 1`. */
export interface SettingsMigration {
  from: number
  migrate: (data: SettingsData) => SettingsData
}

/** One step per version. Version 2 added the terminal theme, version 3 the hosts view, version 4 the agent, version 5 terminal fonts and the paste guard, version 6 the lock and clipboard settings, version 7 system detection and the first-run import offer. */
export const SETTINGS_MIGRATIONS: readonly SettingsMigration[] = [
  { from: 1, migrate: (v1) => ({ ...v1, version: 2, terminalTheme: 'kelidar' }) },
  { from: 2, migrate: (v2) => ({ ...v2, version: 3, hostsView: 'cards' }) },
  { from: 3, migrate: (v3) => ({ ...v3, version: 4, agent: 'auto' }) },
  {
    from: 4,
    migrate: (v4) => ({
      ...v4,
      version: 5,
      terminalFontFamily: DEFAULT_UI_SETTINGS.terminalFontFamily,
      terminalFontSize: DEFAULT_UI_SETTINGS.terminalFontSize,
      terminalLineHeight: DEFAULT_UI_SETTINGS.terminalLineHeight,
      pasteGuard: true,
    }),
  },
  {
    from: 5,
    migrate: (v5) => ({
      ...v5,
      version: 6,
      autoLockMinutes: DEFAULT_UI_SETTINGS.autoLockMinutes,
      lockOnWindowsLock: DEFAULT_UI_SETTINGS.lockOnWindowsLock,
      clipboardClearSeconds: DEFAULT_UI_SETTINGS.clipboardClearSeconds,
    }),
  },
  {
    from: 6,
    migrate: (v6) => ({ ...v6, version: 7, detectOs: true, importOffered: false }),
  },
]

export type MigrationResult =
  | { status: 'ok'; data: SettingsData; migrated: boolean }
  | { status: 'future'; version: number }
  | { status: 'invalid'; reason: string }

function isRecord(value: unknown): value is SettingsData {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Brings raw settings.json data up to the current version, one step at a time.
 * A file written by a newer app version is reported as 'future' and left alone.
 */
export function migrateSettings(
  raw: unknown,
  currentVersion: number = SETTINGS_VERSION,
  migrations: readonly SettingsMigration[] = SETTINGS_MIGRATIONS,
): MigrationResult {
  if (!isRecord(raw)) return { status: 'invalid', reason: 'not an object' }
  const version = raw.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { status: 'invalid', reason: 'missing or bad version' }
  }
  if (version > currentVersion) return { status: 'future', version }

  let data: SettingsData = raw
  for (let v = version; v < currentVersion; v++) {
    const step = migrations.find((migration) => migration.from === v)
    if (step === undefined) return { status: 'invalid', reason: `no migration from version ${v}` }
    data = step.migrate(data)
    if (data.version !== v + 1) {
      return { status: 'invalid', reason: `migration from ${v} did not set version ${v + 1}` }
    }
  }
  return { status: 'ok', data, migrated: version !== currentVersion }
}
