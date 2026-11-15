import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { utils } from 'ssh2'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HostService } from '../../src/main/hosts/host-service'
import { KeyFileImports, MAX_KEY_FILE_BYTES } from '../../src/main/hosts/key-files'
import { VaultService } from '../../src/main/vault/service'
import { Vault } from '../../src/main/vault/vault'
import { formatTarget, normalizeAddress } from '../../src/shared/address'
import { hostSaveRequestSchema, type HostSaveRequest } from '../../src/shared/hosts'
import { ipcContract } from '../../src/shared/ipc'
import { fakeWrapper } from './helpers/fake-wrapper'

describe('normalizeAddress', () => {
  it('accepts host names, IPv4 and IPv6', () => {
    expect(normalizeAddress('Server.Example.com')).toBe('server.example.com')
    expect(normalizeAddress(' 203.0.113.7 ')).toBe('203.0.113.7')
    expect(normalizeAddress('localhost')).toBe('localhost')
    expect(normalizeAddress('[2001:DB8::1]')).toBe('2001:db8::1')
    expect(normalizeAddress('fe80::1%eth0')).toBe('fe80::1%eth0')
    expect(normalizeAddress('host.example.com.')).toBe('host.example.com.')
  })

  it('refuses everything else', () => {
    for (const bad of [
      '',
      ' ',
      '-oProxyCommand=x',
      'a b',
      'user@host',
      'host:22',
      'a..b',
      '[::1',
      'x'.repeat(300),
    ]) {
      expect(normalizeAddress(bad), bad).toBeNull()
    }
  })

  it('formats targets for display', () => {
    expect(formatTarget({ username: 'root', address: 'h', port: 22 })).toBe('root@h')
    expect(formatTarget({ username: 'root', address: 'h', port: 2222 })).toBe('root@h:2222')
    expect(formatTarget({ address: '::1', port: 2222 })).toBe('[::1]:2222')
  })
})

describe('hosts:save schema', () => {
  const valid: HostSaveRequest = {
    name: 'Web',
    address: 'Web.Example.com',
    username: 'deploy',
    auth: { type: 'password', password: 'pw' },
  }

  it('accepts a valid request and normalizes the address', () => {
    const parsed = hostSaveRequestSchema.parse(valid)
    expect(parsed.address).toBe('web.example.com')
  })

  it('refuses bad fields and unknown fields', () => {
    const bad: unknown[] = [
      { ...valid, address: 'bad host' },
      { ...valid, username: 'two words' },
      { ...valid, username: '' },
      { ...valid, port: 0 },
      { ...valid, port: 70000 },
      { ...valid, name: '' },
      { ...valid, extra: true },
      { ...valid, auth: { type: 'password', password: 'x', secretId: 'y' } },
      { ...valid, auth: { type: 'key', keyFileToken: '../../etc/passwd' } },
      { ...valid, auth: { type: 'agent' } },
    ]
    for (const item of bad) expect(hostSaveRequestSchema.safeParse(item).success).toBe(false)
  })

  it('hosts:delete takes only a uuid', () => {
    const schema = ipcContract['hosts:delete'].request
    expect(schema.safeParse({ id: crypto.randomUUID() }).success).toBe(true)
    expect(schema.safeParse({ id: 'x' }).success).toBe(false)
  })
})

