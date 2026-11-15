import { describe, expect, it } from 'vitest'
import { AppError } from '../../src/main/ipc/app-error'
import { mapConnectionError } from '../../src/main/ssh/errors'
import { keyTypeOf } from '../../src/main/ssh/host-keys'
import { sha256Fingerprint } from '../../src/main/ssh/keys'
import { PromptBroker } from '../../src/main/ssh/prompts'
import { ipcContract } from '../../src/shared/ipc'
import type { IpcEvent } from '../../src/shared/ipc-events'

function sshError(message: string, extra: { code?: string; level?: string } = {}): Error {
  return Object.assign(new Error(message), extra)
}

describe('mapConnectionError', () => {
  it('maps each kind of failure to its own code', () => {
    const cases: [Error, string][] = [
      [
        sshError('getaddrinfo ENOTFOUND x', { code: 'ENOTFOUND', level: 'client-socket' }),
        'SSH_HOST_NOT_FOUND',
      ],
      [sshError('getaddrinfo EAI_AGAIN x', { code: 'EAI_AGAIN' }), 'SSH_HOST_NOT_FOUND'],
      [sshError('lookup failed', { level: 'client-dns' }), 'SSH_HOST_NOT_FOUND'],
      [sshError('connect ECONNREFUSED', { code: 'ECONNREFUSED' }), 'SSH_CONNECTION_REFUSED'],
      [sshError('connect EHOSTUNREACH', { code: 'EHOSTUNREACH' }), 'SSH_NETWORK_UNREACHABLE'],
      [sshError('connect ENETUNREACH', { code: 'ENETUNREACH' }), 'SSH_NETWORK_UNREACHABLE'],
      [
        sshError('Timed out while waiting for handshake', { level: 'client-timeout' }),
        'SSH_TIMEOUT',
      ],
      [sshError('connect ETIMEDOUT', { code: 'ETIMEDOUT' }), 'SSH_TIMEOUT'],
      [sshError('read ECONNRESET', { code: 'ECONNRESET' }), 'SSH_CONNECTION_CLOSED_BY_SERVER'],
      [sshError('Keepalive timeout', { level: 'client-timeout' }), 'SSH_CONNECTION_LOST'],
      [
        sshError('All configured authentication methods failed', {
          level: 'client-authentication',
        }),
        'SSH_AUTH_FAILED',
      ],
      [
        sshError('Handshake failed: no matching key exchange algorithm', { level: 'handshake' }),
        'SSH_ALGORITHM_MISMATCH',
      ],
      [
        sshError('Handshake failed: no matching C->S cipher', { level: 'handshake' }),
        'SSH_ALGORITHM_MISMATCH',
      ],
      [
        sshError('Connection lost before handshake', { level: 'protocol' }),
        'SSH_CONNECTION_CLOSED_BY_SERVER',
      ],
      [sshError('something odd'), 'SSH_FAILED'],
    ]
    for (const [error, code] of cases) expect(mapConnectionError(error), error.message).toBe(code)
  })

  it('treats a reset after the shell opened as a lost connection', () => {
    const reset = sshError('read ECONNRESET', { code: 'ECONNRESET' })
    expect(mapConnectionError(reset, { wasReady: true })).toBe('SSH_CONNECTION_LOST')
  })

  it('lets host key problems and app errors win', () => {
    const denied = sshError('Host denied (verification failed)', { level: 'handshake' })
    expect(mapConnectionError(denied, { hostKey: 'changed' })).toBe('SSH_HOST_KEY_CHANGED')
    expect(mapConnectionError(denied, { hostKey: 'rejected' })).toBe('SSH_HOST_KEY_REJECTED')
    expect(mapConnectionError(new AppError('VAULT_CORRUPT'))).toBe('VAULT_CORRUPT')
    expect(mapConnectionError('not an error')).toBe('SSH_FAILED')
  })
})

