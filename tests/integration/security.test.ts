import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HostView } from '../../src/shared/hosts'
import type { ImportSummary, VaultStatus } from '../../src/shared/security'
import type { SessionOpenResponse, SessionState } from '../../src/shared/session'
import { createHarness, waitFor, type Harness } from './helpers/harness'
import {
  startDropProxy,
  startTestServer,
  type TestServer,
  type TestServerOptions,
} from './helpers/ssh-server'

/**
 * Step 2.5 (Security), through the real IPC handlers: the master password
 * and the lock, copying a saved password, export and import. Done when a
 * locked vault shows nothing sensitive.
 */

const PASSWORD = 'pw-Lock-Heron-4471-secret'
const MASTER = 'master-Otter-Quilt-93'

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

function saveHost(h: Harness, fields: Record<string, unknown> = {}): Promise<HostView> {
  return h.call<HostView>('hosts:save', {
    name: 'Payments DB',
    address: '127.0.0.1',
    username: 'tester',
    auth: { type: 'password', password: PASSWORD },
    ...fields,
  })
}

function settled(h: Harness, sessionId: string, wanted: SessionState[]) {
  return waitFor(() => h.sink.states(sessionId).find((s) => wanted.includes(s.state)), {
    label: `state ${wanted.join('/')}`,
  })
}

const vaultStates = (h: Harness): VaultStatus[] =>
  h.sink.events.flatMap((e) => (e.event === 'vault:state' ? [e.payload] : []))

describe('master password and lock', () => {
  it('locks, hides every record, and unlocks only with the master password', async () => {
    const h = await setup()
    await saveHost(h)
    await expect(h.call('vault:status')).resolves.toEqual({
      state: 'unlocked',
      masterPassword: false,
    })
    // Without a master password there is nothing to lock with.
    await expect(h.call('vault:lock')).resolves.toMatchObject({ state: 'unlocked' })

    await expect(h.invoke('vault:setMasterPassword', { next: 'short' })).resolves.toEqual({
      ok: false,
      error: { code: 'IPC_INVALID_PAYLOAD' },
    })
    await h.call('vault:setMasterPassword', { next: MASTER })
    await expect(h.call('vault:lock')).resolves.toEqual({ state: 'locked', masterPassword: true })
    expect(vaultStates(h).at(-1)).toEqual({ state: 'locked', masterPassword: true })

    // Locked: nothing comes out.
    for (const channel of ['hosts:list', 'groups:list', 'keys:list', 'identities:list']) {
      await expect(h.invoke(channel)).resolves.toEqual({
        ok: false,
        error: { code: 'VAULT_LOCKED' },
      })
    }
    await expect(h.invoke('vault:backups')).resolves.toEqual({
      ok: false,
      error: { code: 'VAULT_LOCKED' },
    })

    await expect(h.invoke('vault:unlock', { password: 'guess' })).resolves.toEqual({
      ok: false,
      error: { code: 'VAULT_PASSWORD_WRONG' },
    })
    await h.call('vault:unlock', { password: MASTER })
    const hosts = await h.call<HostView[]>('hosts:list')
    expect(hosts.map((host) => host.name)).toEqual(['Payments DB'])

    // On disk: no Windows-wrapped key, no plaintext, in the vault or its backups.
    const text = await readFile(path.join(h.dir, 'vault.json'), 'utf8')
    expect(text).toContain('"type": "password"')
    expect(text).not.toContain('Payments DB')
    expect(JSON.stringify(h.responses)).not.toContain(MASTER)
    expect(h.logs.join('\n')).not.toContain(MASTER)
  })

  it('keeps sessions connected while locked, and reconnects with the vault after unlocking', async () => {
    const h = await setup({
      timing: {
        keepaliveIntervalMs: 100,
        keepaliveCountMax: 2,
        readyTimeoutMs: 400,
        reconnectDelaysMs: [50, 100],
      },
    })
    const stop = trustAll(h)
    const srv = await server()
    const relay = await startDropProxy(srv.port)
    cleanups.push(relay.close)
    const host = await saveHost(h, { port: relay.port })
    await h.call('vault:setMasterPassword', { next: MASTER })
    const { sessionId } = await h.call<SessionOpenResponse>('session:open', {
      hostId: host.id,
      cols: 80,
      rows: 24,
    })
    await settled(h, sessionId, ['ready'])
    const logins = srv.authAttempts.length

    await h.call('vault:lock')
    // Still connected and usable while locked.
    await h.call('session:input', { sessionId, data: 'echo still here\r' })
    await waitFor(() => srv.received.join('').includes('echo still here'), { label: 'input' })

    // The network drops while locked: no password in memory, so it waits.
    relay.drop()
    await settled(h, sessionId, ['reconnecting'])
    relay.restore()
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(h.sink.states(sessionId).at(-1)?.state).toBe('reconnecting')
    expect(srv.authAttempts.length).toBe(logins)
    expect(h.sink.prompts().filter((p) => p.kind === 'password')).toEqual([])

    // Unlocked: the password is read from the vault again and it reconnects.
    await h.call('vault:unlock', { password: MASTER })
    await waitFor(
      () =>
        h.sink
          .states(sessionId)
          .slice(-1)
          .find((s) => s.state === 'ready'),
      { label: 'ready again' },
    )
    stop()
    expect(srv.authAttempts.length).toBeGreaterThan(logins)
  })

  it('reads the sudo password from the vault again after a lock', async () => {
    const h = await setup()
    const stop = trustAll(h)
    const srv = await server()
    const host = await saveHost(h, { port: srv.port })
    await h.call('vault:setMasterPassword', { next: MASTER })
    const { sessionId } = await h.call<SessionOpenResponse>('session:open', {
      hostId: host.id,
      cols: 80,
      rows: 24,
    })
    await settled(h, sessionId, ['ready'])
    stop()
    await h.call('vault:lock')
    await h.call('session:input', { sessionId, data: 'sudo whoami\r' })
    const sudo = () =>
      h.sink.events.flatMap((e) =>
        e.event === 'session:sudo' && e.payload.sessionId === sessionId ? [e.payload] : [],
      )
    await waitFor(() => sudo().at(-1)?.prompt === true, { label: 'sudo prompt' })
    expect(sudo().at(-1)?.canFill).toBe(true)
    await expect(h.invoke('session:fillSudo', { sessionId })).resolves.toEqual({
      ok: false,
      error: { code: 'VAULT_LOCKED' },
    })
    expect(srv.sudoAnswers).toEqual([])

    await h.call('vault:unlock', { password: MASTER })
    await h.call('session:fillSudo', { sessionId })
    await waitFor(() => srv.sudoAnswers.length === 1, { label: 'sudo answer' })
    expect(srv.sudoAnswers).toEqual([{ password: PASSWORD, right: true }])
    expect(JSON.stringify(h.responses)).not.toContain(PASSWORD)
  })
})

