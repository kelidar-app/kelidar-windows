import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostView } from '../../src/shared/hosts'
import type { SessionOpenResponse, SessionState } from '../../src/shared/session'
import { createHarness, FakeSink, waitFor, type Harness } from './helpers/harness'
import { startDropProxy, startTestServer, type TestServer } from './helpers/ssh-server'
import { readableKeyPair } from '../unit/helpers/keys'

const PASSWORD = 'pw-Zebra-7781-secret'
const PASSPHRASE = 'phrase-Otter-4412-secret'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function setup(options: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
  const harness = await createHarness(options)
  cleanups.push(harness.close)
  return harness
}

async function server(options: Parameters<typeof startTestServer>[0] = {}): Promise<TestServer> {
  const started = await startTestServer({ password: PASSWORD, ...options })
  cleanups.push(started.close)
  return started
}

function saveHost(h: Harness, port: number, auth: unknown, username = 'tester'): Promise<HostView> {
  return h.call<HostView>('hosts:save', {
    name: 'test',
    address: '127.0.0.1',
    port,
    username,
    auth,
  })
}

async function open(h: Harness, hostId: string): Promise<string> {
  const { sessionId } = await h.call<SessionOpenResponse>('session:open', {
    hostId,
    cols: 100,
    rows: 30,
  })
  return sessionId
}

/** Prompt ids already answered, across tests (ids are random). */
const answeredIds = new Set<string>()

async function answerNextPrompt(h: Harness, kind: string, answer: unknown): Promise<void> {
  const prompt = await waitFor(
    () => h.sink.prompts().find((p) => p.kind === kind && !answeredIds.has(p.promptId)),
    { label: `${kind} prompt` },
  )
  answeredIds.add(prompt.promptId)
  await h.call('prompt:answer', { promptId: prompt.promptId, answer })
}

const trustHostKey = (h: Harness) =>
  answerNextPrompt(h, 'hostKey', { kind: 'hostKey', trust: true })

function waitForState(h: Harness, sessionId: string, state: SessionState) {
  return waitFor(() => h.sink.states(sessionId).find((s) => s.state === state), {
    label: `state ${state}`,
  })
}

function waitForFinal(h: Harness, sessionId: string) {
  return waitFor(
    () => h.sink.states(sessionId).find((s) => s.state === 'closed' || s.state === 'error'),
    { label: 'final state' },
  )
}

