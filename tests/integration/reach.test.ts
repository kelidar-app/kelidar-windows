import { afterEach, describe, expect, it } from 'vitest'
import type { GroupView } from '../../src/shared/groups'
import type { HostView } from '../../src/shared/hosts'
import type { SessionOpenResponse, SessionState } from '../../src/shared/session'
import { createHarness, waitFor, type Harness } from './helpers/harness'
import {
  startDropProxy,
  startTestServer,
  type TestServer,
  type TestServerOptions,
} from './helpers/ssh-server'
import { startHttpProxy, startSocksProxy, type TestProxy } from './helpers/test-proxy'

const PASSWORD = 'pw-Reach-Falcon-8812-secret'
const PROXY_PASSWORD = 'proxy-Pw-Lark-5521'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function setup(options: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
  const harness = await createHarness(options)
  cleanups.push(harness.close)
  return harness
}

async function server(options: TestServerOptions = {}): Promise<TestServer> {
  const started = await startTestServer({ password: PASSWORD, ...options })
  cleanups.push(started.close)
  return started
}

async function proxy(started: Promise<TestProxy>): Promise<TestProxy> {
  const ready = await started
  cleanups.push(ready.close)
  return ready
}

/** Trusts every host key the session asks about (one per server on the way). */
function trustAll(h: Harness): () => void {
  const answered = new Set<string>()
  const timer = setInterval(() => {
    for (const prompt of h.sink.prompts()) {
      if (prompt.kind !== 'hostKey' || answered.has(prompt.promptId)) continue
      answered.add(prompt.promptId)
      void h.call('prompt:answer', {
        promptId: prompt.promptId,
        answer: { kind: 'hostKey', trust: true },
      })
    }
  }, 5)
  return () => {
    clearInterval(timer)
  }
}

function saveHost(h: Harness, fields: Record<string, unknown>): Promise<HostView> {
  return h.call<HostView>('hosts:save', {
    address: '127.0.0.1',
    username: 'tester',
    auth: { type: 'password', password: PASSWORD },
    ...fields,
  })
}

async function open(h: Harness, hostId: string): Promise<string> {
  const opened = await h.call<SessionOpenResponse>('session:open', { hostId, cols: 80, rows: 24 })
  return opened.sessionId
}

function settled(
  h: Harness,
  sessionId: string,
  wanted: SessionState[] = ['ready', 'error', 'closed'],
) {
  return waitFor(() => h.sink.states(sessionId).find((s) => wanted.includes(s.state)), {
    label: `state ${wanted.join('/')}`,
  })
}

describe('jump hosts', () => {
  it('reaches a server through two jump hosts, signing in to each', async () => {
    const h = await setup()
    const stop = trustAll(h)
    const outer = await server()
    const inner = await server()
    const target = await server()
    const outerHost = await saveHost(h, { name: 'outer', port: outer.port })
    const innerHost = await saveHost(h, {
      name: 'inner',
      port: inner.port,
      jump: { type: 'host', hostId: outerHost.id },
    })
    const targetHost = await saveHost(h, {
      name: 'target',
      port: target.port,
      jump: { type: 'host', hostId: innerHost.id },
    })
    expect(targetHost.jump).toEqual({ hostId: innerHost.id, name: 'inner', from: 'host' })

    const id = await open(h, targetHost.id)
    expect(await settled(h, id)).toMatchObject({ state: 'ready' })
    stop()
    expect(outer.forwards).toEqual([{ host: '127.0.0.1', port: inner.port }])
    expect(inner.forwards).toEqual([{ host: '127.0.0.1', port: target.port }])
    expect(target.openShells()).toBe(1)
    // Three servers, three host keys.
    expect(h.sink.prompts().filter((p) => p.kind === 'hostKey')).toHaveLength(3)
    await h.call('session:input', { sessionId: id, data: 'through the jump\r' })
    await waitFor(() => target.received.join('').includes('through the jump'), {
      label: 'input on the target',
    })
  })

  it('takes the jump host from the group, and lets a host connect directly', async () => {
    const h = await setup()
    const stop = trustAll(h)
    const bastion = await server()
    const target = await server()
    const bastionHost = await saveHost(h, { name: 'bastion', port: bastion.port })
    const group = await h.call<GroupView>('groups:save', {
      name: 'Private',
      defaults: { jumpHostId: bastionHost.id },
    })
    const viaGroup = await saveHost(h, { name: 'a', port: target.port, groupId: group.id })
    const direct = await saveHost(h, {
      name: 'b',
      port: target.port,
      groupId: group.id,
      jump: { type: 'none' },
    })
    expect(viaGroup.jump).toMatchObject({ from: 'group', name: 'bastion' })
    expect(direct.jump).toBeUndefined()
    expect(direct.ownJump).toEqual({ type: 'none' })

    expect(await settled(h, await open(h, viaGroup.id))).toMatchObject({ state: 'ready' })
    expect(bastion.forwards).toHaveLength(1)
    expect(await settled(h, await open(h, direct.id))).toMatchObject({ state: 'ready' })
    expect(bastion.forwards).toHaveLength(1)
    stop()
  })

  it('refuses a loop and names the jump host that failed', async () => {
    const h = await setup()
    const stop = trustAll(h)
    const bastion = await server({ noForwarding: true })
    const target = await server()
    const a = await saveHost(h, { name: 'a', port: bastion.port })
    const b = await saveHost(h, {
      name: 'b',
      port: target.port,
      jump: { type: 'host', hostId: a.id },
    })
    await expect(
      h.invoke('hosts:save', {
        id: a.id,
        name: 'a',
        address: '127.0.0.1',
        port: bastion.port,
        username: 'tester',
        auth: { type: 'password' },
        jump: { type: 'host', hostId: b.id },
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'JUMP_HOST_LOOP' } })

    const id = await open(h, b.id)
    expect(await settled(h, id)).toMatchObject({
      state: 'error',
      error: 'JUMP_FORWARD_FAILED',
      via: 'a',
    })
    stop()
  })
})