describe('copy password', () => {
  it('puts the saved password on the clipboard, never in a reply, and clears it on lock', async () => {
    const h = await setup()
    const host = await saveHost(h)
    const result = await h.call<{ clearsIn: number }>('secret:copy', { kind: 'host', id: host.id })
    expect(result).toEqual({ clearsIn: 30 })
    expect(h.clipboard.text).toBe(PASSWORD)
    expect(JSON.stringify(h.responses)).not.toContain(PASSWORD)

    const asks = await saveHost(h, { name: 'Asks', auth: { type: 'password', password: '' } })
    await expect(h.invoke('secret:copy', { kind: 'host', id: asks.id })).resolves.toEqual({
      ok: false,
      error: { code: 'PASSWORD_NOT_SAVED' },
    })

    await h.call('vault:setMasterPassword', { next: MASTER })
    await h.call('vault:lock')
    await waitFor(() => h.clipboard.text === '', { label: 'clipboard cleared' })
    await expect(h.invoke('secret:copy', { kind: 'host', id: host.id })).resolves.toEqual({
      ok: false,
      error: { code: 'VAULT_LOCKED' },
    })
  })
})

describe('export and import', () => {
  it('moves everything to another computer in one password-protected file', async () => {
    const from = await setup()
    await saveHost(from, { name: 'Web 1' })
    await saveHost(from, { name: 'Web 2' })
    const file = path.join(from.dir, 'backup.kelidar')

    // Cancelled save dialog: nothing written, no error.
    await expect(from.call('data:export', { password: 'file-password-1' })).resolves.toBeNull()
    from.dialogs.exportPath = file
    await expect(from.call('data:export', { password: 'file-password-1' })).resolves.toEqual({
      fileName: 'backup.kelidar',
    })
    const text = await readFile(file, 'utf8')
    expect(text).not.toContain('Web 1')
    expect(text).not.toContain(PASSWORD)

    const to = await setup()
    to.dialogs.importPath = file
    const picked = await to.call<{ token: string; fileName: string }>('data:importPick')
    await expect(
      to.invoke('data:import', { token: picked.token, password: 'nope' }),
    ).resolves.toEqual({ ok: false, error: { code: 'IMPORT_PASSWORD_WRONG' } })
    const summary = await to.call<ImportSummary>('data:import', {
      token: picked.token,
      password: 'file-password-1',
    })
    expect(summary).toEqual({ added: 2, updated: 0, unchanged: 0 })
    const hosts = await to.call<HostView[]>('hosts:list')
    expect(hosts.map((host) => host.name).sort()).toEqual(['Web 1', 'Web 2'])

    // The saved password came along: it can be copied on the new computer.
    const web1 = hosts.find((host) => host.name === 'Web 1')
    if (web1 === undefined) throw new Error('missing host')
    await to.call('secret:copy', { kind: 'host', id: web1.id })
    expect(to.clipboard.text).toBe(PASSWORD)

    // Importing the same file again changes nothing.
    const again = await to.call<{ token: string }>('data:importPick')
    await expect(
      to.call('data:import', { token: again.token, password: 'file-password-1' }),
    ).resolves.toEqual({ added: 0, updated: 0, unchanged: 2 })
  })
})
