import net from 'node:net'
import { Server } from 'ssh2'
import { afterEach, describe, expect, it } from 'vitest'
import type { HostView } from '../../src/shared/hosts'
import type { SessionOpenResponse } from '../../src/shared/session'
import { createHarness, waitFor, type Harness } from './helpers/harness'
import { readableKeyPair } from '../unit/helpers/keys'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function setup(timing: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
  const harness = await createHarness(timing)
  cleanups.push(harness.close)
  return harness
}

/** Opens a saved host and returns the final state event. */
async function failureOf(h: Harness, address: string, port: number) {
  const host = await h.call<HostView>('hosts:save', {
    name: 'x',
    address,
    port,
    username: 'tester',
    auth: { type: 'password', password: 'irrelevant' },
  })
  const { sessionId } = await h.call<SessionOpenResponse>('session:open', {
    hostId: host.id,
    cols: 80,
    rows: 24,
  })
  return waitFor(
    () => h.sink.states(sessionId).find((s) => s.state === 'error' || s.state === 'closed'),
    { label: 'final state', timeout: 20_000 },
  )
}

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return address.port
}

describe('connection failures map to clear error codes', () => {
  it('a name that does not resolve: SSH_HOST_NOT_FOUND', async () => {
    const h = await setup()
    expect(await failureOf(h, 'no-such-host.invalid', 22)).toMatchObject({
      state: 'error',
      error: 'SSH_HOST_NOT_FOUND',
    })
  })

  it('a server that never answers the handshake: SSH_TIMEOUT', async () => {
    const h = await setup({ timing: { readyTimeoutMs: 300 } })
    const sockets: net.Socket[] = []
    const silent = net.createServer((socket) => {
      sockets.push(socket)
      socket.on('error', () => undefined)
    })
    const port = await listen(silent)
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          for (const socket of sockets) socket.destroy()
          silent.close(() => {
            resolve()
          })
        }),
    )
    expect(await failureOf(h, '127.0.0.1', port)).toMatchObject({
      state: 'error',
      error: 'SSH_TIMEOUT',
    })
  })

  it('no algorithm in common: SSH_ALGORITHM_MISMATCH', async () => {
    const h = await setup()
    const server = new Server(
      {
        hostKeys: [readableKeyPair('ed25519').private],
        // An old key exchange the client does not offer by default.
        algorithms: { kex: ['diffie-hellman-group1-sha1'] },
      },
      (connection) => {
        connection.on('error', () => undefined)
      },
    )
    const port = await listen(server)
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve()
          })
        }),
    )
    expect(await failureOf(h, '127.0.0.1', port)).toMatchObject({
      state: 'error',
      error: 'SSH_ALGORITHM_MISMATCH',
    })
  })

  it('a server that hangs up at once: SSH_CONNECTION_CLOSED_BY_SERVER', async () => {
    const h = await setup()
    const sockets: net.Socket[] = []
    const rude = net.createServer((socket) => {
      sockets.push(socket)
      socket.on('error', () => undefined)
      socket.end()
    })
    const port = await listen(rude)
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          for (const socket of sockets) socket.destroy()
          rude.close(() => {
            resolve()
          })
        }),
    )
    expect(await failureOf(h, '127.0.0.1', port)).toMatchObject({
      state: 'error',
      error: 'SSH_CONNECTION_CLOSED_BY_SERVER',
    })
  })
})
