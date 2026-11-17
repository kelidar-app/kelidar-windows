import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HostService } from '../../src/main/hosts/host-service'
import { KeyFileImports } from '../../src/main/hosts/key-files'
import { parseOsRelease } from '../../src/main/hosts/os-release'
import { HostImports, type ImportSourcesDeps } from '../../src/main/importers/import-service'
import { parsePuttySessions, parseRegExport } from '../../src/main/importers/putty'
import { expandIncludes, parseSshConfig } from '../../src/main/importers/ssh-config'
import { VaultService } from '../../src/main/vault/service'
import { hostSaveRequestSchema } from '../../src/shared/hosts'
import { fakeWrapper } from './helpers/fake-wrapper'
import { readableKeyPair } from './helpers/keys'

const HOME = path.join('C:', 'Users', 'test')
const context = { home: HOME, localUser: 'winuser' }
const sshPath = (...parts: string[]): string => path.join(HOME, '.ssh', ...parts)

describe('ssh config importer', () => {
  it('reads each alias with the values OpenSSH would use', () => {
    const hosts = parseSshConfig(
      [
        'Host web web-alias',
        '  HostName 203.0.113.10',
        '  User deploy',
        '  IdentityFile ~/.ssh/web_key',
        'Host db',
        '  HostName %h.internal.example.test',
        '  Port 2222',
        '  ProxyJump web',
        'Host *.example.test !skip *',
        '  ForwardAgent yes',
        '  User fallback',
      ].join('\n'),
      context,
    )
    expect(hosts.map((host) => host.name)).toEqual(['web', 'web-alias', 'db'])
    expect(hosts[0]).toMatchObject({
      source: 'sshConfig',
      address: '203.0.113.10',
      port: 22,
      username: 'deploy',
      keyFiles: [sshPath('web_key')],
      defaultKeys: false,
      agentForward: true,
      warnings: [],
    })
    expect(hosts[2]).toMatchObject({
      address: 'db.internal.example.test',
      port: 2222,
      username: 'fallback',
      jump: 'web',
      keyFiles: [],
      defaultKeys: true,
    })
  })

  it('uses the Windows user name when none is set, and warns about what it cannot do', () => {
    const [chain, command] = parseSshConfig(
      [
        'Host chain',
        '  HostName chain.example.test',
        '  ProxyJump first,second:2200',
        'Host command',
        '  HostName 192.0.2.3',
        '  ProxyCommand nc -X 5 -x proxy:1080 %h %p',
      ].join('\n'),
      context,
    )
    expect(chain).toMatchObject({
      username: 'winuser',
      jump: 'second:2200',
      warnings: ['jumpChain'],
    })
    expect(command?.warnings).toEqual(['proxyCommand'])
  })

  it('never runs Match exec', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'kelidar-match-'))
    const marker = path.join(dir, 'ran.txt')
    try {
      parseSshConfig(
        [
          `Match exec "echo ran > ${marker}"`,
          '  User nobody',
          'Host box',
          '  HostName box.example.test',
        ].join('\n'),
        context,
      )
      await expect(stat(marker)).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('follows Include, with wildcards and paths relative to ~/.ssh', async () => {
    const files = new Map([
      [sshPath('conf.d', 'a.conf'), 'Host a\n  HostName a.example.test'],
      [sshPath('conf.d', 'b.conf'), 'Host b\n  HostName b.example.test\nInclude extra'],
      [sshPath('extra'), 'Host c\n  HostName c.example.test'],
      [sshPath('conf.d', 'notes.txt'), 'Host ignored'],
    ])
    const text = await expandIncludes(
      'Include conf.d/*.conf\nHost main\n  HostName main.example.test',
      {
        readFile: (file) => {
          const found = files.get(file)
          return found === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(found)
        },
        listDir: (dir) =>
          Promise.resolve(
            [...files.keys()]
              .filter((file) => path.dirname(file) === dir)
              .map((file) => path.basename(file)),
          ),
      },
      context,
    )
    expect(parseSshConfig(text, context).map((host) => host.name)).toEqual(['a', 'b', 'c', 'main'])
  })
})

const REG = [
  '\uFEFFWindows Registry Editor Version 5.00',
  '',
  '[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions]',
  '',
  '[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Default%20Settings]',
  '"HostName"=""',
  '"PortNumber"=dword:00000016',
  '',
  '[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Web%20Server]',
  '"Present"=dword:00000001',
  '"HostName"="admin@web.example.test"',
  '"PortNumber"=dword:000008ae',
  '"Protocol"="ssh"',
  '"PublicKeyFile"="C:\\\\Keys\\\\web.ppk"',
  '"AgentFwd"=dword:00000001',
  '"Colour0"=hex:01,02,03,\\',
  '  04,05',
  '"ProxyMethod"=dword:00000002',
  '"ProxyHost"="socks.example.test"',
  '"ProxyPort"=dword:00000438',
  '"ProxyUsername"="proxyuser"',
  '"ProxyPassword"="proxy \\"secret\\""',
  '',
  '[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\%D8%B3%D8%B1%D9%88%D8%B1]',
  '"HostName"="192.0.2.50"',
  '"UserName"="علی"',
  '"Protocol"="ssh"',
  '"ProxyMethod"=dword:00000006',
  '"ProxyHost"="bastion.example.test"',
  '"ProxyPort"=dword:00000016',
  '"ProxyUsername"="jump"',
  '',
  '[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Old%20Telnet]',
  '"HostName"="telnet.example.test"',
  '"Protocol"="telnet"',
  '',
  '[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\No%20User]',
  '"HostName"="nouser.example.test"',
  '"Protocol"="ssh"',
  '"ProxyMethod"=dword:00000001',
  '"ProxyHost"="socks4.example.test"',
].join('\r\n')

