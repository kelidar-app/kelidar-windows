import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileAtomic } from '../../src/main/fs/atomic-write'
import { open, seal, generateVaultKey } from '../../src/main/vault/crypto'
import {
  listBackups,
  Vault,
  VAULT_BACKUP_COUNT,
  VAULT_FILE_NAME,
  type VaultData,
} from '../../src/main/vault/vault'
import { fakeWrapper } from './helpers/fake-wrapper'

const now = new Date().toISOString()
const SECRET_VALUE = 'correct horse battery staple'

function addSecret(data: VaultData, value = SECRET_VALUE): string {
  const id = randomUUID()
  data.secrets.push({ id, createdAt: now, updatedAt: now, value })
  return id
}

describe('vault crypto', () => {
  it('round-trips and uses a fresh nonce every time', () => {
    const key = generateVaultKey()
    const aad = Buffer.from('header')
    const a = seal(key, Buffer.from('hello'), aad)
    const b = seal(key, Buffer.from('hello'), aad)
    expect(a.nonce.equals(b.nonce)).toBe(false)
    expect(open(key, a, aad).toString()).toBe('hello')
  })

  it('rejects a wrong key, a changed AAD, ciphertext or tag', () => {
    const key = generateVaultKey()
    const aad = Buffer.from('header')
    const box = seal(key, Buffer.from('hello'), aad)
    expect(() => open(generateVaultKey(), box, aad)).toThrow()
    expect(() => open(key, box, Buffer.from('other'))).toThrow()
    const flipped = Buffer.from(box.ciphertext)
    flipped[0] = (flipped[0] ?? 0) ^ 1
    expect(() => open(key, { ...box, ciphertext: flipped }, aad)).toThrow()
    expect(() => open(key, { ...box, tag: Buffer.alloc(16) }, aad)).toThrow()
  })
})