describe('proxies', () => {
  for (const kind of ['socks5', 'http'] as const) {
    it(`connects through an ${kind.toUpperCase()} proxy with a password`, async () => {
      const h = await setup()
      const stop = trustAll(h)
      const srv = await server()
      const auth = { username: 'proxyuser', password: PROXY_PASSWORD }
      const relay = await proxy(kind === 'socks5' ? startSocksProxy(auth) : startHttpProxy(auth))
      const host = await saveHost(h, {
        name: kind,
        port: srv.port,
        proxy: {
          type: kind,
          host: '127.0.0.1',
          port: relay.port,
          username: 'proxyuser',
          password: PROXY_PASSWORD,
        },
      })
      expect(host.proxy).toEqual({
        type: kind,
        host: '127.0.0.1',
        port: relay.port,
        username: 'proxyuser',
        hasPassword: true,
      })
      expect(await settled(h, await open(h, host.id))).toMatchObject({ state: 'ready' })
      expect(relay.targets).toEqual([`127.0.0.1:${String(srv.port)}`])
      stop()
      expect(JSON.stringify(h.responses)).not.toContain(PROXY_PASSWORD)
    })
  }

  it('says when the proxy refuses the password or is not there', async () => {
    const h = await setup()
    const relay = await proxy(startSocksProxy({ username: 'u', password: 'right' }))
    const wrong = await saveHost(h, {
      name: 'wrong',
      port: 22,
      proxy: { type: 'socks5', host: '127.0.0.1', port: relay.port, username: 'u', password: 'x' },
    })
    expect(await settled(h, await open(h, wrong.id))).toMatchObject({
      state: 'error',
      error: 'PROXY_AUTH_FAILED',
    })
    await relay.close()
    const gone = await saveHost(h, {
      name: 'gone',
      port: 22,
      proxy: { type: 'http', host: '127.0.0.1', port: relay.port },
    })
    expect(await settled(h, await open(h, gone.id))).toMatchObject({
      state: 'error',
      error: 'PROXY_UNREACHABLE',
    })
  })
})