describe('PuTTY importer', () => {
  it('reads strings, DWORDs and skips binary values', () => {
    const keys = parseRegExport(REG)
    const web = keys.get('HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Web%20Server')
    expect(web?.get('PortNumber')).toBe(2222)
    expect(web?.get('PublicKeyFile')).toBe('C:\\Keys\\web.ppk')
    expect(web?.get('ProxyPassword')).toBe('proxy "secret"')
    expect(web?.has('Colour0')).toBe(false)
  })

  it('turns each SSH session with a host into a host', () => {
    const hosts = parsePuttySessions(REG)
    expect(hosts.map((host) => host.name)).toEqual(['Web Server', 'سرور', 'No User'])
    expect(hosts[0]).toMatchObject({
      source: 'putty',
      address: 'web.example.test',
      port: 2222,
      username: 'admin',
      keyFiles: ['C:\\Keys\\web.ppk'],
      defaultKeys: false,
      agentForward: true,
      proxy: {
        type: 'socks5',
        host: 'socks.example.test',
        port: 1080,
        username: 'proxyuser',
        password: 'proxy "secret"',
      },
      warnings: [],
    })
    expect(hosts[1]).toMatchObject({ username: 'علی', jump: 'jump@bastion.example.test:22' })
    expect(hosts[2]).toMatchObject({
      username: undefined,
      warnings: ['noUsername', 'proxyUnsupported'],
    })
  })
})

describe('os-release', () => {
  it('names the system by ID, then ID_LIKE', () => {
    expect(
      parseOsRelease(
        'NAME="Ubuntu"\nVERSION_ID="24.04"\nID=ubuntu\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n',
      ),
    ).toEqual({ id: 'ubuntu', name: 'Ubuntu 24.04.1 LTS' })
    expect(parseOsRelease('ID="rocky"\nNAME="Rocky Linux"\nVERSION_ID="9.4"')).toEqual({
      id: 'rocky',
      name: 'Rocky Linux 9.4',
    })
    expect(parseOsRelease('ID=pop\nID_LIKE="ubuntu debian"\nPRETTY_NAME="Pop!_OS 22.04"')).toEqual({
      id: 'ubuntu',
      name: 'Pop!_OS 22.04',
    })
    expect(parseOsRelease('ID=nixos\nPRETTY_NAME="NixOS 24.05"')).toEqual({
      id: 'linux',
      name: 'NixOS 24.05',
    })
    expect(parseOsRelease('cat: /etc/os-release: No such file or directory')).toBeUndefined()
  })
})