describe('host key helpers', () => {
  const blob = Buffer.concat([
    Buffer.from([0, 0, 0, 11]),
    Buffer.from('ssh-ed25519'),
    Buffer.from([0, 0, 0, 32]),
    Buffer.alloc(32, 7),
  ])

  it('reads the key type from the wire format', () => {
    expect(keyTypeOf(blob)).toBe('ssh-ed25519')
    expect(keyTypeOf(Buffer.from([0, 0]))).toBe('unknown')
    expect(keyTypeOf(Buffer.from([0, 0, 1, 0, 65]))).toBe('unknown')
  })

  it('formats SHA-256 fingerprints like OpenSSH', () => {
    expect(sha256Fingerprint(blob)).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
  })
})

describe('PromptBroker', () => {
  const sink = (id: number) => {
    const sent: { event: IpcEvent; payload: unknown }[] = []
    return {
      id,
      sent,
      send: (event: IpcEvent, payload: unknown) => {
        sent.push({ event, payload })
      },
      isDestroyed: () => false,
    }
  }

  it('accepts an answer only from the owning window and of the same kind', async () => {
    const broker = new PromptBroker()
    const owner = sink(1)
    const asked = broker.ask(owner, {
      sessionId: 's',
      kind: 'hostKey',
      host: 'h',
      port: 22,
      keyType: 'ssh-ed25519',
      fingerprint: 'SHA256:x',
    })
    const { promptId } = owner.sent[0]?.payload as { promptId: string }
    expect(broker.answer(sink(2), promptId, { kind: 'hostKey', trust: true })).toBe(false)
    expect(broker.answer(owner, promptId, { kind: 'password', value: 'x' })).toBe(false)
    expect(broker.answer(owner, promptId, { kind: 'hostKey', trust: true })).toBe(true)
    await expect(asked).resolves.toEqual({ kind: 'hostKey', trust: true })
    expect(broker.answer(owner, promptId, { kind: 'hostKey', trust: true })).toBe(false)
  })

  it('cancels the open prompts of a session', async () => {
    const broker = new PromptBroker()
    const owner = sink(1)
    const asked = broker.ask(owner, {
      sessionId: 's',
      kind: 'password',
      username: 'u',
      host: 'h',
      attempt: 0,
    })
    broker.cancelSession('s')
    await expect(asked).resolves.toBeNull()
    expect(owner.sent.map((item) => item.event)).toEqual(['prompt:request', 'prompt:cancel'])
  })
})

describe('session IPC schemas', () => {
  const id = crypto.randomUUID()

  it('validates session requests', () => {
    const open = ipcContract['session:open'].request
    expect(open.safeParse({ hostId: id, cols: 80, rows: 24 }).success).toBe(true)
    expect(open.safeParse({ hostId: 'x', cols: 80, rows: 24 }).success).toBe(false)
    expect(open.safeParse({ hostId: id, cols: 0, rows: 24 }).success).toBe(false)

    const input = ipcContract['session:input'].request
    expect(input.safeParse({ sessionId: id, data: 'ls\r' }).success).toBe(true)
    expect(input.safeParse({ sessionId: id, data: '' }).success).toBe(false)
    expect(input.safeParse({ sessionId: id, data: 'x'.repeat(1_000_001) }).success).toBe(false)

    const resize = ipcContract['session:resize'].request
    expect(resize.safeParse({ sessionId: id, cols: 120, rows: 40 }).success).toBe(true)
    expect(resize.safeParse({ sessionId: id, cols: 120.5, rows: 40 }).success).toBe(false)
    expect(resize.safeParse({ sessionId: id, cols: 5000, rows: 40 }).success).toBe(false)

    const ack = ipcContract['session:ack'].request
    expect(ack.safeParse({ sessionId: id, bytes: -1 }).success).toBe(false)
  })

  it('validates prompt answers', () => {
    const answer = ipcContract['prompt:answer'].request
    const promptId = 'a'.repeat(32)
    expect(answer.safeParse({ promptId, answer: { kind: 'hostKey', trust: true } }).success).toBe(
      true,
    )
    expect(answer.safeParse({ promptId, answer: { kind: 'password', value: null } }).success).toBe(
      true,
    )
    expect(
      answer.safeParse({ promptId: 'x', answer: { kind: 'hostKey', trust: true } }).success,
    ).toBe(false)
    expect(answer.safeParse({ promptId, answer: { kind: 'hostKey', trust: 'yes' } }).success).toBe(
      false,
    )
  })
})