describe('HostService', () => {
  let dir: string
  let vaults: VaultService
  let keyFiles: KeyFileImports
  let service: HostService

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'kelidar-hosts-'))
    vaults = new VaultService(() => Vault.open({ directory: dir, wrapper: fakeWrapper() }))
    keyFiles = new KeyFileImports()
    service = new HostService(vaults, keyFiles)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const save = (request: HostSaveRequest) => service.save(hostSaveRequestSchema.parse(request))
  const vaultData = async () => (await vaults.get()).read()

  const writeKey = async (options: { passphrase?: string } = {}) => {
    const pair =
      options.passphrase === undefined
        ? utils.generateKeyPairSync('ed25519')
        : utils.generateKeyPairSync('ed25519', {
            passphrase: options.passphrase,
            cipher: 'aes256-ctr',
            rounds: 16,
          })
    const file = path.join(dir, `id_ed25519_${String(Math.random()).slice(2)}`)
    await writeFile(file, pair.private)
    return { file, privateKey: pair.private }
  }

  it('saves a password host; the view has no secret', async () => {
    const view = await save({
      name: 'Web',
      address: 'web.example.com',
      username: 'deploy',
      auth: { type: 'password', password: 'hunter2' },
    })
    expect(view.signIn).toEqual({ method: 'password' })
    expect(view.port).toBe(22)
    expect(JSON.stringify(await service.list())).not.toContain('hunter2')
    const data = await vaultData()
    expect(data.secrets.map((s) => s.value)).toEqual(['hunter2'])
    expect(data.hosts[0]?.tags).toEqual([])
  })

  it('keeps, replaces and forgets a saved password', async () => {
    const { id } = await save({
      name: 'Web',
      address: 'web',
      username: 'u',
      auth: { type: 'password', password: 'one' },
    })
    await save({ id, name: 'Web 2', address: 'web', username: 'u', auth: { type: 'password' } })
    expect((await vaultData()).secrets.map((s) => s.value)).toEqual(['one'])

    await save({
      id,
      name: 'Web',
      address: 'web',
      username: 'u',
      auth: { type: 'password', password: 'two' },
    })
    expect((await vaultData()).secrets.map((s) => s.value)).toEqual(['two'])

    const asked = await save({
      id,
      name: 'Web',
      address: 'web',
      username: 'u',
      auth: { type: 'password', password: '' },
    })
    expect(asked.signIn).toEqual({ method: 'ask' })
    const secret = (await vaultData()).secrets[0]
    expect(secret?.value).toBe('')
    expect(secret?.deletedAt).toEqual(expect.any(String))
  })

  it('treats an empty password on a new host as "ask every time"', async () => {
    const view = await save({ name: 'A', address: 'a', username: 'u', auth: { type: 'password' } })
    expect(view.signIn).toEqual({ method: 'ask' })
    expect((await vaultData()).secrets).toEqual([])
  })

  it('imports a key file into the vault and never exposes it', async () => {
    const { file, privateKey } = await writeKey()
    const info = await keyFiles.import(file)
    expect(info).toMatchObject({ encrypted: false, keyType: 'ed25519' })
    expect(JSON.stringify(info)).not.toContain('PRIVATE KEY')

    const view = await save({
      name: 'K',
      address: 'k',
      username: 'u',
      auth: { type: 'key', keyFileToken: info.token },
    })
    expect(view.signIn).toMatchObject({ method: 'key', keyType: 'ed25519', hasPassphrase: false })
    const data = await vaultData()
    expect(data.keys[0]?.fingerprint).toMatch(/^SHA256:/)
    expect(data.secrets.map((s) => s.value)).toEqual([privateKey])

    // A token works once.
    await expect(
      save({
        name: 'K2',
        address: 'k',
        username: 'u',
        auth: { type: 'key', keyFileToken: info.token },
      }),
    ).rejects.toMatchObject({ code: 'KEY_FILE_EXPIRED' })
  })

  it('needs the right passphrase for an encrypted key and lets you retry', async () => {
    const { file } = await writeKey({ passphrase: 'open sesame' })
    const info = await keyFiles.import(file)
    expect(info.encrypted).toBe(true)
    const request = (passphrase?: string): HostSaveRequest => ({
      name: 'K',
      address: 'k',
      username: 'u',
      auth: {
        type: 'key',
        keyFileToken: info.token,
        ...(passphrase === undefined ? {} : { passphrase }),
      },
    })
    await expect(save(request())).rejects.toMatchObject({ code: 'KEY_PASSPHRASE_REQUIRED' })
    await expect(save(request('wrong'))).rejects.toMatchObject({ code: 'KEY_PASSPHRASE_WRONG' })
    expect((await vaultData()).hosts).toEqual([])
    const view = await save(request('open sesame'))
    expect(view.signIn).toMatchObject({ method: 'key', hasPassphrase: true })
  })

  it('refuses files that are not private keys', async () => {
    const pair = utils.generateKeyPairSync('ed25519')
    const publicFile = path.join(dir, 'id.pub')
    await writeFile(publicFile, pair.public)
    await expect(keyFiles.import(publicFile)).rejects.toMatchObject({ code: 'KEY_INVALID' })

    const big = path.join(dir, 'big')
    await writeFile(big, 'x'.repeat(MAX_KEY_FILE_BYTES + 1))
    await expect(keyFiles.import(big)).rejects.toMatchObject({ code: 'KEY_INVALID' })

    await expect(keyFiles.import(path.join(dir, 'missing'))).rejects.toMatchObject({
      code: 'KEY_FILE_UNREADABLE',
    })
  })

  it('needs a key file when switching to key sign-in', async () => {
    const { id } = await save({
      name: 'A',
      address: 'a',
      username: 'u',
      auth: { type: 'password' },
    })
    await expect(
      save({ id, name: 'A', address: 'a', username: 'u', auth: { type: 'key' } }),
    ).rejects.toMatchObject({ code: 'KEY_REQUIRED' })
  })

  it('switching from key to password retires the key and its secrets', async () => {
    const { file } = await writeKey()
    const info = await keyFiles.import(file)
    const { id } = await save({
      name: 'K',
      address: 'k',
      username: 'u',
      auth: { type: 'key', keyFileToken: info.token },
    })
    await save({
      id,
      name: 'K',
      address: 'k',
      username: 'u',
      auth: { type: 'password', password: 'pw' },
    })
    const data = await vaultData()
    expect(data.keys[0]?.deletedAt).toEqual(expect.any(String))
    expect(data.secrets.filter((s) => s.deletedAt === undefined).map((s) => s.value)).toEqual([
      'pw',
    ])
  })

  it('deletes a host with a tombstone and wipes its secret', async () => {
    const { id } = await save({
      name: 'A',
      address: 'a',
      username: 'u',
      auth: { type: 'password', password: 'pw' },
    })
    await service.delete(id)
    expect(await service.list()).toEqual([])
    const data = await vaultData()
    expect(data.hosts[0]?.deletedAt).toEqual(expect.any(String))
    expect(data.secrets[0]?.value).toBe('')
    await expect(service.delete(id)).rejects.toMatchObject({ code: 'HOST_NOT_FOUND' })
  })

  it('reports HOST_NOT_FOUND for an unknown id and keeps the port only when set', async () => {
    await expect(
      save({
        id: crypto.randomUUID(),
        name: 'A',
        address: 'a',
        username: 'u',
        auth: { type: 'password' },
      }),
    ).rejects.toMatchObject({ code: 'HOST_NOT_FOUND' })
    const { id } = await save({
      name: 'A',
      address: 'a',
      port: 2222,
      username: 'u',
      auth: { type: 'password' },
    })
    expect((await service.list())[0]?.port).toBe(2222)
    await save({ id, name: 'A', address: 'a', username: 'u', auth: { type: 'password' } })
    expect((await vaultData()).hosts[0]?.port).toBeUndefined()
  })

  it('sorts hosts by name', async () => {
    for (const name of ['beta', 'Alpha', 'gamma']) {
      await save({ name, address: 'a', username: 'u', auth: { type: 'password' } })
    }
    expect((await service.list()).map((h) => h.name)).toEqual(['Alpha', 'beta', 'gamma'])
  })

  it('reports the vault error when the vault cannot open', async () => {
    const broken = new HostService(
      new VaultService(() =>
        Vault.open({
          directory: dir,
          wrapper: fakeWrapper({ isAvailable: () => Promise.resolve(false) }),
        }),
      ),
      keyFiles,
    )
    await expect(broken.list()).rejects.toMatchObject({ code: 'VAULT_UNAVAILABLE' })
  })
})
