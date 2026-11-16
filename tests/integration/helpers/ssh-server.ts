import net from 'node:net'
import { timingSafeEqual } from 'node:crypto'
import {
  Server,
  utils,
  type AuthContext,
  type Connection,
  type ParsedKey,
  type PseudoTtyInfo,
  type ServerChannel,
} from 'ssh2'
import { readableKeyPair } from '../../unit/helpers/keys'

export interface TestServerOptions {
  username?: string
  password?: string
  /** Public key (OpenSSH format) allowed to sign in. */
  authorizedKey?: string
  /** Only offer keyboard-interactive (password questions), like many PAM setups. */
  keyboardOnly?: boolean
  /** Host key in OpenSSH format; a new ed25519 key when omitted. */
  hostKey?: string
  /** Listen on this port (to restart a server with a new key on the same port). */
  port?: number
  /** Bytes the "big" command prints. */
  bigOutputBytes?: number
}

export interface TestServer {
  port: number
  hostKey: string
  authAttempts: { method: string; username: string }[]
  ptys: PseudoTtyInfo[]
  resizes: { cols: number; rows: number }[]
  connections: Connection[]
  /** Everything typed into any shell, in order. */
  received: string[]
  /** Open shells right now. */
  openShells: () => number
  close: () => Promise<void>
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * A tiny SSH server for tests. Its shell prints "welcome", echoes input,
 * prints a large block for "big", and exits for "exit".
 */
export async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const username = options.username ?? 'tester'
  const hostKey = options.hostKey ?? readableKeyPair('ed25519').private
  const authorized: ParsedKey | undefined =
    options.authorizedKey === undefined
      ? undefined
      : (() => {
          const parsed = utils.parseKey(options.authorizedKey)
          if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('bad test key')
          return parsed
        })()

  let shells = 0
  const state: Omit<TestServer, 'port' | 'close'> = {
    hostKey,
    authAttempts: [],
    ptys: [],
    resizes: [],
    connections: [],
    received: [],
    openShells: () => shells,
  }

  const onAuth = (ctx: AuthContext): void => {
    state.authAttempts.push({ method: ctx.method, username: ctx.username })
    const methods: AuthContext['method'][] = options.keyboardOnly
      ? ['keyboard-interactive']
      : ['password', 'publickey', 'keyboard-interactive']
    if (ctx.username !== username) {
      ctx.reject(methods)
      return
    }
    if (ctx.method === 'password' && !options.keyboardOnly && options.password !== undefined) {
      if (same(ctx.password, options.password)) ctx.accept()
      else ctx.reject(methods)
      return
    }
    if (ctx.method === 'publickey' && authorized !== undefined) {
      const keyMatches =
        ctx.key.algo === authorized.type && ctx.key.data.equals(authorized.getPublicSSH())
      if (!keyMatches) {
        ctx.reject(methods)
        return
      }
      if (ctx.signature === undefined) {
        ctx.accept()
        return
      }
      if (ctx.blob !== undefined && authorized.verify(ctx.blob, ctx.signature, ctx.hashAlgo)) {
        ctx.accept()
      } else ctx.reject(methods)
      return
    }
    if (ctx.method === 'keyboard-interactive' && options.password !== undefined) {
      const password = options.password
      ctx.prompt([{ prompt: 'Password: ', echo: false }], (answers) => {
        if (answers[0] !== undefined && same(answers[0], password)) ctx.accept()
        else ctx.reject(methods)
      })
      return
    }
    ctx.reject(methods)
  }

  const runShell = (stream: ServerChannel): void => {
    stream.write('welcome\r\n')
    shells++
    stream.on('close', () => {
      shells--
    })
    let line = ''
    stream.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      state.received.push(text)
      stream.write(text)
      line += text
      if (!line.includes('\r')) return
      const command = line.split('\r')[0]?.trim() ?? ''
      line = ''
      if (command === 'exit') {
        stream.exit(0)
        stream.end()
      } else if (command === 'big') {
        writeBig(stream, options.bigOutputBytes ?? 4 * 1024 * 1024)
      }
    })
  }

  const server = new Server({ hostKeys: [hostKey] }, (connection) => {
    state.connections.push(connection)
    connection.on('error', () => undefined)
    connection.on('authentication', onAuth)
    connection.on('ready', () => {
      connection.on('session', (acceptSession) => {
        const session = acceptSession()
        session.on('pty', (accept, _reject, info) => {
          state.ptys.push(info)
          accept()
        })
        session.on('window-change', (accept, _reject, info) => {
          state.resizes.push({ cols: info.cols, rows: info.rows })
          // Only a function when the client asked for a reply.
          ;(accept as (() => void) | undefined)?.()
        })
        session.on('shell', (accept) => {
          runShell(accept())
        })
      })
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')

  return {
    ...state,
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const connection of state.connections) connection.end()
        server.close(() => {
          resolve()
        })
      }),
  }
}

/** Writes `total` bytes of printable lines, respecting backpressure. */
function writeBig(stream: ServerChannel, total: number): void {
  const line = `${'x'.repeat(99)}\n`
  const block = Buffer.from(line.repeat(160))
  let sent = 0
  const pump = (): void => {
    while (sent < total) {
      const piece = block.subarray(0, Math.min(block.length, total - sent))
      sent += piece.length
      if (!stream.write(piece)) {
        stream.once('drain', pump)
        return
      }
    }
    stream.write('\r\nBIG-DONE\r\n')
  }
  pump()
}

/**
 * A TCP proxy that can "pull the cable": after drop(), bytes stop flowing in
 * both directions but neither side gets a reset, like a dead network.
 */
export async function startDropProxy(targetPort: number): Promise<{
  port: number
  drop: () => void
  close: () => Promise<void>
}> {
  const sockets: net.Socket[] = []
  let dropped = false
  const server = net.createServer((inbound) => {
    const outbound = net.connect(targetPort, '127.0.0.1')
    sockets.push(inbound, outbound)
    for (const socket of [inbound, outbound]) socket.on('error', () => undefined)
    inbound.on('data', (chunk) => {
      if (!dropped) outbound.write(chunk)
    })
    outbound.on('data', (chunk) => {
      if (!dropped) inbound.write(chunk)
    })
    inbound.on('close', () => outbound.destroy())
    outbound.on('close', () => inbound.destroy())
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return {
    port: address.port,
    drop: () => {
      dropped = true
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => {
          resolve()
        })
      }),
  }
}