describe('HostImports', () => {
  let dir: string
  let vaults: VaultService
  let now = 0
  const key = readableKeyPair('ed25519')
  const encrypted = readableKeyPair('ed25519', {
    passphrase: 'secret',
    cipher: 'aes256-ctr',
    rounds: 4,
  })

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'kelidar-import-'))
    vaults = new VaultService({ directory: dir, wrapper: fakeWrapper() })
    now = 0
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const imports = (overrides: Partial<ImportSourcesDeps>) =>
    new HostImports(vaults, {
      ...context,
      readSshConfig: () => Promise.resolve(null),
      readPutty: () => Promise.resolve(null),
      readKeyFile: (file) => {
        const files: Record<string, string> = {
          [sshPath('plain')]: key.private,
          [sshPath('locked')]: encrypted.private,
          [sshPath('id_ed25519')]: key.private,
        }
        const found = files[file]
        return found === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(found)
      },
      clock: () => now,
      ...overrides,
    })

  const CONFIG = [
    'Host bastion',
    '  HostName bastion.example.test',
    '  User jump',
    '  IdentityFile ~/.ssh/plain',
    'Host app',
    '  HostName app.example.test',
    '  User deploy',
    '  IdentityFile ~/.ssh/plain',
    '  ProxyJump bastion',
    'Host locked',
    '  HostName locked.example.test',
    '  IdentityFile ~/.ssh/locked',
    'Host gone',
    '  HostName gone.example.test',
    '  IdentityFile ~/.ssh/missing',
    '  ProxyJump nowhere',
    'Host defaults',
    '  HostName defaults.example.test',
  ].join('\n')

  it('previews keys, the agent, missing files and jump hosts, without secrets', async () => {
    const scan = await imports({ readSshConfig: () => Promise.resolve(CONFIG) }).scan()
    expect(scan.sources).toEqual([
      { source: 'sshConfig', found: true },
      { source: 'putty', found: false },
    ])
    const byName = Object.fromEntries(scan.candidates.map((row) => [row.name, row]))
    expect(byName['app']).toMatchObject({ signIn: 'key', keyName: 'plain', jump: 'bastion' })
    expect(byName['locked']).toMatchObject({ signIn: 'agent', warnings: ['keyEncrypted'] })
    expect(byName['gone']).toMatchObject({
      signIn: 'ask',
      warnings: ['keyUnreadable', 'jumpNotFound'],
    })
    // No IdentityFile: OpenSSH's default ~/.ssh/id_ed25519.
    expect(byName['defaults']).toMatchObject({
      signIn: 'key',
      keyName: 'id_ed25519',
      username: 'winuser',
    })
    expect(JSON.stringify(scan)).not.toContain('PRIVATE KEY')
  })

  it('imports the chosen rows: one key for many hosts, jump hosts linked, tagged by source', async () => {
    const service = imports({ readSshConfig: () => Promise.resolve(CONFIG) })
    const scan = await service.scan()
    const ids = scan.candidates
      .filter((row) => ['bastion', 'app', 'locked', 'defaults'].includes(row.name))
      .map((row) => row.id)
    // The default key is the same file content as "plain": still one key.
    await expect(service.apply(scan.token, ids)).resolves.toEqual({ hosts: 4, keys: 1 })

    const hosts = await new HostService(vaults, new KeyFileImports()).list()
    const app = hosts.find((host) => host.name === 'app')
    expect(app).toMatchObject({
      address: 'app.example.test',
      username: 'deploy',
      tags: ['ssh-config'],
      signIn: { method: 'key', keyName: 'plain' },
      jump: { name: 'bastion', from: 'host' },
    })
    expect(hosts.find((host) => host.name === 'locked')?.signIn).toEqual({ method: 'agent' })
    expect((await vaults.get()).read().keys).toHaveLength(1)

    // A second scan sees them as saved already.
    const again = await service.scan()
    expect(again.candidates.find((row) => row.name === 'app')?.duplicateOf).toBe('app')
    await expect(service.apply(scan.token, ids)).rejects.toMatchObject({ code: 'IMPORT_EXPIRED' })
  })

  it('saves a PuTTY proxy password as a secret, never in the preview', async () => {
    const service = imports({ readPutty: () => Promise.resolve(REG) })
    const scan = await service.scan()
    expect(JSON.stringify(scan)).not.toContain('secret')
    const web = scan.candidates.find((row) => row.name === 'Web Server')
    if (web === undefined) throw new Error('missing row')
    expect(web).toMatchObject({ signIn: 'ask', warnings: ['keyUnreadable'] })
    await service.apply(scan.token, [web.id])
    const data = (await vaults.get()).read()
    const host = data.hosts[0]
    expect(host).toMatchObject({ tags: ['putty'], port: 2222, agentForward: true })
    expect(data.secrets.find((item) => item.id === host?.proxy?.secretId)?.value).toBe(
      'proxy "secret"',
    )
    expect(await readFile(path.join(dir, 'vault.json'), 'utf8')).not.toContain('proxy')
  })

  it('forgets a scan after 30 minutes', async () => {
    const service = imports({ readSshConfig: () => Promise.resolve(CONFIG) })
    const scan = await service.scan()
    now = 31 * 60 * 1000
    await expect(service.apply(scan.token, [scan.candidates[0]?.id ?? ''])).rejects.toMatchObject({
      code: 'IMPORT_EXPIRED',
    })
  })
})

describe('host notes and links', () => {
  const base = { name: 'n', address: 'a.example.test', username: 'u', auth: { type: 'agent' } }

  it('accepts web links only', () => {
    expect(
      hostSaveRequestSchema.safeParse({
        ...base,
        links: [{ title: 'Panel', url: 'https://panel.example.test:2083' }],
      }).success,
    ).toBe(true)
    for (const url of [
      'javascript:alert(1)',
      'file:///C:/x',
      'https://user:pw@example.test',
      'panel',
    ]) {
      expect(hostSaveRequestSchema.safeParse({ ...base, links: [{ url }] }).success, url).toBe(
        false,
      )
    }
  })

  it('saves and clears them', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'kelidar-notes-'))
    try {
      const service = new HostService(
        new VaultService({ directory: dir, wrapper: fakeWrapper() }),
        new KeyFileImports(),
      )
      const saved = await service.save(
        hostSaveRequestSchema.parse({
          ...base,
          notes: '  Call Sara before restarting.  ',
          links: [{ url: 'https://panel.example.test' }],
        }),
      )
      expect(saved).toMatchObject({
        notes: 'Call Sara before restarting.',
        links: [{ url: 'https://panel.example.test' }],
      })
      const cleared = await service.save(hostSaveRequestSchema.parse({ ...base, id: saved.id }))
      expect(cleared.notes).toBeUndefined()
      expect(cleared.links).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
