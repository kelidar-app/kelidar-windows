import { randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/main/ipc/app-error'
import { AutoLock } from '../../src/main/security/auto-lock'
import { SecretClipboard } from '../../src/main/security/secret-clipboard'
import { DataTransfer } from '../../src/main/vault/data-transfer'
import { createExport, ExportFileError, readExport } from '../../src/main/vault/export-file'
import { isConsistent, mergeVaultData } from '../../src/main/vault/merge'
import {
  unwrapWithPassword,
  wrapWithPassword,
  WrongPasswordError,
} from '../../src/main/vault/password-wrap'
import { VaultService } from '../../src/main/vault/service'
import {
  emptyVaultData,
  listBackups,
  Vault,
  VAULT_BACKUP_DIR,
  VaultError,
  type VaultData,
} from '../../src/main/vault/vault'
import type { VaultStatus } from '../../src/shared/security'
import { uiSettingsPatchSchema } from '../../src/shared/settings'
import { fakeWrapper } from './helpers/fake-wrapper'

/** The lowest cost the file format accepts, so the tests stay fast. */
const COST = { N: 2 ** 14, r: 8, p: 1 }
const PASSWORD = 'correct horse battery'

const at = (minute: number): string => new Date(Date.UTC(2026, 10, 17, 10, minute)).toISOString()

function host(name: string, updatedAt = at(0), extra: Partial<VaultData['hosts'][number]> = {}) {
  return {
    id: randomUUID(),
    createdAt: at(0),
    updatedAt,
    name,
    address: `${name.toLowerCase()}.example.test`,
    tags: [],
    ...extra,
  }
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'kelidar-lock-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const openVault = (options: { password?: string } = {}) =>
  Vault.open({ directory: dir, wrapper: fakeWrapper(), scryptCost: COST, ...options })

async function vaultWithHosts(...names: string[]): Promise<Vault> {
  const vault = await openVault()
  for (const name of names) {
    await vault.update((data) => {
      data.hosts.push(host(name))
    })
  }
  return vault
}

async function backupTypes(): Promise<string[]> {
  const backupDir = path.join(dir, VAULT_BACKUP_DIR)
  const names = await listBackups(backupDir)
  return Promise.all(
    names.map(async (name) => {
      const text = await readFile(path.join(backupDir, name), 'utf8')
      return (JSON.parse(text) as { keyWrap: { type: string } }).keyWrap.type
    }),
  )
}

describe('password key wrap', () => {
  it('opens with the right password only', async () => {
    const key = Buffer.alloc(32, 7)
    const wrap = await wrapWithPassword(key, PASSWORD, COST)
    expect(wrap).toMatchObject({ type: 'password', kdf: 'scrypt', ...COST })
    expect(JSON.stringify(wrap)).not.toContain(key.toString('base64'))
    await expect(unwrapWithPassword(wrap, PASSWORD)).resolves.toEqual(key)
    await expect(unwrapWithPassword(wrap, 'wrong password')).rejects.toBeInstanceOf(
      WrongPasswordError,
    )
  })

  it('fails when the stored cost or salt was changed', async () => {
    const wrap = await wrapWithPassword(Buffer.alloc(32, 1), PASSWORD, COST)
    await expect(unwrapWithPassword({ ...wrap, N: 2 ** 15 }, PASSWORD)).rejects.toBeInstanceOf(
      WrongPasswordError,
    )
    const salt = Buffer.from(wrap.salt, 'base64')
    salt[0] = (salt[0] ?? 0) ^ 1
    await expect(
      unwrapWithPassword({ ...wrap, salt: salt.toString('base64') }, PASSWORD),
    ).rejects.toBeInstanceOf(WrongPasswordError)
  })

  it('uses N=2^17, r=8, p=1 by default', async () => {
    const { SCRYPT_COST } = await import('../../src/main/vault/password-wrap')
    expect(SCRYPT_COST).toEqual({ N: 2 ** 17, r: 8, p: 1 })
  })
})

describe('Vault master password', () => {
  it('needs the password to open once one is set, and keeps the data', async () => {
    const vault = await vaultWithHosts('Alpha', 'Beta')
    await vault.setMasterPassword(PASSWORD)
    expect(vault.hasMasterPassword).toBe(true)

    const file = JSON.parse(await readFile(vault.filePath, 'utf8')) as {
      keyWrap: { type: string }
    }
    expect(file.keyWrap.type).toBe('password')
    expect(await Vault.inspect(dir)).toBe('password')

    await expect(openVault()).rejects.toMatchObject({ code: 'VAULT_LOCKED' })
    await expect(openVault({ password: 'not it' })).rejects.toMatchObject({
      code: 'VAULT_PASSWORD_WRONG',
    })
    const reopened = await openVault({ password: PASSWORD })
    expect(reopened.read().hosts.map((h) => h.name)).toEqual(['Alpha', 'Beta'])
  })

  it('encrypts every backup again, so none opens without the password', async () => {
    const vault = await vaultWithHosts('One', 'Two', 'Three')
    expect(await backupTypes()).toEqual(['safeStorage', 'safeStorage'])
    await vault.setMasterPassword(PASSWORD)
    expect(await backupTypes()).toEqual(['password', 'password'])
    for (const name of await listBackups(path.join(dir, VAULT_BACKUP_DIR))) {
      expect(vault.opens(await readFile(path.join(dir, VAULT_BACKUP_DIR, name), 'utf8'))).toBe(true)
    }
  })

  it('deletes a leftover Windows-only backup it cannot encrypt again', async () => {
    const other = await mkdtemp(path.join(os.tmpdir(), 'kelidar-other-'))
    try {
      const stranger = await Vault.open({ directory: other, wrapper: fakeWrapper() })
      await stranger.update((data) => {
        data.hosts.push(host('Stranger'))
      })
      const vault = await vaultWithHosts('Mine', 'Mine too')
      const backupDir = path.join(dir, VAULT_BACKUP_DIR)
      await copyFile(stranger.filePath, path.join(backupDir, 'vault-0000-stray.json'))
      await vault.setMasterPassword(PASSWORD)
      const left = await readdir(backupDir)
      expect(left).not.toContain('vault-0000-stray.json')
      expect(await backupTypes()).toEqual(['password'])
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  it('checks, changes and removes the password', async () => {
    const vault = await vaultWithHosts('Alpha', 'Beta')
    await vault.setMasterPassword(PASSWORD)
    expect(await vault.checkPassword(PASSWORD)).toBe(true)
    expect(await vault.checkPassword('nope')).toBe(false)

    await vault.setMasterPassword('a brand new one')
    await expect(openVault({ password: PASSWORD })).rejects.toMatchObject({
      code: 'VAULT_PASSWORD_WRONG',
    })
    expect((await openVault({ password: 'a brand new one' })).read().hosts).toHaveLength(2)

    await vault.setMasterPassword(null)
    expect(vault.hasMasterPassword).toBe(false)
    expect(await backupTypes()).toEqual(['safeStorage'])
    expect((await openVault()).read().hosts).toHaveLength(2)
  })

  it('rejects a header changed to ask for a cheaper scrypt', async () => {
    const vault = await vaultWithHosts('Alpha')
    await vault.setMasterPassword(PASSWORD)
    const envelope = JSON.parse(await readFile(vault.filePath, 'utf8')) as {
      keyWrap: { N: number }
    }
    envelope.keyWrap.N = 2 ** 15
    await writeFile(vault.filePath, JSON.stringify(envelope))
    await expect(openVault({ password: PASSWORD })).rejects.toBeInstanceOf(VaultError)
  })
})

describe('VaultService', () => {
  const service = (sleep = vi.fn(() => Promise.resolve())) => {
    const vaults = new VaultService({
      directory: dir,
      wrapper: fakeWrapper(),
      scryptCost: COST,
      sleep,
    })
    return { vaults, sleep }
  }

  async function protectedVault(): Promise<void> {
    const vault = await vaultWithHosts('Alpha', 'Beta')
    await vault.setMasterPassword(PASSWORD)
  }

  it('opens unlocked without a master password, and does not lock', async () => {
    const { vaults } = service()
    await expect(vaults.status()).resolves.toEqual({ state: 'unlocked', masterPassword: false })
    await expect(vaults.lock()).resolves.toMatchObject({ state: 'unlocked' })
    await expect(vaults.get()).resolves.toBeInstanceOf(Vault)
  })

  it('starts locked with a master password and unlocks with it', async () => {
    await protectedVault()
    const { vaults, sleep } = service()
    const changes: VaultStatus[] = []
    vaults.onChange((status) => changes.push(status))
    await expect(vaults.status()).resolves.toEqual({ state: 'locked', masterPassword: true })
    await expect(vaults.get()).rejects.toMatchObject({ code: 'VAULT_LOCKED' })

    for (let i = 0; i < 4; i++) {
      await expect(vaults.unlock('wrong')).rejects.toMatchObject({ code: 'VAULT_PASSWORD_WRONG' })
    }
    // Three free tries, then each one waits longer.
    expect(sleep.mock.calls).toEqual([[1000]])

    await expect(vaults.unlock(PASSWORD)).resolves.toEqual({
      state: 'unlocked',
      masterPassword: true,
    })
    expect((await vaults.get()).read().hosts).toHaveLength(2)
    expect(changes.at(-1)).toEqual({ state: 'unlocked', masterPassword: true })

    await expect(vaults.lock()).resolves.toEqual({ state: 'locked', masterPassword: true })
    await expect(vaults.get()).rejects.toMatchObject({ code: 'VAULT_LOCKED' })
    expect(changes.at(-1)).toEqual({ state: 'locked', masterPassword: true })
  })

  it('asks for the current password before changing or removing it', async () => {
    await protectedVault()
    const { vaults } = service()
    await vaults.unlock(PASSWORD)
    await expect(vaults.setMasterPassword('wrong', null)).rejects.toMatchObject({
      code: 'VAULT_PASSWORD_WRONG',
    })
    await expect(vaults.setMasterPassword(undefined, 'another password')).rejects.toMatchObject({
      code: 'VAULT_PASSWORD_WRONG',
    })
    await expect(vaults.setMasterPassword(PASSWORD, null)).resolves.toEqual({
      state: 'unlocked',
      masterPassword: false,
    })
  })

  it('lists the backups newest first and restores one, keeping the current data as a backup', async () => {
    const { vaults } = service()
    const vault = await vaults.get()
    for (const name of ['One', 'Two', 'Three']) {
      await vault.update((data) => {
        data.hosts.push(host(name))
      })
    }
    const backups = await vaults.backups()
    expect(backups).toHaveLength(2)
    expect(backups.every((b) => b.protection === 'safeStorage' && b.size > 0)).toBe(true)
    // The newest backup holds One and Two (saved before Three was added).
    const newest = backups[0]
    if (newest === undefined) throw new Error('no backup')
    await expect(vaults.restore(newest.name)).resolves.toMatchObject({ state: 'unlocked' })
    expect((await vaults.get()).read().hosts.map((h) => h.name)).toEqual(['One', 'Two'])
    expect(await vaults.backups()).toHaveLength(3)
  })

  it('restores while unlocked with a master password, without asking again', async () => {
    await protectedVault()
    const { vaults } = service()
    await vaults.unlock(PASSWORD)
    const [newest] = await vaults.backups()
    if (newest === undefined) throw new Error('no backup')
    expect(newest.protection).toBe('password')
    await expect(vaults.restore(newest.name)).resolves.toEqual({
      state: 'unlocked',
      masterPassword: true,
    })
    expect((await vaults.get()).read().hosts.map((h) => h.name)).toEqual(['Alpha'])
  })

  it('refuses to restore while locked, or a name that is not a backup', async () => {
    await protectedVault()
    const { vaults } = service()
    const name = (await listBackups(path.join(dir, VAULT_BACKUP_DIR)))[0] ?? ''
    await expect(vaults.restore(name)).rejects.toMatchObject({ code: 'VAULT_LOCKED' })
    await expect(vaults.backups()).rejects.toMatchObject({ code: 'VAULT_LOCKED' })
    await vaults.unlock(PASSWORD)
    await expect(vaults.restore('vault-not-there.json')).rejects.toMatchObject({
      code: 'VAULT_BACKUP_UNREADABLE',
    })
  })

  it('restores a backup when the vault file is damaged', async () => {
    const vault = await vaultWithHosts('Alpha', 'Beta')
    await writeFile(vault.filePath, '{ damaged')
    const { vaults } = service()
    await expect(vaults.status()).resolves.toMatchObject({
      state: 'failed',
      error: 'VAULT_CORRUPT',
    })
    const [newest] = await vaults.backups()
    if (newest === undefined) throw new Error('no backup')
    await expect(vaults.restore(newest.name)).resolves.toMatchObject({ state: 'unlocked' })
    expect((await vaults.get()).read().hosts.map((h) => h.name)).toEqual(['Alpha'])
  })
})

describe('export file', () => {
  const data = (): VaultData => ({ ...emptyVaultData(), hosts: [host('Exported')] })

  it('round-trips with its password and hides the contents', async () => {
    const text = await createExport(data(), 'export password', COST)
    expect(text).not.toContain('Exported')
    expect(JSON.parse(text)).toMatchObject({ format: 'kelidar-export', kdf: 'scrypt', ...COST })
    const back = await readExport(text, 'export password')
    expect(back.hosts.map((h) => h.name)).toEqual(['Exported'])
  })

  it('tells a wrong password, a foreign file and a newer version apart', async () => {
    const text = await createExport(data(), 'export password', COST)
    await expect(readExport(text, 'wrong')).rejects.toEqual(new ExportFileError('password'))
    await expect(readExport('{"hello":1}', 'x')).rejects.toEqual(new ExportFileError('invalid'))
    const newer = { ...(JSON.parse(text) as object), version: 99 }
    await expect(readExport(JSON.stringify(newer), 'x')).rejects.toEqual(
      new ExportFileError('newer'),
    )
  })
})

describe('mergeVaultData', () => {
  it('adds new records and keeps the copy changed last', () => {
    const shared = host('Shared', at(5))
    const stale = { ...shared, name: 'Shared (old)', updatedAt: at(1) }
    const newer = { ...shared, name: 'Shared (new)', updatedAt: at(9) }
    const current = { ...emptyVaultData(), hosts: [shared] }

    const older = mergeVaultData(current, { ...emptyVaultData(), hosts: [stale, host('Added')] })
    expect(older.data.hosts.map((h) => h.name)).toEqual(['Shared', 'Added'])
    expect(older.summary).toEqual({ added: 1, updated: 0, unchanged: 1 })

    const fresh = mergeVaultData(current, { ...emptyVaultData(), hosts: [newer] })
    expect(fresh.data.hosts.map((h) => h.name)).toEqual(['Shared (new)'])
    expect(fresh.summary).toEqual({ added: 0, updated: 1, unchanged: 0 })
  })

  it('keeps one trusted key per server: the newer one', () => {
    const known = (fingerprint: string, updatedAt: string) => ({
      id: randomUUID(),
      createdAt: updatedAt,
      updatedAt,
      host: 'server.example.test',
      port: 22,
      keyType: 'ssh-ed25519',
      fingerprint,
    })
    const merged = mergeVaultData(
      { ...emptyVaultData(), knownHosts: [known('SHA256:old', at(1))] },
      { ...emptyVaultData(), knownHosts: [known('SHA256:new', at(2))] },
    )
    const live = merged.data.knownHosts.filter((k) => k.deletedAt === undefined)
    expect(live.map((k) => k.fingerprint)).toEqual(['SHA256:new'])
  })

  it('finds references that point nowhere and groups that loop', () => {
    const a = randomUUID()
    const b = randomUUID()
    const group = (id: string, parentId: string) => ({
      id,
      createdAt: at(0),
      updatedAt: at(0),
      name: id.slice(0, 4),
      parentId,
    })
    expect(isConsistent({ ...emptyVaultData(), groups: [group(a, b), group(b, a)] })).toBe(false)
    const missingSecret = host('NoSecret', at(0), {
      username: 'root',
      auth: { type: 'password', secretId: randomUUID() },
    })
    expect(isConsistent({ ...emptyVaultData(), hosts: [missingSecret] })).toBe(false)
    expect(isConsistent({ ...emptyVaultData(), hosts: [host('Fine')] })).toBe(true)
  })
})

describe('DataTransfer', () => {
  it('exports to a file and imports it into another vault', async () => {
    const source = new VaultService({ directory: dir, wrapper: fakeWrapper(), scryptCost: COST })
    await (
      await source.get()
    ).update((data) => {
      data.hosts.push(host('Travelling'))
    })
    const file = path.join(dir, 'backup.kelidar')
    await new DataTransfer(source, { scryptCost: COST }).exportTo(file, 'file password')

    const otherDir = await mkdtemp(path.join(os.tmpdir(), 'kelidar-import-'))
    try {
      const target = new VaultService({ directory: otherDir, wrapper: fakeWrapper() })
      let now = 0
      const transfer = new DataTransfer(target, { now: () => now })
      const picked = await transfer.pick(file)
      expect(picked.fileName).toBe('backup.kelidar')
      await expect(transfer.import(picked.token, 'wrong')).rejects.toMatchObject({
        code: 'IMPORT_PASSWORD_WRONG',
      })
      await expect(transfer.import(picked.token, 'file password')).resolves.toEqual({
        added: 1,
        updated: 0,
        unchanged: 0,
      })
      expect((await target.get()).read().hosts.map((h) => h.name)).toEqual(['Travelling'])

      const again = await transfer.pick(file)
      now = 11 * 60 * 1000
      await expect(transfer.import(again.token, 'file password')).rejects.toMatchObject({
        code: 'IMPORT_EXPIRED',
      })
    } finally {
      await rm(otherDir, { recursive: true, force: true })
    }
  })

  it('refuses a file that is not an export', async () => {
    const vaults = new VaultService({ directory: dir, wrapper: fakeWrapper() })
    const file = path.join(dir, 'notes.txt')
    await writeFile(file, 'just some text')
    await expect(new DataTransfer(vaults).pick(file)).rejects.toMatchObject({
      code: 'IMPORT_FILE_INVALID',
    })
  })
})

describe('SecretClipboard', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const fakeClipboard = () => {
    const board = {
      text: '',
      writeText: (text: string) => {
        board.text = text
      },
      readText: () => board.text,
      clear: () => {
        board.text = ''
      },
    }
    return board
  }

  it('clears the password after the chosen time, if it is still there', async () => {
    vi.useFakeTimers()
    const board = fakeClipboard()
    const secrets = new SecretClipboard(board, () => 30)
    await expect(secrets.copy('s3cret')).resolves.toBe(30)
    expect(board.text).toBe('s3cret')
    await vi.advanceTimersByTimeAsync(29_000)
    expect(board.text).toBe('s3cret')
    await vi.advanceTimersByTimeAsync(1000)
    expect(board.text).toBe('')
  })

  it('leaves text the user copied since', async () => {
    vi.useFakeTimers()
    const board = fakeClipboard()
    const secrets = new SecretClipboard(board, () => 15)
    await secrets.copy('s3cret')
    board.text = 'something else'
    await vi.advanceTimersByTimeAsync(15_000)
    expect(board.text).toBe('something else')
  })

  it('keeps it without a timer when set to never, until lock or quit', async () => {
    const board = fakeClipboard()
    const secrets = new SecretClipboard(board, () => 0)
    await expect(secrets.copy('s3cret')).resolves.toBe(0)
    expect(board.text).toBe('s3cret')
    await secrets.clear()
    expect(board.text).toBe('')
  })
})

describe('AutoLock', () => {
  const setup = (settings: { autoLockMinutes: number; lockOnWindowsLock: boolean }) => {
    const lock = vi.fn()
    let idle = 0
    let systemLock: (() => void) | undefined
    const auto = new AutoLock({
      idleSeconds: () => idle,
      onSystemLock: (listener) => {
        systemLock = listener
        return () => {
          systemLock = undefined
        }
      },
      settings: () => settings,
      lock,
    })
    auto.start()
    return {
      lock,
      auto,
      setIdle: (seconds: number) => {
        idle = seconds
      },
      windowsLocks: () => systemLock?.(),
    }
  }

  it('locks after the chosen minutes without input', () => {
    const { lock, auto, setIdle } = setup({ autoLockMinutes: 5, lockOnWindowsLock: false })
    setIdle(299)
    auto.check()
    expect(lock).not.toHaveBeenCalled()
    setIdle(300)
    auto.check()
    expect(lock).toHaveBeenCalledTimes(1)
    auto.stop()
  })

  it('never locks on idle when set to never', () => {
    const { lock, auto, setIdle } = setup({ autoLockMinutes: 0, lockOnWindowsLock: false })
    setIdle(100_000)
    auto.check()
    expect(lock).not.toHaveBeenCalled()
    auto.stop()
  })

  it('locks when Windows locks, if asked to', () => {
    const on = setup({ autoLockMinutes: 0, lockOnWindowsLock: true })
    on.windowsLocks()
    expect(on.lock).toHaveBeenCalledTimes(1)
    on.auto.stop()
    const off = setup({ autoLockMinutes: 0, lockOnWindowsLock: false })
    off.windowsLocks()
    expect(off.lock).not.toHaveBeenCalled()
    off.auto.stop()
  })
})

describe('security settings', () => {
  it('accept only the offered values', () => {
    expect(uiSettingsPatchSchema.safeParse({ autoLockMinutes: 15 }).success).toBe(true)
    expect(uiSettingsPatchSchema.safeParse({ autoLockMinutes: 7 }).success).toBe(false)
    expect(uiSettingsPatchSchema.safeParse({ clipboardClearSeconds: 0 }).success).toBe(true)
    expect(uiSettingsPatchSchema.safeParse({ clipboardClearSeconds: 5 }).success).toBe(false)
  })

  it('error codes stay codes', () => {
    expect(new AppError('VAULT_LOCKED').message).toBe('VAULT_LOCKED')
  })
})
