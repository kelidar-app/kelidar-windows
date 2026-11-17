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
  /**
   * Two-factor sign-in: after the right password, the server asks this code
   * as a keyboard-interactive question ("Verification code:").
   */
  otp?: string
  /** Exit code of commands run over exec (default 0). */
  execExitCode?: number
  /** Pretend tmux is installed (for sticky sessions). */
  tmux?: boolean
  /** Refuse to forward TCP for jump host use (AllowTcpForwarding no). */
  noForwarding?: boolean
  /** Hold back the answer to the tmux check this long (to close a tab while it waits). */
  probeDelayMs?: number
  /** What `cat /etc/os-release` prints (the command fails when omitted). */
  osRelease?: string
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
  /** Commands run over exec, exactly as received. */
  execs: string[]
  /** Sessions that asked for agent forwarding. */
  agentForwardRequests: () => number
  /** Questions asked over keyboard-interactive. */
  keyboardQuestions: string[]
  /** TCP forwards asked of this server as a jump host. */
  forwards: { host: string; port: number }[]
  /** tmux sessions started or resumed, by name, in order. */
  tmuxAttaches: string[]
  /** Passwords typed at the fake sudo prompt ("sudo whoami"), and whether each was right. */
  sudoAnswers: { password: string; right: boolean }[]
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
  const parsePublic = (text: string): ParsedKey => {
    const parsed = utils.parseKey(text)
    if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('bad test key')
    return parsed
  }
  /** Keys allowed to sign in; an exec that writes authorized_keys adds to it. */
  const authorizedKeys: ParsedKey[] =
    options.authorizedKey === undefined ? [] : [parsePublic(options.authorizedKey)]

  let shells = 0
  let agentForwards = 0
  const state: Omit<TestServer, 'port' | 'close'> = {
    hostKey,
    authAttempts: [],
    ptys: [],
    resizes: [],
    connections: [],
    received: [],
    openShells: () => shells,
    execs: [],
    agentForwardRequests: () => agentForwards,
    keyboardQuestions: [],
    forwards: [],
    tmuxAttaches: [],
    sudoAnswers: [],
  }
  const tmuxSessions = new Set<string>()

  const onAuth = (ctx: AuthContext, connection: { passwordPassed: boolean }): void => {
    state.authAttempts.push({ method: ctx.method, username: ctx.username })
    const methods: AuthContext['method'][] = options.keyboardOnly
      ? ['keyboard-interactive']
      : ['password', 'publickey', 'keyboard-interactive']
    if (ctx.username !== username) {
      ctx.reject(methods)
      return
    }
    if (ctx.method === 'password' && !options.keyboardOnly && options.password !== undefined) {
      if (!same(ctx.password, options.password)) ctx.reject(methods)
      else if (options.otp === undefined) ctx.accept()
      else {
        // Right password, now the second factor.
        connection.passwordPassed = true
        ctx.reject(['keyboard-interactive'], true)
      }
      return
    }
    if (ctx.method === 'keyboard-interactive' && options.otp !== undefined) {
      if (!connection.passwordPassed) {
        ctx.reject(methods)
        return
      }
      const otp = options.otp
      state.keyboardQuestions.push('Verification code: ')
      ctx.prompt([{ prompt: 'Verification code: ', echo: false }], (answers) => {
        if (answers[0] !== undefined && same(answers[0], otp)) ctx.accept()
        else ctx.reject(['keyboard-interactive'])
      })
      return
    }
    const authorized = authorizedKeys.find(
      (key) => ctx.method === 'publickey' && ctx.key.data.equals(key.getPublicSSH()),
    )
    if (ctx.method === 'publickey') {
      const keyMatches = authorized !== undefined && ctx.key.algo === authorized.type
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
      state.keyboardQuestions.push('Password: ')
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
    // Like sudo: after the prompt, input is not echoed until Enter.
    let sudoPrompt = false
    stream.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      state.received.push(text)
      if (!sudoPrompt) stream.write(text)
      line += text
      if (!line.includes('\r')) return
      const command = line.split('\r')[0] ?? ''
      line = ''
      if (sudoPrompt) {
        sudoPrompt = false
        const right = command === options.password
        state.sudoAnswers.push({ password: command, right })
        stream.write(right ? '\r\nroot\r\n$ ' : '\r\nSorry, try again.\r\n$ ')
        return
      }
      if (command.trim() === 'sudo whoami') {
        sudoPrompt = true
        stream.write(`\r\n\x1b[1m[sudo] password for ${username}:\x1b[0m `)
        return
      }
      if (command.trim() === 'exit') {
        stream.exit(0)
        stream.end()
      } else if (command.trim() === 'big') {
        writeBig(stream, options.bigOutputBytes ?? 4 * 1024 * 1024)
      }
    })
  }

  const server = new Server({ hostKeys: [hostKey] }, (connection) => {
    state.connections.push(connection)
    connection.on('error', () => undefined)
    const perConnection = { passwordPassed: false }
    connection.on('authentication', (ctx) => {
      onAuth(ctx, perConnection)
    })
    connection.on('ready', () => {
      // Jump host use: forward TCP to the next server.
      connection.on('tcpip', (accept, reject, info) => {
        state.forwards.push({ host: info.destIP, port: info.destPort })
        if (options.noForwarding === true) {
          reject()
          return
        }
        const socket = net.connect(info.destPort, info.destIP)
        socket.on('error', () => undefined)
        socket.on('connect', () => {
          const channel = accept()
          channel.pipe(socket).pipe(channel)
          channel.on('close', () => {
            socket.destroy()
          })
          socket.on('close', () => {
            channel.close()
          })
        })
      })
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
        session.on('auth-agent', (accept) => {
          agentForwards++
          ;(accept as (() => void) | undefined)?.()
        })
        session.on('exec', (accept, _reject, info) => {
          if (options.probeDelayMs !== undefined && info.command.startsWith('command -v tmux')) {
            state.execs.push(info.command)
            setTimeout(() => {
              // The client may be gone by now; accepting then is harmless.
              try {
                const late = accept()
                late.exit(0)
                late.end()
              } catch {
                // Connection already closed.
              }
            }, options.probeDelayMs)
            return
          }
          const stream = accept()
          state.execs.push(info.command)
          // Sticky sessions: the tmux check, then the shell inside tmux.
          if (info.command.startsWith('command -v tmux')) {
            const name = /has-session -t (\S+)/.exec(info.command)?.[1] ?? ''
            stream.exit(options.tmux === true ? (tmuxSessions.has(name) ? 3 : 0) : 127)
            stream.end()
            return
          }
          const tmux = /^tmux new-session -A -s (\S+)$/.exec(info.command)
          if (tmux?.[1] !== undefined) {
            tmuxSessions.add(tmux[1])
            state.tmuxAttaches.push(tmux[1])
            runShell(stream)
            return
          }
          if (info.command === 'cat /etc/os-release') {
            if (options.osRelease !== undefined) stream.write(options.osRelease)
            stream.exit(options.osRelease === undefined ? 1 : 0)
            stream.end()
            return
          }
          // "Install" a key the way the real command would.
          const added = /'(ssh-[\w-]+ [A-Za-z0-9+/=]+) kelidar'/.exec(info.command)
          if (added?.[1] !== undefined && (options.execExitCode ?? 0) === 0) {
            authorizedKeys.push(parsePublic(added[1]))
          }
          stream.exit(options.execExitCode ?? 0)
          stream.end()
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
  /** The network is back: dead connections are gone, new ones work. */
  restore: () => void
  /** Connections made through the proxy so far. */
  connections: () => number
  close: () => Promise<void>
}> {
  let made = 0
  const sockets: net.Socket[] = []
  let dropped = false
  const server = net.createServer((inbound) => {
    made++
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
    restore: () => {
      for (const socket of sockets.splice(0)) socket.destroy()
      dropped = false
    },
    connections: () => made,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => {
          resolve()
        })
      }),
  }
}