describe('sessions against an in-process ssh2 server', () => {
  it('signs in with a password, runs a shell and goes through every state', async () => {
    const h = await setup()
    const srv = await server()
    const host = await saveHost(h, srv.port, { type: 'password', password: PASSWORD })
    const id = await open(h, host.id)

    await trustHostKey(h)
    await waitForState(h, id, 'ready')
    await waitFor(() => h.sink.output(id).includes('welcome'), { label: 'banner' })

    await h.call('session:input', { sessionId: id, data: 'hello there\r' })
    await waitFor(() => h.sink.output(id).includes('hello there'), { label: 'echo' })

    expect(h.sink.states(id).map((s) => s.state)).toEqual([
      'connecting',
      'verifying-host-key',
      'authenticating',
      'ready',
    ])
    expect(srv.ptys[0]).toMatchObject({ term: 'xterm-256color', cols: 100, rows: 30 })

    await h.call('session:input', { sessionId: id, data: 'exit\r' })
    const final = await waitForFinal(h, id)
    expect(final).toEqual({ sessionId: id, state: 'closed' })
  })

  it('signs in with an ed25519 key protected by a passphrase', async () => {
    const pair = readableKeyPair('ed25519', {
      passphrase: PASSPHRASE,
      cipher: 'aes256-ctr',
      rounds: 16,
    })
    let keyPath = ''
    const h = await setup({ keyFile: () => keyPath })
    keyPath = path.join(h.dir, 'id_ed25519')
    await writeFile(keyPath, pair.private)
    const srv = await server({ authorizedKey: pair.public, password: undefined })

    const picked = await h.call<{ token: string; encrypted: boolean }>('hosts:pickKeyFile')
    expect(picked.encrypted).toBe(true)
    const host = await saveHost(h, srv.port, {
      type: 'key',
      keyFileToken: picked.token,
      passphrase: PASSPHRASE,
    })
    const id = await open(h, host.id)
    await trustHostKey(h)
    await waitForState(h, id, 'ready')
    expect(srv.authAttempts.some((a) => a.method === 'publickey')).toBe(true)
    expect(h.sink.prompts().filter((p) => p.kind === 'password')).toEqual([])
  })

  it('reports a wrong password as SSH_AUTH_FAILED without asking again', async () => {
    const h = await setup()
    const srv = await server()
    const host = await saveHost(h, srv.port, { type: 'password', password: 'not it' })
    const id = await open(h, host.id)
    await trustHostKey(h)
    const final = await waitForFinal(h, id)
    expect(final).toMatchObject({ state: 'error', error: 'SSH_AUTH_FAILED' })
    expect(h.sink.prompts().filter((p) => p.kind === 'password')).toEqual([])
  })

  it('asks for the password each time, with three tries', async () => {
    const h = await setup()
    const srv = await server()
    const host = await saveHost(h, srv.port, { type: 'password' })
    const id = await open(h, host.id)
    await trustHostKey(h)
    await answerNextPrompt(h, 'password', { kind: 'password', value: 'wrong once' })
    await answerNextPrompt(h, 'password', { kind: 'password', value: PASSWORD })
    await waitForState(h, id, 'ready')
    const attempts = h.sink.prompts().flatMap((p) => (p.kind === 'password' ? [p.attempt] : []))
    expect(attempts).toEqual([0, 1])
  })

  it('answers a keyboard-interactive password question with the saved password', async () => {
    const h = await setup()
    const srv = await server({ keyboardOnly: true })
    const host = await saveHost(h, srv.port, { type: 'password', password: PASSWORD })
    const id = await open(h, host.id)
    await trustHostKey(h)
    await waitForState(h, id, 'ready')
    expect(h.sink.prompts().map((p) => p.kind)).toEqual(['hostKey'])
  })

  it('closes quietly when the user cancels the password dialog', async () => {
    const h = await setup()
    const srv = await server()
    const host = await saveHost(h, srv.port, { type: 'password' })
    const id = await open(h, host.id)
    await trustHostKey(h)
    await answerNextPrompt(h, 'password', { kind: 'password', value: null })
    expect(await waitForFinal(h, id)).toEqual({ sessionId: id, state: 'closed' })
  })

  it('remembers a trusted host key and does not ask again', async () => {
    const h = await setup()
    const srv = await server()
    const host = await saveHost(h, srv.port, { type: 'password', password: PASSWORD })
    const first = await open(h, host.id)
    await trustHostKey(h)
    await waitForState(h, first, 'ready')
    const second = await open(h, host.id)
    await waitForState(h, second, 'ready')
    expect(h.sink.prompts().filter((p) => p.kind === 'hostKey')).toHaveLength(1)
    const prompt = h.sink.prompts()[0]
    expect(prompt).toMatchObject({ kind: 'hostKey', host: '127.0.0.1', keyType: 'ssh-ed25519' })
    expect(prompt?.kind === 'hostKey' ? prompt.fingerprint : '').toMatch(/^SHA256:[\w+/]{43}$/)
  })

  it('refuses to connect when the trusted key changed, without signing in', async () => {
    const h = await setup()
    const first = await server()
    const host = await saveHost(h, first.port, { type: 'password', password: PASSWORD })
    const id1 = await open(h, host.id)
    await trustHostKey(h)
    await waitForState(h, id1, 'ready')
    await h.call('session:close', { sessionId: id1 })
    await first.close()

    // Same address and port, new server key.
    const second = await server({ port: first.port })
    const id2 = await open(h, host.id)
    const final = await waitForFinal(h, id2)
    expect(final).toMatchObject({ state: 'error', error: 'SSH_HOST_KEY_CHANGED' })
    expect(final.hostKey).toMatchObject({ host: '127.0.0.1', port: first.port })
    expect(second.authAttempts).toEqual([])
    expect(h.sink.prompts().filter((p) => p.kind === 'hostKey')).toHaveLength(1)

    // Removing the old key on purpose lets the user trust the new one.
    await h.call('knownHosts:forget', { host: '127.0.0.1', port: first.port })
    const id3 = await open(h, host.id)
    await trustHostKey(h)
    await waitForState(h, id3, 'ready')
  })

  it('reports a rejected host key', async () => {
    const h = await setup()
    const srv = await server()
    const host = await saveHost(h, srv.port, { type: 'password', password: PASSWORD })
    const id = await open(h, host.id)
    await answerNextPrompt(h, 'hostKey', { kind: 'hostKey', trust: false })
    expect(await waitForFinal(h, id)).toMatchObject({
      state: 'error',
      error: 'SSH_HOST_KEY_REJECTED',
    })
    expect(srv.authAttempts).toEqual([])
  })

  it('passes resizes to the server', async () => {
    const h = await setup()
    const srv = await server()
    const host = await saveHost(h, srv.port, { type: 'password', password: PASSWORD })
    const id = await open(h, host.id)
    await trustHostKey(h)
    await waitForState(h, id, 'ready')
    await h.call('session:resize', { sessionId: id, cols: 132, rows: 43 })
    await waitFor(() => srv.resizes.some((r) => r.cols === 132 && r.rows === 43), {
      label: 'window-change',
    })
  })

  it('batches large output and pauses reading until the renderer catches up', async () => {
    const total = 3 * 1024 * 1024
    const h = await setup({ timing: { highWaterBytes: 256 * 1024, lowWaterBytes: 64 * 1024 } })
    const srv = await server({ bigOutputBytes: total })
    const host = await saveHost(h, srv.port, { type: 'password', password: PASSWORD })
    const id = await open(h, host.id)
    await trustHostKey(h)
    await waitForState(h, id, 'ready')

    const received = () =>
      h.sink.events.reduce(
        (sum, e) =>
          e.event === 'session:data' && e.payload.sessionId === id
            ? sum + e.payload.data.length
            : sum,
        0,
      )
    const batches = () => h.sink.events.filter((e) => e.event === 'session:data').length
    const before = received()
    await h.call('session:input', { sessionId: id, data: 'big\r' })

    // Without acknowledgements, main stops near the high-water mark.
    await waitFor(() => received() - before > 200 * 1024, { label: 'first output' })
    await new Promise((resolve) => setTimeout(resolve, 300))
    const stalled = received()
    expect(stalled - before).toBeLessThan(total / 2)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(received()).toBe(stalled)

    // The renderer acknowledges what it rendered; the rest arrives.
    let acked = 0
    await waitFor(
      () => {
        const now = received()
        if (now > acked) {
          void h.call('session:ack', { sessionId: id, bytes: now - acked })
          acked = now
        }
        return h.sink.output(id).includes('BIG-DONE')
      },
      { label: 'all output', timeout: 20_000 },
    )
    expect(received() - before).toBeGreaterThanOrEqual(total)
    // Far fewer messages than the server's 16 KB writes.
    expect(batches()).toBeLessThan(total / (16 * 1024))
  })

  it('shows a dropped network on the tab and reconnects by itself when it returns', async () => {
    const h = await setup({
      timing: {
        keepaliveIntervalMs: 100,
        keepaliveCountMax: 2,
        readyTimeoutMs: 400,
        reconnectDelaysMs: [50, 100, 200],
      },
    })
    const srv = await server()
    const proxy = await startDropProxy(srv.port)
    cleanups.push(proxy.close)
    const host = await saveHost(h, proxy.port, { type: 'password', password: PASSWORD })
    const id = await open(h, host.id)
    await trustHostKey(h)
    await waitForState(h, id, 'ready')

    proxy.drop()
    const reconnecting = await waitForState(h, id, 'reconnecting')
    expect(reconnecting.reconnect?.attempt).toBe(1)
    expect(reconnecting.reconnect?.retryAt).toBeGreaterThan(0)
    // Attempts keep failing while the network is down, each one counted.
    await waitFor(() => h.sink.states(id).filter((s) => s.state === 'reconnecting').length >= 3, {
      label: 'several attempts',
    })
    proxy.restore()
    await waitFor(() => h.sink.states(id).filter((s) => s.state === 'ready').length === 2, {
      label: 'ready again',
    })
    // Same tab, new connection, no password question.
    expect(h.sink.prompts().filter((p) => p.kind === 'password')).toEqual([])
    await h.call('session:input', { sessionId: id, data: 'after the drop\r' })
    await waitFor(() => h.sink.output(id).includes('after the drop'), { label: 'echo' })
  })

  it('maps a closed port to SSH_CONNECTION_REFUSED', async () => {
    const h = await setup()
    const srv = await server()
    const port = srv.port
    await srv.close()
    const host = await saveHost(h, port, { type: 'password', password: PASSWORD })
    const id = await open(h, host.id)
    expect(await waitForFinal(h, id)).toMatchObject({
      state: 'error',
      error: 'SSH_CONNECTION_REFUSED',
    })
  })

  it('keeps sessions private to the window that opened them', async () => {
    const h = await setup()
    const srv = await server()
    const host = await saveHost(h, srv.port, { type: 'password', password: PASSWORD })
    const id = await open(h, host.id)
    await trustHostKey(h)
    await waitForState(h, id, 'ready')
    const other = new FakeSink(2)
    const notFound = { ok: false, error: { code: 'SESSION_NOT_FOUND' } }
    expect(await h.invoke('session:input', { sessionId: id, data: 'x' }, other)).toEqual(notFound)
    expect(await h.invoke('session:resize', { sessionId: id, cols: 80, rows: 24 }, other)).toEqual(
      notFound,
    )
    // Closing someone else's session is a no-op.
    await h.invoke('session:close', { sessionId: id }, other)
    expect(h.sink.states(id).at(-1)?.state).toBe('ready')
  })

  it('never lets a secret reach the renderer, the logs or the disk in plain text', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method),
    )
    const pair = readableKeyPair('ed25519', {
      passphrase: PASSPHRASE,
      cipher: 'aes256-ctr',
      rounds: 16,
    })
    let keyPath = ''
    const h = await setup({ keyFile: () => keyPath })
    keyPath = path.join(h.dir, 'id_test')
    await writeFile(keyPath, pair.private)
    const srv = await server({ authorizedKey: pair.public })

    const passwordHost = await saveHost(h, srv.port, { type: 'password', password: PASSWORD })
    const picked = await h.call<{ token: string }>('hosts:pickKeyFile')
    const keyHost = await saveHost(h, srv.port, {
      type: 'key',
      keyFileToken: picked.token,
      passphrase: PASSPHRASE,
    })
    const askHost = await saveHost(h, srv.port, { type: 'password' })
    await h.call('hosts:list')

    const a = await open(h, passwordHost.id)
    await trustHostKey(h)
    await waitForState(h, a, 'ready')
    const b = await open(h, keyHost.id)
    await waitForState(h, b, 'ready')
    const c = await open(h, askHost.id)
    await answerNextPrompt(h, 'password', { kind: 'password', value: PASSWORD })
    await waitForState(h, c, 'ready')
    // A failing sign-in too: errors must not carry the secret either.
    const bad = await saveHost(h, srv.port, { type: 'password', password: `${PASSWORD}-wrong` })
    const d = await open(h, bad.id)
    await waitForFinal(h, d)
    await h.call('hosts:list')
    await h.vaults.flush()

    const privateKeyBody = pair.private.split('\n')[1] ?? ''
    expect(privateKeyBody.length).toBeGreaterThan(20)
    const secrets = [PASSWORD, PASSPHRASE, privateKeyBody]

    // Everything the renderer received: responses and events (output decoded).
    const toRenderer =
      JSON.stringify(h.responses) +
      JSON.stringify(
        h.sink.events.map((e) =>
          e.event === 'session:data' ? Buffer.from(e.payload.data).toString('latin1') : e.payload,
        ),
      )
    // Everything logged.
    const logged =
      h.logs.join('\n') +
      consoleSpies
        .flatMap((spy) => spy.mock.calls.map((args) => args.map(String).join(' ')))
        .join('\n')
    // Everything written in the data folder (the key file itself excluded).
    const files = await readdir(h.dir, { recursive: true, withFileTypes: true })
    let onDisk = ''
    for (const file of files) {
      if (!file.isFile() || file.name === 'id_test') continue
      onDisk += await readFile(path.join(file.parentPath, file.name), 'latin1')
    }
    expect(onDisk).toContain('aes-256-gcm')

    for (const secret of secrets) {
      expect(toRenderer).not.toContain(secret)
      expect(logged).not.toContain(secret)
      expect(onDisk).not.toContain(secret)
      expect(onDisk).not.toContain(Buffer.from(secret).toString('base64'))
    }
    for (const spy of consoleSpies) spy.mockRestore()
  })
})