describe('sessions', () => {
  it('opens a second tab on the same connection without signing in again', async () => {
    const h = await setup()
    const stop = trustAll(h)
    const srv = await server()
    const host = await saveHost(h, { name: 'box', port: srv.port })
    const first = await open(h, host.id)
    await settled(h, first)
    const attempts = srv.authAttempts.length

    const second = await h.call<SessionOpenResponse>('session:duplicate', {
      sessionId: first,
      cols: 100,
      rows: 30,
    })
    expect(second.hostId).toBe(host.id)
    expect(await settled(h, second.sessionId)).toMatchObject({ state: 'ready' })
    stop()
    expect(srv.connections).toHaveLength(1)
    expect(srv.authAttempts).toHaveLength(attempts)
    expect(srv.openShells()).toBe(2)

    // Closing one tab keeps the other one and the connection.
    await h.call('session:close', { sessionId: first })
    await h.call('session:input', { sessionId: second.sessionId, data: 'still here\r' })
    await waitFor(() => h.sink.output(second.sessionId).includes('still here'), {
      label: 'second tab works',
    })
  })

  it('types the startup command after sign-in', async () => {
    const h = await setup()
    const stop = trustAll(h)
    const srv = await server()
    const host = await saveHost(h, { name: 'box', port: srv.port, startupCommand: 'cd /srv/app' })
    expect(host.startupCommand).toBe('cd /srv/app')
    await settled(h, await open(h, host.id))
    stop()
    await waitFor(() => srv.received.join('').includes('cd /srv/app\r'), { label: 'startup' })
    await expect(
      h.invoke('hosts:save', {
        name: 'x',
        address: 'x.example.com',
        username: 'u',
        auth: { type: 'password' },
        startupCommand: 'one\ntwo',
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'IPC_INVALID_PAYLOAD' } })
  })

  it('runs a sticky session in tmux and resumes it after the network returns', async () => {
    const h = await setup({
      timing: {
        keepaliveIntervalMs: 100,
        keepaliveCountMax: 2,
        readyTimeoutMs: 400,
        reconnectDelaysMs: [50, 100],
      },
    })
    const stop = trustAll(h)
    const srv = await server({ tmux: true })
    const relay = await startDropProxy(srv.port)
    cleanups.push(relay.close)
    const host = await saveHost(h, {
      name: 'sticky',
      port: relay.port,
      stickySession: true,
      startupCommand: 'htop',
    })
    expect(host.stickySession).toBe(true)
    const id = await open(h, host.id)
    expect(await settled(h, id)).toMatchObject({ state: 'ready', sticky: 'started' })
    const name = `kelidar-${host.id.replaceAll('-', '').slice(0, 8)}`
    expect(srv.tmuxAttaches).toEqual([name])
    await waitFor(() => srv.received.join('').includes('htop\r'), { label: 'startup' })

    relay.drop()
    await settled(h, id, ['reconnecting'])
    relay.restore()
    await waitFor(
      () => h.sink.states(id).find((s) => s.state === 'ready' && s.sticky === 'resumed'),
      { label: 'resumed' },
    )
    stop()
    expect(srv.tmuxAttaches).toEqual([name, name])
    // A resumed session already runs the startup command: it is not typed again.
    expect(srv.received.join('').split('htop\r')).toHaveLength(2)
  })

  it('opens a normal shell and says so when tmux is missing', async () => {
    const h = await setup()
    const stop = trustAll(h)
    const srv = await server({ tmux: false })
    const host = await saveHost(h, { name: 'plain', port: srv.port, stickySession: true })
    expect(await settled(h, await open(h, host.id))).toMatchObject({
      state: 'ready',
      sticky: 'unavailable',
    })
    stop()
    expect(srv.openShells()).toBe(1)
  })

  it('stops reconnecting when the tab closes, and reconnects at once on request', async () => {
    const h = await setup({
      timing: {
        keepaliveIntervalMs: 100,
        keepaliveCountMax: 2,
        readyTimeoutMs: 400,
        reconnectDelaysMs: [60_000],
      },
    })
    const stop = trustAll(h)
    const srv = await server()
    const relay = await startDropProxy(srv.port)
    cleanups.push(relay.close)
    const host = await saveHost(h, { name: 'box', port: relay.port })
    const id = await open(h, host.id)
    await settled(h, id)
    relay.drop()
    await settled(h, id, ['reconnecting'])
    relay.restore()
    // The next try is a minute away; "Reconnect now" does not wait.
    await h.call('session:reconnectNow', { sessionId: id })
    await waitFor(() => h.sink.states(id).filter((s) => s.state === 'ready').length === 2, {
      label: 'ready again',
    })
    relay.drop()
    await waitFor(() => h.sink.states(id).filter((s) => s.state === 'reconnecting').length === 2, {
      label: 'second drop',
    })
    const made = relay.connections()
    await h.call('session:close', { sessionId: id })
    stop()
    relay.restore()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(relay.connections()).toBe(made)
  })
})
