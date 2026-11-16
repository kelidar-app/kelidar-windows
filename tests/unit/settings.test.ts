import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrateSettings, type SettingsMigration } from '../../src/main/settings/migrations'
import { SETTINGS_FILE_NAME, SettingsStore } from '../../src/main/settings/store'
import {
  DEFAULT_UI_SETTINGS,
  pickDefaultLanguage,
  SETTINGS_VERSION,
} from '../../src/shared/settings'

/** The terminal settings every file gets (version 5). */
const TERMINAL = {
  terminalFontFamily: DEFAULT_UI_SETTINGS.terminalFontFamily,
  terminalFontSize: DEFAULT_UI_SETTINGS.terminalFontSize,
  terminalLineHeight: DEFAULT_UI_SETTINGS.terminalLineHeight,
  pasteGuard: true,
}

describe('migrateSettings', () => {
  const migrations: SettingsMigration[] = [
    { from: 1, migrate: (data) => ({ ...data, version: 2, theme: data['theme'] ?? 'system' }) },
    { from: 2, migrate: (data) => ({ ...data, version: 3, renamed: data['old'], old: undefined }) },
  ]

  it('applies each step in order up to the current version', () => {
    const result = migrateSettings({ version: 1, old: 'x' }, 3, migrations)
    expect(result).toEqual({
      status: 'ok',
      migrated: true,
      data: { version: 3, theme: 'system', renamed: 'x', old: undefined },
    })
  })

  it('leaves current data alone', () => {
    expect(migrateSettings({ version: 3, a: 1 }, 3, migrations)).toEqual({
      status: 'ok',
      migrated: false,
      data: { version: 3, a: 1 },
    })
  })

  it('reports files from a newer version', () => {
    expect(migrateSettings({ version: 9 }, 3, migrations)).toEqual({ status: 'future', version: 9 })
  })

  it('rejects data without a usable version or a missing step', () => {
    for (const raw of [null, [], 'x', {}, { version: 0 }, { version: 1.5 }, { version: '1' }]) {
      expect(migrateSettings(raw, 3, migrations).status).toBe('invalid')
    }
    expect(migrateSettings({ version: 1 }, 3, [migrations[0] as SettingsMigration]).status).toBe(
      'invalid',
    )
    const badStep: SettingsMigration = { from: 1, migrate: (data) => ({ ...data }) }
    expect(migrateSettings({ version: 1 }, 2, [badStep]).status).toBe('invalid')
  })
})

describe('pickDefaultLanguage', () => {
  it('chooses Persian only when Windows prefers it', () => {
    expect(pickDefaultLanguage(['fa-IR', 'en-US'])).toBe('fa')
    expect(pickDefaultLanguage(['fa'])).toBe('fa')
    expect(pickDefaultLanguage(['en-US', 'fa-IR'])).toBe('en')
    expect(pickDefaultLanguage(['fr-FR'])).toBe('en')
    expect(pickDefaultLanguage([])).toBe('en')
  })
})