describe('Vault', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'kelidar-vault-'))
    file = path.join(dir, VAULT_FILE_NAME)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const tamper = async (change: (envelope: Record<string, unknown>) => void): Promise<void> => {
    const envelope = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    change(envelope)
    await writeFile(file, JSON.stringify(envelope))
  }

  const flipFirstByte = (value: unknown): string => {
    const bytes = Buffer.from(String(value), 'base64')
    bytes[0] = (bytes[0] ?? 0) ^ 0xff
    return bytes.toString('base64')
  }

  it('writes nothing until the first change', async () => {
    const vault = await Vault.open({ directory: dir, wrapper: fakeWrapper() })
    expect(vault.read().hosts).toEqual([])
    expect(await readdir(dir)).toEqual([])
  })

  it('round-trips data and keeps no plaintext on disk', async () => {
    const wrapper = fakeWrapper()
    const vault = await Vault.open({ directory: dir, wrapper })
    const id = await vault.update((data) => addSecret(data))
    const text = await readFile(file, 'utf8')
    expect(text).not.toContain(SECRET_VALUE)
    expect(text).not.toContain(Buffer.from(SECRET_VALUE).toString('base64'))

    const reopened = await Vault.open({ directory: dir, wrapper })
    expect(reopened.read().secrets).toEqual([
      { id, createdAt: now, updatedAt: now, value: SECRET_VALUE },
    ])
  })

  it('returns copies, so callers cannot change the data by accident', async () => {
    const vault = await Vault.open({ directory: dir, wrapper: fakeWrapper() })
    await vault.update((data) => addSecret(data))
    const copy = vault.read()
    copy.secrets.length = 0
    expect(vault.read().secrets).toHaveLength(1)
  })

  it('uses a new nonce on every save', async () => {
    const vault = await Vault.open({ directory: dir, wrapper: fakeWrapper() })
    await vault.update((data) => addSecret(data))
    const first = JSON.parse(await readFile(file, 'utf8')) as { nonce: string }
    await vault.update(() => undefined)
    const second = JSON.parse(await readFile(file, 'utf8')) as { nonce: string }
    expect(second.nonce).not.toBe(first.nonce)
  })

  it('detects tampering with the body, nonce, tag or header', async () => {
    const wrapper = fakeWrapper()
    const vault = await Vault.open({ directory: dir, wrapper })
    await vault.update((data) => addSecret(data))
    const original = await readFile(file, 'utf8')

    const cases: { name: string; change: (e: Record<string, unknown>) => void; code: string }[] = [
      {
        name: 'body',
        change: (e) => (e['data'] = flipFirstByte(e['data'])),
        code: 'VAULT_CORRUPT',
      },
      {
        name: 'nonce',
        change: (e) => (e['nonce'] = flipFirstByte(e['nonce'])),
        code: 'VAULT_CORRUPT',
      },
      { name: 'tag', change: (e) => (e['tag'] = flipFirstByte(e['tag'])), code: 'VAULT_CORRUPT' },
      { name: 'cipher', change: (e) => (e['cipher'] = 'aes-128-gcm'), code: 'VAULT_CORRUPT' },
      {
        name: 'wrapped key',
        change: (e) => {
          const keyWrap = e['keyWrap'] as { wrappedKey: string }
          keyWrap.wrappedKey = flipFirstByte(keyWrap.wrappedKey)
        },
        code: 'VAULT_CORRUPT',
      },
      { name: 'newer file', change: (e) => (e['version'] = 2), code: 'VAULT_NEWER_VERSION' },
    ]
    for (const { name, change, code } of cases) {
      await writeFile(file, original)
      await tamper(change)
      await expect(Vault.open({ directory: dir, wrapper }), name).rejects.toMatchObject({ code })
    }

    await writeFile(file, '{ not json')
    await expect(Vault.open({ directory: dir, wrapper })).rejects.toMatchObject({
      code: 'VAULT_CORRUPT',
    })
  })

  it('never overwrites a vault it could not read', async () => {
    await writeFile(file, '{ not json')
    await expect(Vault.open({ directory: dir, wrapper: fakeWrapper() })).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe('{ not json')
  })

  it('reports an unavailable wrapper and a key it cannot unwrap', async () => {
    await expect(
      Vault.open({
        directory: dir,
        wrapper: fakeWrapper({ isAvailable: () => Promise.resolve(false) }),
      }),
    ).rejects.toMatchObject({ code: 'VAULT_UNAVAILABLE' })

    const vault = await Vault.open({ directory: dir, wrapper: fakeWrapper() })
    await vault.update((data) => addSecret(data))
    await expect(
      Vault.open({
        directory: dir,
        wrapper: fakeWrapper({ unwrap: () => Promise.reject(new Error('DPAPI says no')) }),
      }),
    ).rejects.toMatchObject({ code: 'VAULT_KEY_UNREADABLE' })
  })

  it('saves atomically: a failed write keeps the old file and the old data', async () => {
    const wrapper = fakeWrapper()
    const vault = await Vault.open({ directory: dir, wrapper })
    await vault.update((data) => addSecret(data, 'first'))
    const before = await readFile(file, 'utf8')

    const failing = await Vault.open({
      directory: dir,
      wrapper,
      writeAtomic: async (target, contents) => {
        // Half of a temp file, then a crash before the rename.
        await writeFile(`${target}.partial.tmp`, contents.slice(0, 10))
        throw new Error('disk full')
      },
    })
    await expect(failing.update((data) => addSecret(data, 'second'))).rejects.toMatchObject({
      code: 'VAULT_WRITE_FAILED',
    })
    expect(failing.read().secrets.map((s) => s.value)).toEqual(['first'])
    expect(await readFile(file, 'utf8')).toBe(before)
    const reopened = await Vault.open({ directory: dir, wrapper })
    expect(reopened.read().secrets.map((s) => s.value)).toEqual(['first'])
  })

  it('leaves no temp files after normal saves', async () => {
    const vault = await Vault.open({
      directory: dir,
      wrapper: fakeWrapper(),
      writeAtomic: writeFileAtomic,
    })
    await vault.update((data) => addSecret(data))
    await vault.update((data) => addSecret(data))
    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('keeps the ten newest backups, each one a readable older vault', async () => {
    const wrapper = fakeWrapper()
    const vault = await Vault.open({ directory: dir, wrapper })
    for (let i = 0; i < VAULT_BACKUP_COUNT + 5; i++) {
      await vault.update((data) => addSecret(data, `v${String(i)}`))
    }
    const backups = await listBackups(vault.backupDir)
    expect(backups).toHaveLength(VAULT_BACKUP_COUNT)

    // The newest backup is the state before the last save.
    const newest = backups.at(-1) ?? ''
    const restoreDir = await mkdtemp(path.join(os.tmpdir(), 'kelidar-restore-'))
    try {
      await writeFile(
        path.join(restoreDir, VAULT_FILE_NAME),
        await readFile(path.join(vault.backupDir, newest)),
      )
      const restored = await Vault.open({ directory: restoreDir, wrapper })
      expect(restored.read().secrets).toHaveLength(VAULT_BACKUP_COUNT + 4)
    } finally {
      await rm(restoreDir, { recursive: true, force: true })
    }
  })

  it('applies concurrent updates one after another', async () => {
    const vault = await Vault.open({ directory: dir, wrapper: fakeWrapper() })
    await Promise.all([
      vault.update((data) => addSecret(data, 'a')),
      vault.update((data) => addSecret(data, 'b')),
      vault.update((data) => addSecret(data, 'c')),
    ])
    expect(vault.read().secrets.map((s) => s.value)).toEqual(['a', 'b', 'c'])
    const reopened = await Vault.open({ directory: dir, wrapper: fakeWrapper() })
    expect(reopened.read().secrets).toHaveLength(3)
  })

  it('rejects data that does not match the schema and keeps the old data', async () => {
    const vault = await Vault.open({ directory: dir, wrapper: fakeWrapper() })
    await expect(
      vault.update((data) => {
        data.secrets.push({ id: 'not-a-uuid', createdAt: now, updatedAt: now, value: 'x' })
      }),
    ).rejects.toThrow()
    expect(vault.read().secrets).toEqual([])
  })

  it('wraps the key again when the wrapper asks for it', async () => {
    const wrapper = fakeWrapper()
    const vault = await Vault.open({ directory: dir, wrapper })
    await vault.update((data) => addSecret(data))
    const rotating = fakeWrapper()
    rotating.unwrap = async (wrapped) => ({ ...(await wrapper.unwrap(wrapped)), rewrap: true })
    const reopened = await Vault.open({ directory: dir, wrapper: rotating })
    expect(rotating.wraps).toBe(0)
    await reopened.update(() => undefined)
    expect(rotating.wraps).toBe(1)
  })
})
