import { describe, expect, it } from 'vitest'
import { parseQuickConnect } from '../../src/shared/quick-connect'

const ok = (input: string) => {
  const result = parseQuickConnect(input)
  if (!result.ok) throw new Error(`${input}: ${result.error}`)
  return result.target
}

describe('parseQuickConnect', () => {
  it('reads user@host and user@host:port', () => {
    expect(ok('root@example.com')).toEqual({ username: 'root', address: 'example.com' })
    expect(ok('  deploy@Web.Example.com:2222 ')).toEqual({
      username: 'deploy',
      address: 'web.example.com',
      port: 2222,
    })
    expect(ok('admin@203.0.113.7:22')).toEqual({
      username: 'admin',
      address: '203.0.113.7',
      port: 22,
    })
  })

  it('reads IPv6 addresses with and without a port', () => {
    expect(ok('root@[2001:db8::1]:2200')).toEqual({
      username: 'root',
      address: '2001:db8::1',
      port: 2200,
    })
    expect(ok('root@2001:db8::1')).toEqual({ username: 'root', address: '2001:db8::1' })
  })

  it('reads full ssh commands', () => {
    expect(ok('ssh user@host -p 2222 -i key')).toEqual({
      username: 'user',
      address: 'host',
      port: 2222,
      identityFile: 'key',
    })
    expect(ok('ssh -p2222 -l admin -i "C:\\Users\\Me\\.ssh\\id ed25519" server.local')).toEqual({
      username: 'admin',
      address: 'server.local',
      port: 2222,
      identityFile: 'C:\\Users\\Me\\.ssh\\id ed25519',
    })
    expect(
      ok('ssh.exe -o Port=2200 -o User=git -o IdentityFile=~/.ssh/id_rsa example.org'),
    ).toEqual({
      username: 'git',
      address: 'example.org',
      port: 2200,
      identityFile: '~/.ssh/id_rsa',
    })
    expect(ok('SSH -v -C -tt root@h')).toEqual({ username: 'root', address: 'h' })
    expect(ok('ssh://root@h:2022')).toEqual({ username: 'root', address: 'h', port: 2022 })
  })

  it('gives user@ priority over -l and -p priority over :port', () => {
    expect(ok('ssh -l other me@host')).toMatchObject({ username: 'me' })
    expect(ok('ssh -p 2 me@host:3')).toMatchObject({ port: 2 })
  })

  it('explains what is wrong', () => {
    const cases: [string, string, string?][] = [
      ['', 'empty'],
      ['   ', 'empty'],
      ['ssh', 'missing-host'],
      ['host.example.com', 'missing-user'],
      ['root@', 'missing-host'],
      ['root@bad host', 'remote-command'],
      ['root@bad_host!', 'invalid-host'],
      ['root@host:99999', 'invalid-port'],
      ['root@host:abc', 'invalid-port'],
      ['ssh -p', 'missing-value', '-p'],
      ['ssh -J jump root@host', 'unsupported-option', '-J'],
      ['ssh -L 8080:localhost:80 root@host', 'unsupported-option', '-L'],
      ['ssh -o ProxyCommand=evil root@host', 'unsupported-option', '-o ProxyCommand'],
      ['ssh -N root@host', 'unsupported-option', '-N'],
      ['ssh root@host uptime', 'remote-command'],
      ['ssh -i "unclosed root@host', 'unclosed-quote'],
      ['ro ot@host', 'remote-command'],
      ['root@[::1', 'invalid-host'],
      ['-oProxyCommand=x@host', 'unsupported-option', '-o ProxyCommand'],
    ]
    for (const [input, error, option] of cases) {
      const result = parseQuickConnect(input)
      expect(result.ok, input).toBe(false)
      if (!result.ok) {
        expect(result.error, input).toBe(error)
        if (option !== undefined) expect(result.option, input).toBe(option)
      }
    }
  })
})