describe('SettingsStore', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'kelidar-settings-'))
    file = path.join(dir, SETTINGS_FILE_NAME)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const readJson = async (): Promise<unknown> => JSON.parse(await readFile(file, 'utf8')) as unknown

  it('creates the file with defaults on first run', async () => {
    const store = await SettingsStore.open({ directory: dir, defaultLanguage: 'fa' })
    expect(store.getUi()).toEqual({
      language: 'fa',
      theme: 'system',
      terminalTheme: 'kelidar',
      hostsView: 'cards',
      agent: 'auto',
      ...TERMINAL,
    })
    expect(await readJson()).toEqual({
      version: SETTINGS_VERSION,
      language: 'fa',
      theme: 'system',
      terminalTheme: 'kelidar',
      hostsView: 'cards',
      agent: 'auto',
      ...TERMINAL,
    })
  })

  it('loads an existing file', async () => {
    await writeFile(
      file,
      JSON.stringify({
        version: 2,
        language: 'fa',
        theme: 'dark',
        terminalTheme: 'soft',
        hostsView: 'cards',
        agent: 'auto',
        ...TERMINAL,
      }),
    )
    const store = await SettingsStore.open({ directory: dir, defaultLanguage: 'en' })
    expect(store.getUi()).toEqual({
      language: 'fa',
      theme: 'dark',
      terminalTheme: 'soft',
      hostsView: 'cards',
      agent: 'auto',
      ...TERMINAL,
    })
  })

  it('migrates a version 1 file and saves it as version 5', async () => {
    await writeFile(file, JSON.stringify({ version: 1, language: 'fa', theme: 'dark' }))
    const store = await SettingsStore.open({ directory: dir, defaultLanguage: 'en' })
    expect(store.getUi()).toEqual({
      language: 'fa',
      theme: 'dark',
      terminalTheme: 'kelidar',
      hostsView: 'cards',
      agent: 'auto',
      ...TERMINAL,
    })
    expect(await readJson()).toEqual({
      version: 5,
      language: 'fa',
      theme: 'dark',
      terminalTheme: 'kelidar',
      hostsView: 'cards',
      agent: 'auto',
      ...TERMINAL,
    })
  })

  it('saves updates atomically and keeps other fields', async () => {
    const store = await SettingsStore.open({ directory: dir, defaultLanguage: 'en' })
    await store.setWindowState({ width: 1000, height: 700, x: 10, y: 20, maximized: false })
    await expect(store.updateUi({ theme: 'light' })).resolves.toEqual({
      language: 'en',
      theme: 'light',
      terminalTheme: 'kelidar',
      hostsView: 'cards',
      agent: 'auto',
      ...TERMINAL,
    })
    await store.updateUi({
      language: 'fa',
      terminalTheme: 'contrast',
      hostsView: 'cards',
      agent: 'auto',
      ...TERMINAL,
    })
    expect(await readJson()).toEqual({
      version: 5,
      language: 'fa',
      theme: 'light',
      terminalTheme: 'contrast',
      hostsView: 'cards',
      agent: 'auto',
      ...TERMINAL,
      window: { width: 1000, height: 700, x: 10, y: 20, maximized: false },
    })
    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('keeps writes in order when called quickly', async () => {
    const store = await SettingsStore.open({ directory: dir, defaultLanguage: 'en' })
    await Promise.all([
      store.updateUi({ theme: 'dark' }),
      store.updateUi({ theme: 'light' }),
      store.updateUi({ language: 'fa' }),
    ])
    await store.flush()
    expect(await readJson()).toEqual({
      version: 5,
      language: 'fa',
      theme: 'light',
      terminalTheme: 'kelidar',
      hostsView: 'cards',
      agent: 'auto',
      ...TERMINAL,
    })
  })

  it('moves a broken file aside and starts from defaults', async () => {
    const onWarning = vi.fn()
    await writeFile(file, '{ this is not json')
    const store = await SettingsStore.open({ directory: dir, defaultLanguage: 'en', onWarning })
    expect(store.getUi()).toEqual({
      language: 'en',
      theme: 'system',
      terminalTheme: 'kelidar',
      hostsView: 'cards',
      agent: 'auto',
      ...TERMINAL,
    })
    const names = await readdir(dir)
    expect(names.some((name) => name.startsWith(`${SETTINGS_FILE_NAME}.broken-`))).toBe(true)
    expect(onWarning).toHaveBeenCalledOnce()
  })

  it('treats a file with invalid values as broken', async () => {
    await writeFile(file, JSON.stringify({ version: 1, language: 'de', theme: 'dark' }))
    const store = await SettingsStore.open({ directory: dir, defaultLanguage: 'en' })
    expect(store.getUi()).toEqual({
      language: 'en',
      theme: 'system',
      terminalTheme: 'kelidar',
      hostsView: 'cards',
      agent: 'auto',
      ...TERMINAL,
    })
  })

  it('never overwrites a file written by a newer version', async () => {
    const future = JSON.stringify({ version: 99, language: 'fa', somethingNew: true })
    await writeFile(file, future)
    const store = await SettingsStore.open({ directory: dir, defaultLanguage: 'en' })
    expect(store.readOnly).toBe(true)
    await store.updateUi({ theme: 'dark' })
    expect(store.getUi().theme).toBe('dark')
    expect(await readFile(file, 'utf8')).toBe(future)
  })

  it('reports SETTINGS_WRITE_FAILED and keeps the old value when saving fails', async () => {
    const store = await SettingsStore.open({ directory: dir, defaultLanguage: 'en' })
    // Make the target a directory so the rename fails.
    await rm(file)
    await mkdir(file)
    await expect(store.updateUi({ theme: 'dark' })).rejects.toMatchObject({
      code: 'SETTINGS_WRITE_FAILED',
    })
    expect(store.getUi().theme).toBe('system')
  })
})
