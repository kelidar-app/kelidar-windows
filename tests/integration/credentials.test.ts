import { afterEach, describe, expect, it } from 'vitest'
import type { GroupView } from '../../src/shared/groups'
import type { HostView } from '../../src/shared/hosts'
import type { IdentityView, KeyUpgradePlan, KeyView } from '../../src/shared/keychain'
import type { SessionOpenResponse, SessionState } from '../../src/shared/session'
import { readableKeyPair } from '../unit/helpers/keys'
import { createHarness, waitFor, type Harness } from './helpers/harness'
import { startTestServer, type TestServer, type TestServerOptions } from './helpers/ssh-server'
import { startTestAgent, type TestAgent } from './helpers/test-agent'

const PASSWORD = 'pw-Keychain-Heron-4471-secret'
const OTP = '602914'

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

async function agent(privateKeys: string[]): Promise<TestAgent> {
  const started = await startTestAgent(privateKeys)
  cleanups.push(started.close)
  return started
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

const trust = (h: Harness) => answer(h, 'hostKey', { kind: 'hostKey', trust: true })

async function open(h: Harness, hostId: string): Promise<string> {
  const opened = await h.call<SessionOpenResponse>('session:open', { hostId, cols: 80, rows: 24 })
  return opened.sessionId
}

function final(
  h: Harness,
  sessionId: string,
  wanted: SessionState[] = ['ready', 'error', 'closed'],
) {
  return waitFor(() => h.sink.states(sessionId).find((s) => wanted.includes(s.state)), {
    label: `state ${wanted.join('/')}`,
  })
}

function saveHost(h: Harness, port: number, fields: Record<string, unknown>): Promise<HostView> {
  return h.call<HostView>('hosts:save', { name: 'box', address: '127.0.0.1', port, ...fields })
}

describe.runIf(process.platform === 'win32')('ssh-agent on a Windows named pipe', () => {
  it('signs in with a key the agent holds; the key never enters Kelidar', async () => {
    const pair = readableKeyPair('ed25519')
    const testAgent = await agent([pair.private])
    const h = await setup({ agentPipe: testAgent.pipe })
    const srv = await server({ authorizedKey: pair.public })

    const status = await h.call<{ openssh: { running: boolean; keys: number }; active: string }>(
      'agent:status',
    )
    expect(status).toMatchObject({ openssh: { running: true, keys: 1 }, active: 'openssh' })

    const host = await saveHost(h, srv.port, { username: 'tester', auth: { type: 'agent' } })
    expect(host.signIn).toEqual({ method: 'agent' })
    const id = await open(h, host.id)
    await trust(h)
    expect(await final(h, id)).toMatchObject({ state: 'ready' })
    expect(testAgent.signatures()).toBe(1)
    expect(srv.authAttempts.filter((a) => a.method === 'password')).toEqual([])

    const vault = (await h.vaults.get()).read()
    expect(JSON.stringify(vault)).not.toContain(pair.private.split('\n')[1])
  })

  it('forwards the agent only to hosts that turn it on', async () => {
    const pair = readableKeyPair('ed25519')
    const testAgent = await agent([pair.private])
    const h = await setup({ agentPipe: testAgent.pipe })
    const srv = await server()
    const plain = await saveHost(h, srv.port, {
      username: 'tester',
      auth: { type: 'password', password: PASSWORD },
    })
    const forwarding = await saveHost(h, srv.port, {
      name: 'forwarding',
      username: 'tester',
      agentForward: true,
      auth: { type: 'password', password: PASSWORD },
    })
    expect(forwarding.agentForward).toBe(true)

    const a = await open(h, plain.id)
    await trust(h)
    await final(h, a)
    expect(srv.agentForwardRequests()).toBe(0)
    const b = await open(h, forwarding.id)
    expect(await final(h, b)).toMatchObject({ state: 'ready' })
    await waitFor(() => srv.agentForwardRequests() === 1, { label: 'agent forward request' })
  })

  it('says when the agent holds no key', async () => {
    const testAgent = await agent([])
    const h = await setup({ agentPipe: testAgent.pipe })
    const srv = await server()
    const host = await saveHost(h, srv.port, { username: 'tester', auth: { type: 'agent' } })
    const id = await open(h, host.id)
    expect(await final(h, id)).toMatchObject({ state: 'error', error: 'AGENT_NO_KEYS' })
  })
})

describe('credentials', () => {
  it('says when no agent runs', async () => {
    const h = await setup()
    const srv = await server()
    const host = await saveHost(h, srv.port, { username: 'tester', auth: { type: 'agent' } })
    const id = await open(h, host.id)
    expect(await final(h, id)).toMatchObject({ state: 'error', error: 'AGENT_UNAVAILABLE' })
    expect(srv.authAttempts).toEqual([])
  })

  it('asks the user for a one-time code instead of sending the password again', async () => {
    const h = await setup()
    const srv = await server({ otp: OTP })
    const host = await saveHost(h, srv.port, {
      username: 'tester',
      auth: { type: 'password', password: PASSWORD },
    })
    const id = await open(h, host.id)
    await trust(h)
    const question = await waitFor(
      () => h.sink.prompts().find((p) => p.kind === 'keyboardInteractive'),
      { label: 'one-time code question' },
    )
    expect(question).toMatchObject({ prompts: [{ text: 'Verification code: ', echo: false }] })
    await answer(h, 'keyboardInteractive', { kind: 'keyboardInteractive', values: [OTP] })
    expect(await final(h, id)).toMatchObject({ state: 'ready' })
  })

  it('generates a key, signs in with it, and refuses to delete it while used', async () => {
    const h = await setup()
    const key = await h.call<KeyView>('keys:generate', { name: 'laptop', type: 'ed25519' })
    expect(key).toMatchObject({ name: 'laptop', type: 'ed25519', usedBy: 0, hasPassphrase: false })
    expect(key.fingerprint).toMatch(/^SHA256:[\w+/]{43}$/)
    const srv = await server({ authorizedKey: key.publicKey })

    const host = await saveHost(h, srv.port, {
      username: 'tester',
      auth: { type: 'savedKey', keyId: key.id },
    })
    expect(host.signIn).toMatchObject({ method: 'key', keyId: key.id, keyName: 'laptop' })
    const id = await open(h, host.id)
    await trust(h)
    expect(await final(h, id)).toMatchObject({ state: 'ready' })

    const [listed] = await h.call<KeyView[]>('keys:list')
    expect(listed?.usedBy).toBe(1)
    await expect(h.invoke('keys:delete', { id: key.id })).resolves.toEqual({
      ok: false,
      error: { code: 'KEY_IN_USE' },
    })
    await h.call('hosts:delete', { id: host.id })
    await h.call('keys:delete', { id: key.id })
    expect(await h.call<KeyView[]>('keys:list')).toEqual([])
  })

  it('makes an RSA key protected by a passphrase', async () => {
    const h = await setup()
    const key = await h.call<KeyView>('keys:generate', {
      name: 'rsa',
      type: 'rsa',
      passphrase: 'phrase-Otter-1180',
    })
    expect(key).toMatchObject({ type: 'rsa', hasPassphrase: true })
    expect(key.publicKey).toMatch(/^ssh-rsa AAAA/)
  })

  it('shares an identity between hosts and through a group', async () => {
    const h = await setup()
    const srv = await server()
    const identity = await h.call<IdentityView>('identities:save', {
      name: 'deploy',
      username: 'tester',
      auth: { type: 'password', password: 'wrong-at-first' },
    })
    const group = await h.call<GroupView>('groups:save', {
      name: 'Lab',
      defaults: { identityId: identity.id },
    })
    const direct = await saveHost(h, srv.port, {
      name: 'direct',
      auth: { type: 'identity', identityId: identity.id },
    })
    const inherited = await saveHost(h, srv.port, {
      name: 'inherited',
      groupId: group.id,
      auth: { type: 'inherit' },
    })
    expect(direct).toMatchObject({
      username: 'tester',
      identity: { id: identity.id, name: 'deploy', from: 'host' },
    })
    expect(inherited).toMatchObject({ username: 'tester', identity: { from: 'group' } })

    // One change to the identity fixes both hosts.
    await h.call('identities:save', {
      id: identity.id,
      name: 'deploy',
      username: 'tester',
      auth: { type: 'password', password: PASSWORD },
    })
    const a = await open(h, direct.id)
    await trust(h)
    expect(await final(h, a)).toMatchObject({ state: 'ready' })
    const b = await open(h, inherited.id)
    expect(await final(h, b)).toMatchObject({ state: 'ready' })

    expect((await h.call<IdentityView[]>('identities:list'))[0]?.usedBy).toBe(2)
    await expect(h.invoke('identities:delete', { id: identity.id })).resolves.toEqual({
      ok: false,
      error: { code: 'IDENTITY_IN_USE' },
    })
    await expect(
      h.invoke('hosts:save', { name: 'x', address: 'x.example.com', auth: { type: 'password' } }),
    ).resolves.toEqual({ ok: false, error: { code: 'USERNAME_REQUIRED' } })
  })

  it('upgrades a password host to key login, showing the exact command first', async () => {
    const h = await setup()
    const srv = await server()
    const host = await saveHost(h, srv.port, {
      username: 'tester',
      auth: { type: 'password', password: PASSWORD },
    })

    const plan = await h.call<KeyUpgradePlan>('hosts:upgradePrepare', {
      hostId: host.id,
      key: { generate: 'ed25519' },
    })
    expect(plan.command).toContain('~/.ssh/authorized_keys')
    expect(plan.command).toMatch(/'ssh-ed25519 [A-Za-z0-9+/=]+ kelidar'/)
    // Nothing ran yet, and nothing was saved.
    expect(srv.execs).toEqual([])
    expect(await h.call<KeyView[]>('keys:list')).toEqual([])

    const running = h.call<HostView>('hosts:upgradeRun', { upgradeId: plan.upgradeId })
    await trust(h)
    const upgraded = await running
    expect(srv.execs[0]).toBe(plan.command)
    expect(srv.execs[1]).toBe('true')
    expect(upgraded.signIn).toMatchObject({ method: 'key', keyType: 'ed25519' })
    const [key] = await h.call<KeyView[]>('keys:list')
    expect(key).toMatchObject({ fingerprint: plan.fingerprint, usedBy: 1 })
    // The saved password is gone; only the key's own secret remains.
    const vault = (await h.vaults.get()).read()
    expect(vault.secrets.filter((s) => s.deletedAt === undefined)).toHaveLength(1)
    expect(JSON.stringify(h.responses)).not.toContain(PASSWORD)

    // The next connection signs in with the key alone.
    const before = srv.authAttempts.length
    const id = await open(h, host.id)
    expect(await final(h, id)).toMatchObject({ state: 'ready' })
    expect(srv.authAttempts.slice(before).map((a) => a.method)).not.toContain('password')

    // A plan runs once.
    await expect(h.invoke('hosts:upgradeRun', { upgradeId: plan.upgradeId })).resolves.toEqual({
      ok: false,
      error: { code: 'KEY_UPGRADE_EXPIRED' },
    })
    await expect(
      h.invoke('hosts:upgradePrepare', { hostId: host.id, key: { generate: 'ed25519' } }),
    ).resolves.toEqual({ ok: false, error: { code: 'KEY_UPGRADE_NOT_NEEDED' } })
  })

  it('changes nothing when the server refuses the command', async () => {
    const h = await setup()
    const srv = await server({ execExitCode: 1 })
    const host = await saveHost(h, srv.port, {
      username: 'tester',
      auth: { type: 'password', password: PASSWORD },
    })
    const plan = await h.call<KeyUpgradePlan>('hosts:upgradePrepare', {
      hostId: host.id,
      key: { generate: 'ed25519' },
    })
    const running = h.invoke('hosts:upgradeRun', { upgradeId: plan.upgradeId })
    await trust(h)
    expect(await running).toEqual({ ok: false, error: { code: 'KEY_UPGRADE_INSTALL_FAILED' } })
    const [after] = await h.call<HostView[]>('hosts:list')
    expect(after?.signIn).toEqual({ method: 'password' })
    expect(await h.call<KeyView[]>('keys:list')).toEqual([])
  })
})
