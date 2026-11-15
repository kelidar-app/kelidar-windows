import { readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import {
  SETTINGS_VERSION,
  settingsFileSchema,
  type Language,
  type SettingsFile,
  type UiSettings,
  type UiSettingsPatch,
  type WindowState,
} from '@shared/settings'
import { AppError } from '../ipc/app-error'
import { writeFileAtomic } from '../fs/atomic-write'
import { migrateSettings, SETTINGS_MIGRATIONS, type SettingsMigration } from './migrations'

export const SETTINGS_FILE_NAME = 'settings.json'

export interface SettingsStoreOptions {
  directory: string
  defaultLanguage: Language
  migrations?: readonly SettingsMigration[]
  /** Reports problems with the file. Never receives secrets: settings.json holds none. */
  onWarning?: (message: string) => void
}

function defaults(language: Language): SettingsFile {
  return { version: SETTINGS_VERSION, language, theme: 'system', terminalTheme: 'kelidar' }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/**
 * Non-secret settings in <userData>/settings.json.
 * - A missing file is created with defaults.
 * - A broken file is kept as settings.json.broken-<time> and replaced with defaults.
 * - A file from a newer app version is never overwritten (read-only defaults).
 * Writes are atomic and run one after another.
 */
export class SettingsStore {
  private current: SettingsFile
  private queue: Promise<void> = Promise.resolve()

  private constructor(
    readonly filePath: string,
    initial: SettingsFile,
    readonly readOnly: boolean,
  ) {
    this.current = initial
  }

  static async open(options: SettingsStoreOptions): Promise<SettingsStore> {
    const filePath = path.join(options.directory, SETTINGS_FILE_NAME)
    const warn = options.onWarning ?? (() => undefined)
    const fallback = defaults(options.defaultLanguage)

    let text: string
    try {
      text = await readFile(filePath, 'utf8')
    } catch (error) {
      if (!isMissingFile(error)) throw error
      const store = new SettingsStore(filePath, fallback, false)
      await store.persist()
      return store
    }

    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      raw = undefined
    }

    const migration = migrateSettings(
      raw,
      SETTINGS_VERSION,
      options.migrations ?? SETTINGS_MIGRATIONS,
    )
    if (migration.status === 'future') {
      warn(
        `settings.json is from a newer version (${migration.version}); using defaults without saving`,
      )
      return new SettingsStore(filePath, fallback, true)
    }
    if (migration.status === 'ok') {
      const parsed = settingsFileSchema.safeParse(migration.data)
      if (parsed.success) {
        const store = new SettingsStore(filePath, parsed.data, false)
        if (migration.migrated) await store.persist()
        return store
      }
    }

    const brokenPath = `${filePath}.broken-${Date.now()}`
    warn(`settings.json could not be read; kept a copy at ${path.basename(brokenPath)}`)
    await rename(filePath, brokenPath)
    const store = new SettingsStore(filePath, fallback, false)
    await store.persist()
    return store
  }

  get(): SettingsFile {
    return structuredClone(this.current)
  }

  getUi(): UiSettings {
    return {
      language: this.current.language,
      theme: this.current.theme,
      terminalTheme: this.current.terminalTheme,
    }
  }

  async updateUi(patch: UiSettingsPatch): Promise<UiSettings> {
    await this.replace({ ...this.current, ...patch })
    return this.getUi()
  }

  async setWindowState(windowState: WindowState): Promise<void> {
    await this.replace({ ...this.current, window: windowState })
  }

  /** Resolves when every pending write has finished. */
  flush(): Promise<void> {
    return this.queue
  }

  private async replace(next: SettingsFile): Promise<void> {
    const previous = this.current
    this.current = settingsFileSchema.parse(next)
    try {
      await this.persist()
    } catch (error) {
      this.current = previous
      throw new AppError('SETTINGS_WRITE_FAILED', { cause: error })
    }
  }

  private persist(): Promise<void> {
    if (this.readOnly) return Promise.resolve()
    const contents = `${JSON.stringify(this.current, null, 2)}\n`
    const write = this.queue.then(() => writeFileAtomic(this.filePath, contents))
    this.queue = write.catch(() => undefined)
    return write
  }
}
