import { describe, expect, it } from 'vitest'
import { ipv6Bytes } from '../../src/main/ssh/proxy'
import { DEFAULT_TIMING } from '../../src/main/ssh/session-manager'
import {
  connectionRequest,
  initialConnection,
  stickySessionName,
} from '../../src/renderer/features/hosts/connection-draft'
import { hostSaveRequestSchema } from '../../src/shared/hosts'

describe('SOCKS5 addresses', () => {
  it('writes IPv6 addresses as 16 bytes, with :: expanded', () => {
    expect(ipv6Bytes('2001:db8::1').toString('hex')).toBe('20010db8000000000000000000000001')
    expect(ipv6Bytes('::1').toString('hex')).toBe('00000000000000000000000000000001')
    expect(ipv6Bytes('fe80::1%eth0').toString('hex')).toBe('fe800000000000000000000000000001')
  })
})

describe('reconnect', () => {
  it('waits 1, 2, 5, 10 and then 30 seconds between attempts', () => {
    expect(DEFAULT_TIMING.reconnectDelaysMs).toEqual([1000, 2000, 5000, 10_000, 30_000])
  })
})

describe('host form connection options', () => {
  const empty = initialConnection(undefined)

  it('defaults to the group jump host, no proxy, no startup command', () => {
    expect(connectionRequest(empty, undefined)).toEqual({
      ok: true,
      fields: { jump: { type: 'inherit' } },
    })
  })

  it('builds a proxy with its default port, and keeps a saved password unless told not to', () => {
    const draft = { ...empty, proxyType: 'socks5' as const, proxyHost: 'Proxy.Example.com' }
    expect(connectionRequest(draft, undefined)).toEqual({
      ok: true,
      fields: {
        jump: { type: 'inherit' },
        proxy: { type: 'socks5', host: 'proxy.example.com', port: 1080, password: '' },
      },
    })
    const saved = {
      proxy: { type: 'socks5' as const, host: 'p', port: 1080, hasPassword: true },
    } as Parameters<typeof connectionRequest>[1]
    const kept = connectionRequest(draft, saved)
    expect(kept.ok && kept.fields.proxy).toEqual({
      type: 'socks5',
      host: 'proxy.example.com',
      port: 1080,
    })
    const forgotten = connectionRequest({ ...draft, forgetProxyPassword: true }, saved)
    expect(forgotten.ok && forgotten.fields.proxy?.password).toBe('')
  })

  it('refuses a bad proxy address or port and a multi-line startup command', () => {
    expect(
      connectionRequest(
        { ...empty, proxyType: 'http', proxyHost: 'bad host', proxyPort: '99999' },
        undefined,
      ),
    ).toEqual({ ok: false, errors: { proxyHost: true, proxyPort: true } })
    expect(connectionRequest({ ...empty, startup: 'a\nb' }, undefined)).toEqual({
      ok: false,
      errors: { startup: true },
    })
  })

  it('maps the jump choice and the sticky option', () => {
    const id = crypto.randomUUID()
    const result = connectionRequest(
      { ...empty, jump: id, sticky: true, startup: ' ls ' },
      undefined,
    )
    expect(result).toEqual({
      ok: true,
      fields: { jump: { type: 'host', hostId: id }, startupCommand: 'ls', stickySession: true },
    })
    expect(connectionRequest({ ...empty, jump: 'none' }, undefined)).toMatchObject({
      fields: { jump: { type: 'none' } },
    })
    // Every request the form builds passes main's schema.
    if (!result.ok) throw new Error('expected ok')
    expect(
      hostSaveRequestSchema.safeParse({
        name: 'x',
        address: 'x.example.com',
        username: 'u',
        auth: { type: 'password' },
        ...result.fields,
      }).success,
    ).toBe(true)
  })

  it('names the tmux session after the host', () => {
    expect(stickySessionName('0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d')).toBe('kelidar-0a1b2c3d')
  })
})
