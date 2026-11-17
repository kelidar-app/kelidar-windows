import { afterEach, describe, expect, it } from 'vitest'
import type { HostView } from '../../src/shared/hosts'
import type { ImportScan } from '../../src/shared/importers'
import type { SessionOpenResponse } from '../../src/shared/session'
import { readableKeyPair } from '../unit/helpers/keys'
import { createHarness, waitFor, type Harness } from './helpers/harness'
import { startTestServer, type TestServer, type TestServerOptions } from './helpers/ssh-server'

/**
 * Step 2.6 (Getting data in), through the real IPC handlers: the system
 * badge after the first connection, importing hosts, and notes and links.
 */

const PASSWORD = 'pw-Data-Ibis-3381-secret'
const UBUNTU = 'NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n'

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

/** Opens a session (trusting the server key), waits until it is ready, and closes it. */
async function connectOnce(h: Harness, hostId: string): Promise<void> {
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
  try {
    const { sessionId } = await h.call<SessionOpenResponse>('session:open', {
      hostId,
      cols: 80,
      rows: 24,
    })
    await waitFor(() => h.sink.states(sessionId).find((s) => s.state === 'ready'), {
      label: 'ready',
    })
    await h.call('session:close', { sessionId })
  } finally {
    clearInterval(timer)
  }
}

describe('system badge', () => {
  it('reads /etc/os-release once, after the first connection, off the terminal', async () => {
    const h = await setup({ osProbe: true })
    const srv = await server({ osRelease: UBUNTU })
    const host = await h.call<HostView>('hosts:save', {
      name: 'box',
      address: '127.0.0.1',
      port: srv.port,
      username: 'tester',
      auth: { type: 'password', password: PASSWORD },
    })
    expect(host.os).toBeUndefined()
    await connectOnce(h, host.id)
    const event = await waitFor(() => h.sink.events.find((e) => e.event === 'host:os'), {
      label: 'host:os',
    })
    expect(event.payload).toEqual({
      hostId: host.id,
      os: { id: 'ubuntu', name: 'Ubuntu 24.04.1 LTS' },
    })
    const [saved] = await h.call<HostView[]>('hosts:list')
    expect(saved?.os).toEqual({ id: 'ubuntu', name: 'Ubuntu 24.04.1 LTS' })
    // Not typed into the shell.
    expect(srv.received.join('')).not.toContain('os-release')

    await connectOnce(h, host.id)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(srv.execs.filter((command) => command === 'cat /etc/os-release')).toHaveLength(1)
  })

  it('leaves the host as it is when the server has no os-release', async () => {
    const h = await setup({ osProbe: true })
    const srv = await server()
    const host = await h.call<HostView>('hosts:save', {
      name: 'bsd',
      address: '127.0.0.1',
      port: srv.port,
      username: 'tester',
      auth: { type: 'password', password: PASSWORD },
    })
    await connectOnce(h, host.id)
    await waitFor(() => srv.execs.includes('cat /etc/os-release'), { label: 'probe' })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const [saved] = await h.call<HostView[]>('hosts:list')
    expect(saved?.os).toBeUndefined()
  })

  it('runs nothing when detection is off', async () => {
    const h = await setup()
    const srv = await server({ osRelease: UBUNTU })
    const host = await h.call<HostView>('hosts:save', {
      name: 'quiet',
      address: '127.0.0.1',
      port: srv.port,
      username: 'tester',
      auth: { type: 'password', password: PASSWORD },
    })
    await connectOnce(h, host.id)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(srv.execs).toEqual([])
  })
})

describe('import hosts', () => {
  it('imports from ssh config and connects with the imported key', async () => {
    const key = readableKeyPair('ed25519')
    const srv = await server({ authorizedKey: key.public })
    const h = await setup({
      importSources: {
        readSshConfig: () =>
          Promise.resolve(
            `Host lab\n  HostName 127.0.0.1\n  Port ${String(srv.port)}\n  User tester\n  IdentityFile ~/.ssh/lab_key\n`,
          ),
        readKeyFile: (file) =>
          file.endsWith('lab_key')
            ? Promise.resolve(key.private)
            : Promise.reject(new Error('missing')),
      },
    })
    const scan = await h.call<ImportScan>('import:scan')
    expect(scan.candidates).toMatchObject([
      { name: 'lab', address: '127.0.0.1', port: srv.port, signIn: 'key', keyName: 'lab_key' },
    ])
    await expect(h.invoke('import:apply', { token: 'not-a-token', ids: ['c0'] })).resolves.toEqual({
      ok: false,
      error: { code: 'IPC_INVALID_PAYLOAD' },
    })
    await expect(
      h.call('import:apply', { token: scan.token, ids: scan.candidates.map((row) => row.id) }),
    ).resolves.toEqual({ hosts: 1, keys: 1 })

    const [lab] = await h.call<HostView[]>('hosts:list')
    if (lab === undefined) throw new Error('not imported')
    expect(lab).toMatchObject({ name: 'lab', tags: ['ssh-config'], signIn: { method: 'key' } })
    await connectOnce(h, lab.id)
    expect(srv.authAttempts.some((attempt) => attempt.method === 'publickey')).toBe(true)
    expect(JSON.stringify(h.responses)).not.toContain('PRIVATE KEY')
  })
})

describe('notes and links', () => {
  it('saves them with the host and refuses links that are not web pages', async () => {
    const h = await setup()
    const host = await h.call<HostView>('hosts:save', {
      name: 'panel',
      address: 'panel.example.test',
      username: 'root',
      auth: { type: 'agent' },
      notes: 'Backups run at 02:00.',
      links: [{ title: 'Panel', url: 'https://panel.example.test:2083' }],
    })
    expect(host).toMatchObject({
      notes: 'Backups run at 02:00.',
      links: [{ title: 'Panel', url: 'https://panel.example.test:2083' }],
    })
    await expect(
      h.invoke('hosts:save', {
        name: 'bad',
        address: 'bad.example.test',
        username: 'root',
        auth: { type: 'agent' },
        links: [{ url: 'file:///C:/Windows/System32/calc.exe' }],
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'IPC_INVALID_PAYLOAD' } })
  })
})
