import { afterEach, describe, expect, it } from 'vitest'
import type { HostView } from '../../src/shared/hosts'
import type { KeyView } from '../../src/shared/keychain'
import type { SessionOpenResponse } from '../../src/shared/session'
import { createHarness, waitFor, type Harness } from './helpers/harness'
import { startTestServer, type TestServer, type TestServerOptions } from './helpers/ssh-server'

const PASSWORD = 'pw-Sudo-Badger-2290-secret'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function setup(): Promise<Harness> {
  const harness = await createHarness()
  cleanups.push(harness.close)
  return harness
}

async function server(options: TestServerOptions = {}): Promise<TestServer> {
  const started = await startTestServer({ password: PASSWORD, ...options })
  cleanups.push(started.close)
  return started
}

async function connect(h: Harness, fields: Record<string, unknown>): Promise<string> {
  const host = await h.call<HostView>('hosts:save', {
    name: 'box',
    address: '127.0.0.1',
    username: 'tester',
    ...fields,
  })
  const { sessionId } = await h.call<SessionOpenResponse>('session:open', {
    hostId: host.id,
    cols: 80,
    rows: 24,
  })
  const prompt = await waitFor(() => h.sink.prompts().find((p) => p.kind === 'hostKey'), {
    label: 'host key',
  })
  await h.call('prompt:answer', {
    promptId: prompt.promptId,
    answer: { kind: 'hostKey', trust: true },
  })
  await waitFor(() => h.sink.states(sessionId).find((s) => s.state === 'ready'), {
    label: 'ready',
  })
  return sessionId
}

function sudoEvents(h: Harness, sessionId: string) {
  return h.sink.events.flatMap((e) =>
    e.event === 'session:sudo' && e.payload.sessionId === sessionId ? [e.payload] : [],
  )
}

describe('sudo password fill', () => {
  it('types the saved password only after the hotkey, and never shows it', async () => {
    const h = await setup()
    const srv = await server()
    const id = await connect(h, {
      port: srv.port,
      auth: { type: 'password', password: PASSWORD },
    })

    // No prompt yet: nothing is typed.
    await expect(h.invoke('session:fillSudo', { sessionId: id })).resolves.toEqual({
      ok: false,
      error: { code: 'SUDO_NO_PROMPT' },
    })

    await h.call('session:input', { sessionId: id, data: 'sudo whoami\r' })
    await waitFor(() => sudoEvents(h, id).at(-1)?.prompt === true, { label: 'sudo prompt' })
    expect(sudoEvents(h, id).at(-1)).toEqual({ sessionId: id, prompt: true, canFill: true })
    // Seen, but not typed until the user asks.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(srv.sudoAnswers).toEqual([])

    await h.call('session:fillSudo', { sessionId: id })
    await waitFor(() => srv.sudoAnswers.length === 1, { label: 'sudo answer' })
    expect(srv.sudoAnswers).toEqual([{ password: PASSWORD, right: true }])
    await waitFor(() => h.sink.output(id).includes('root'), { label: 'sudo output' })
    expect(sudoEvents(h, id).at(-1)?.prompt).toBe(false)

    // The password went to the server, never to the renderer or the logs.
    expect(h.sink.output(id)).not.toContain(PASSWORD)
    expect(JSON.stringify(h.responses)).not.toContain(PASSWORD)
    expect(h.logs.join('\n')).not.toContain(PASSWORD)
  })

  it('cannot fill when the host signs in with a key', async () => {
    const h = await setup()
    const key = await h.call<KeyView>('keys:generate', { name: 'k', type: 'ed25519' })
    const srv = await server({ authorizedKey: key.publicKey })
    const id = await connect(h, { port: srv.port, auth: { type: 'savedKey', keyId: key.id } })
    await h.call('session:input', { sessionId: id, data: 'sudo whoami\r' })
    await waitFor(() => sudoEvents(h, id).at(-1)?.prompt === true, { label: 'sudo prompt' })
    expect(sudoEvents(h, id).at(-1)?.canFill).toBe(false)
    await expect(h.invoke('session:fillSudo', { sessionId: id })).resolves.toEqual({
      ok: false,
      error: { code: 'SUDO_NO_PASSWORD' },
    })
    expect(srv.sudoAnswers).toEqual([])
  })
})
