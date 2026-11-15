import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { utils } from 'ssh2'
import { afterEach, describe, expect, it } from 'vitest'
import type { HostView } from '../../src/shared/hosts'
import type { SessionOpenResponse } from '../../src/shared/session'
import { createHarness, FakeSink, waitFor, type Harness } from './helpers/harness'
import { startTestServer } from './helpers/ssh-server'

const PASSWORD = 'quick-Pw-90210'
const PASSPHRASE = 'quick-Phrase-31337'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function setup(): Promise<Harness> {
  const harness = await createHarness()
  cleanups.push(harness.close)
  return harness
}

const answered = new Set<string>()
async function answer(h: Harness, kind: string, value: unknown): Promise<void> {
  const prompt = await waitFor(
    () => h.sink.prompts().find((p) => p.kind === kind && !answered.has(p.promptId)),
    { label: `${kind} prompt` },
  )
  answered.add(prompt.promptId)
  await h.call('prompt:answer', { promptId: prompt.promptId, answer: value })
}

function ready(h: Harness, sessionId: string) {
  return waitFor(() => h.sink.states(sessionId).find((s) => s.state === 'ready'), {
    label: 'ready',
  })
}

describe('Quick Connect', () => {
  it('connects without saving, asks for the password, then saves the host on request', async () => {
    const h = await setup()
    const server = await startTestServer({ password: PASSWORD })
    cleanups.push(server.close)

    const opened = await h.call<SessionOpenResponse>('session:open', {
      quick: `ssh tester@127.0.0.1 -p ${String(server.port)}`,
      cols: 80,
      rows: 24,
    })
    expect(opened.title).toBe(`tester@127.0.0.1:${String(server.port)}`)
    expect(opened.hostId).toBeUndefined()
    await answer(h, 'hostKey', { kind: 'hostKey', trust: true })
    await answer(h, 'password', { kind: 'password', value: PASSWORD })
    await ready(h, opened.sessionId)
    expect(await h.call<HostView[]>('hosts:list')).toEqual([])

    // "Save host" with the sign-in that worked.
    const saved = await h.call<HostView>('hosts:save', {
      name: 'from quick',
      address: '127.0.0.1',
      port: server.port,
      username: 'tester',
      auth: { type: 'fromSession', sessionId: opened.sessionId },
    })
    expect(saved.signIn).toEqual({ method: 'password' })

    // The saved host connects without asking.
    const again = await h.call<SessionOpenResponse>('session:open', {
      hostId: saved.id,
      cols: 80,
      rows: 24,
    })
    await ready(h, again.sessionId)
    expect(h.sink.prompts().filter((p) => p.kind === 'password')).toHaveLength(1)
  })

  it('asks for the passphrase of an encrypted -i key and saves the key', async () => {
    const h = await setup()
    const pair = utils.generateKeyPairSync('ed25519', {
      passphrase: PASSPHRASE,
      cipher: 'aes256-ctr',
      rounds: 16,
    })
    await mkdir(path.join(h.dir, '.ssh'))
    await writeFile(path.join(h.dir, '.ssh', 'id_quick'), pair.private)
    const server = await startTestServer({ authorizedKey: pair.public })
    cleanups.push(server.close)

    const opened = await h.call<SessionOpenResponse>('session:open', {
      quick: `ssh -i ~/.ssh/id_quick -p ${String(server.port)} tester@127.0.0.1`,
      cols: 80,
      rows: 24,
    })
    await answer(h, 'passphrase', { kind: 'passphrase', value: 'nope' })
    await answer(h, 'passphrase', { kind: 'passphrase', value: PASSPHRASE })
    await answer(h, 'hostKey', { kind: 'hostKey', trust: true })
    await ready(h, opened.sessionId)
    const attempts = h.sink
      .prompts()
      .flatMap((p) => (p.kind === 'passphrase' ? [[p.keyName, p.attempt]] : []))
    expect(attempts).toEqual([
      ['id_quick', 0],
      ['id_quick', 1],
    ])

    const saved = await h.call<HostView>('hosts:save', {
      name: 'key host',
      address: '127.0.0.1',
      port: server.port,
      username: 'tester',
      auth: { type: 'fromSession', sessionId: opened.sessionId },
    })
    expect(saved.signIn).toMatchObject({ method: 'key', keyName: 'id_quick', hasPassphrase: true })
  })

  it('refuses text it cannot read and key files that are missing', async () => {
    const h = await setup()
    expect(await h.invoke('session:open', { quick: 'just-a-host', cols: 80, rows: 24 })).toEqual({
      ok: false,
      error: { code: 'QUICK_CONNECT_INVALID' },
    })
    expect(
      await h.invoke('session:open', { quick: 'ssh -i missing root@h', cols: 80, rows: 24 }),
    ).toEqual({ ok: false, error: { code: 'KEY_FILE_UNREADABLE' } })
  })

  it('does not let another window save the sign-in of a session', async () => {
    const h = await setup()
    const server = await startTestServer({ password: PASSWORD })
    cleanups.push(server.close)
    const opened = await h.call<SessionOpenResponse>('session:open', {
      quick: `tester@127.0.0.1:${String(server.port)}`,
      cols: 80,
      rows: 24,
    })
    await answer(h, 'hostKey', { kind: 'hostKey', trust: true })
    await answer(h, 'password', { kind: 'password', value: PASSWORD })
    await ready(h, opened.sessionId)
    const result = await h.invoke(
      'hosts:save',
      {
        name: 'x',
        address: '127.0.0.1',
        username: 'tester',
        auth: { type: 'fromSession', sessionId: opened.sessionId },
      },
      new FakeSink(2),
    )
    expect(result).toEqual({ ok: false, error: { code: 'SESSION_NOT_FOUND' } })
  })
})
