import { randomUUID } from 'node:crypto'
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import type { ErrorCode } from '@shared/errors'
import type { HostKeyInfo, SessionOpenResponse, SessionState, SessionTarget } from '@shared/session'
import { AppError } from '../ipc/app-error'
import {
  createAuthHandler,
  MAX_PASSWORD_ATTEMPTS,
  type Credential,
  type UsedCredential,
} from './auth'
import { mapConnectionError } from './errors'
import type { EventSink } from './event-sink'
import { describeHostKey, type KnownHosts } from './host-keys'
import { inspectPrivateKey } from './keys'
import type { PromptBroker } from './prompts'

/** Everything needed to connect. Built in main from the vault or a Quick Connect string. */
export interface ConnectTarget extends SessionTarget {
  hostId?: string
  title: string
  credential: Credential
}

export interface SessionTiming {
  readyTimeoutMs: number
  keepaliveIntervalMs: number
  keepaliveCountMax: number
  /** Output is sent to the renderer at most this often. */
  flushIntervalMs: number
  /** A batch this big is sent at once. */
  maxBatchBytes: number
  /** Stop reading from the server when this much output is not yet rendered... */
  highWaterBytes: number
  /** ...and read again once the renderer is back under this. */
  lowWaterBytes: number
}

export const DEFAULT_TIMING: SessionTiming = {
  readyTimeoutMs: 20_000,
  keepaliveIntervalMs: 10_000,
  keepaliveCountMax: 3,
  flushIntervalMs: 8,
  maxBatchBytes: 256 * 1024,
  highWaterBytes: 1024 * 1024,
  lowWaterBytes: 256 * 1024,
}

export const MAX_SESSIONS_PER_WINDOW = 64

export interface SessionManagerOptions {
  resolveHost: (hostId: string) => Promise<ConnectTarget>
  /** Builds a target from Quick Connect text. */
  resolveQuick?: (input: string) => Promise<ConnectTarget>
  knownHosts: Pick<KnownHosts, 'check' | 'trust'>
  prompts: PromptBroker
  /** Receives state changes and error codes only, never data or secrets. */
  log?: (message: string) => void
  /** A session to a saved host reached a shell (for "Recent"). */
  onConnected?: (hostId: string) => void
  createClient?: () => Client
  timing?: Partial<SessionTiming>
}

export type SessionOpenRequest =
  | { hostId: string; cols: number; rows: number }
  | { quick: string; cols: number; rows: number }
  | { target: ConnectTarget; cols: number; rows: number }

const FINAL_STATES: ReadonlySet<SessionState> = new Set(['closed', 'error'])

class Session {
  state: SessionState = 'connecting'
  client: Client | undefined
  stream: ClientChannel | undefined
  pending: Buffer[] = []
  pendingBytes = 0
  timer: NodeJS.Timeout | undefined
  unacked = 0
  paused = false
  wasReady = false
  shellClosed = false
  userClosed = false
  cancelled = false
  hostKeyProblem: 'changed' | 'rejected' | undefined
  hostKey: HostKeyInfo | undefined
  forcedError: ErrorCode | undefined
  /** The credential that was being tried; becomes `used` once the shell opens. */
  trying: UsedCredential | null = null
  used: UsedCredential | undefined
  /** Starts as the target's credential; gains the passphrase once unlocked. */
  credential: Credential

  constructor(
    readonly id: string,
    readonly owner: EventSink,
    readonly target: ConnectTarget,
    public cols: number,
    public rows: number,
  ) {
    this.credential = target.credential
  }
}

/**
 * Owns every SSH connection. The renderer only ever holds a session id; it
 * sends keystrokes and sizes and receives output and state changes.
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>()
  private readonly timing: SessionTiming

  constructor(private readonly options: SessionManagerOptions) {
    this.timing = { ...DEFAULT_TIMING, ...options.timing }
  }

  async open(owner: EventSink, request: SessionOpenRequest): Promise<SessionOpenResponse> {
    const owned = [...this.sessions.values()].filter((s) => s.owner.id === owner.id).length
    if (owned >= MAX_SESSIONS_PER_WINDOW) throw new AppError('SESSION_LIMIT')

    const target = await this.resolve(request)
    const session = new Session(randomUUID(), owner, target, request.cols, request.rows)
    this.sessions.set(session.id, session)
    // Answer the renderer first, then start; events for this id may follow right away.
    setImmediate(() => {
      this.connect(session)
    })
    return {
      sessionId: session.id,
      title: target.title,
      target: { address: target.address, port: target.port, username: target.username },
      ...(target.hostId === undefined ? {} : { hostId: target.hostId }),
    }
  }

  private resolve(request: SessionOpenRequest): Promise<ConnectTarget> {
    if ('hostId' in request) return this.options.resolveHost(request.hostId)
    if ('quick' in request) {
      if (this.options.resolveQuick === undefined) throw new AppError('QUICK_CONNECT_INVALID')
      return this.options.resolveQuick(request.quick)
    }
    return Promise.resolve(request.target)
  }

  input(owner: EventSink, sessionId: string, data: string): void {
    const session = this.owned(owner, sessionId)
    if (session.state === 'ready') session.stream?.write(data)
  }

  resize(owner: EventSink, sessionId: string, cols: number, rows: number): void {
    const session = this.owned(owner, sessionId)
    session.cols = cols
    session.rows = rows
    if (session.state === 'ready') session.stream?.setWindow(rows, cols, 0, 0)
  }

  /** Flow control: the renderer has written `bytes` more bytes to the terminal. */
  ack(owner: EventSink, sessionId: string, bytes: number): void {
    const session = this.owned(owner, sessionId)
    session.unacked = Math.max(0, session.unacked - bytes)
    if (session.paused && session.unacked <= this.timing.lowWaterBytes) {
      session.paused = false
      session.stream?.resume()
    }
  }

  /** Ends the connection and forgets the session (the tab was closed). */
  close(owner: EventSink, sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session?.owner.id !== owner.id) return
    session.userClosed = true
    this.finish(session, 'closed')
    this.sessions.delete(sessionId)
  }

  closeAllFor(owner: EventSink): void {
    for (const session of [...this.sessions.values()]) {
      if (session.owner.id === owner.id) this.close(owner, session.id)
    }
  }

  closeAll(): void {
    for (const session of [...this.sessions.values()]) this.close(session.owner, session.id)
  }

  /** The sign-in that worked, for "Save host" after Quick Connect. Main only. */
  usedCredential(owner: EventSink, sessionId: string): UsedCredential | undefined {
    return this.owned(owner, sessionId).used
  }

  target(owner: EventSink, sessionId: string): ConnectTarget {
    return this.owned(owner, sessionId).target
  }

  private owned(owner: EventSink, sessionId: string): Session {
    const session = this.sessions.get(sessionId)
    if (session?.owner.id !== owner.id) throw new AppError('SESSION_NOT_FOUND')
    return session
  }

  private setState(session: Session, state: SessionState, error?: ErrorCode): void {
    if (FINAL_STATES.has(session.state) || session.state === state) return
    session.state = state
    this.options.log?.(
      `session ${session.id.slice(0, 8)} ${state}${error === undefined ? '' : ` ${error}`}`,
    )
    if (session.owner.isDestroyed()) return
    session.owner.send('session:state', {
      sessionId: session.id,
      state,
      ...(error === undefined ? {} : { error }),
      ...((error === 'SSH_HOST_KEY_CHANGED' || error === 'SSH_HOST_KEY_REJECTED') &&
      session.hostKey !== undefined
        ? { hostKey: session.hostKey }
        : {}),
    })
  }

  /** Moves to a final state once and releases everything. */
  private finish(session: Session, state: 'closed' | 'error', error?: ErrorCode): void {
    if (FINAL_STATES.has(session.state)) return
    this.flush(session)
    if (state === 'error') this.setState(session, 'error', error ?? 'SSH_FAILED')
    else this.setState(session, 'closed')
    clearTimeout(session.timer)
    session.timer = undefined
    session.pending = []
    session.pendingBytes = 0
    this.options.prompts.cancelSession(session.id)
    const client = session.client
    session.stream = undefined
    if (client !== undefined) {
      client.end()
      // If the server never answers the disconnect, drop the socket.
      setTimeout(() => {
        client.destroy()
      }, 2000).unref()
    }
  }

  private fail(session: Session, error: unknown): void {
    if (session.userClosed) return
    if (session.cancelled) {
      this.finish(session, 'closed')
      return
    }
    const code =
      session.forcedError ??
      mapConnectionError(error, {
        ...(session.hostKeyProblem === undefined ? {} : { hostKey: session.hostKeyProblem }),
        wasReady: session.wasReady,
      })
    this.finish(session, 'error', code)
  }

  private connect(session: Session): void {
    if (FINAL_STATES.has(session.state)) return
    this.options.log?.(`session ${session.id.slice(0, 8)} connecting`)
    if (!session.owner.isDestroyed()) {
      session.owner.send('session:state', { sessionId: session.id, state: 'connecting' })
    }
    void (async () => {
      const credential = session.credential
      if (credential.type === 'key' && credential.needsPassphrase === true) {
        const unlocked = await this.unlockKey(session, credential)
        if (unlocked === null) return
        session.credential = unlocked
      }
      this.connectClient(session)
    })()
  }

  /** Asks for a key's passphrase (three tries) and checks it locally. */
  private async unlockKey(
    session: Session,
    credential: Extract<Credential, { type: 'key' }>,
  ): Promise<Credential | null> {
    for (let attempt = 0; attempt < MAX_PASSWORD_ATTEMPTS; attempt++) {
      const answer = await this.options.prompts.ask(session.owner, {
        sessionId: session.id,
        kind: 'passphrase',
        keyName: credential.keyName,
        attempt,
      })
      if (FINAL_STATES.has(session.state)) return null
      if (answer?.kind !== 'passphrase' || answer.value === null) {
        session.cancelled = true
        this.finish(session, 'closed')
        return null
      }
      try {
        inspectPrivateKey(credential.privateKey, answer.value)
        return {
          type: 'key',
          privateKey: credential.privateKey,
          keyName: credential.keyName,
          passphrase: answer.value,
        }
      } catch {
        // Wrong passphrase: ask again.
      }
    }
    this.finish(session, 'error', 'KEY_PASSPHRASE_WRONG')
    return null
  }

  private connectClient(session: Session): void {
    if (FINAL_STATES.has(session.state)) return
    const { target, owner } = session

    const client = this.options.createClient?.() ?? new Client()
    session.client = client

    client.on('ready', () => {
      this.openShell(session, client)
    })
    client.on('error', (error) => {
      this.fail(session, error)
    })
    client.on('close', () => {
      if (FINAL_STATES.has(session.state)) return
      if (session.shellClosed || session.cancelled) this.finish(session, 'closed')
      else
        this.finish(
          session,
          'error',
          session.wasReady ? 'SSH_CONNECTION_LOST' : 'SSH_CONNECTION_CLOSED_BY_SERVER',
        )
    })

    const config: ConnectConfig = {
      host: target.address,
      port: target.port,
      username: target.username,
      readyTimeout: this.timing.readyTimeoutMs,
      keepaliveInterval: this.timing.keepaliveIntervalMs,
      keepaliveCountMax: this.timing.keepaliveCountMax,
      tryKeyboard: true,
      hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
        this.verifyHostKey(session, key, verify)
      },
      authHandler: createAuthHandler(target.username, session.credential, {
        askPassword: async (attempt) => {
          const answer = await this.options.prompts.ask(owner, {
            sessionId: session.id,
            kind: 'password',
            username: target.username,
            host: target.address,
            attempt,
          })
          return answer?.kind === 'password' ? answer.value : null
        },
        askKeyboard: async (name, instructions, prompts) => {
          const answer = await this.options.prompts.ask(owner, {
            sessionId: session.id,
            kind: 'keyboardInteractive',
            host: target.address,
            name,
            instructions,
            prompts,
          })
          return answer?.kind === 'keyboardInteractive' ? answer.values : null
        },
        onCancelled: () => {
          session.cancelled = true
        },
        onTry: (used) => {
          session.trying = used
        },
      }),
    }

    try {
      client.connect(config)
    } catch (error) {
      this.fail(session, error)
    }
  }

  private verifyHostKey(session: Session, key: Buffer, verify: (valid: boolean) => void): void {
    this.setState(session, 'verifying-host-key')
    const info = describeHostKey(session.target.address, session.target.port, key)
    session.hostKey = info
    const accept = (): void => {
      if (FINAL_STATES.has(session.state)) {
        verify(false)
        return
      }
      verify(true)
      this.setState(session, 'authenticating')
    }
    void (async () => {
      try {
        const check = await this.options.knownHosts.check(info)
        if (check.status === 'trusted') {
          accept()
          return
        }
        if (check.status === 'changed') {
          session.hostKeyProblem = 'changed'
          verify(false)
          return
        }
        const answer = await this.options.prompts.ask(session.owner, {
          sessionId: session.id,
          kind: 'hostKey',
          ...info,
        })
        if (answer?.kind === 'hostKey' && answer.trust) {
          await this.options.knownHosts.trust(info)
          accept()
        } else {
          session.hostKeyProblem = 'rejected'
          if (answer === null) session.cancelled = true
          verify(false)
        }
      } catch (error) {
        session.forcedError = error instanceof AppError ? error.code : 'SSH_FAILED'
        verify(false)
      }
    })()
  }

  private openShell(session: Session, client: Client): void {
    if (FINAL_STATES.has(session.state)) return
    client.shell(
      { term: 'xterm-256color', cols: session.cols, rows: session.rows, width: 0, height: 0 },
      (error, stream) => {
        if (error instanceof Error) {
          session.forcedError = 'SSH_SHELL_FAILED'
          this.fail(session, error)
          return
        }
        if (FINAL_STATES.has(session.state)) {
          stream.close()
          return
        }
        session.stream = stream
        session.wasReady = true
        session.used = session.trying ?? undefined
        session.trying = null
        // In case the window was resized while connecting.
        stream.setWindow(session.rows, session.cols, 0, 0)
        stream.on('data', (chunk: Buffer) => {
          this.enqueue(session, chunk)
        })
        stream.stderr.on('data', (chunk: Buffer) => {
          this.enqueue(session, chunk)
        })
        stream.on('close', () => {
          session.shellClosed = true
          this.flush(session)
          client.end()
        })
        this.setState(session, 'ready')
        if (session.target.hostId !== undefined) {
          this.options.onConnected?.(session.target.hostId)
        }
      },
    )
  }

  private enqueue(session: Session, chunk: Buffer): void {
    session.pending.push(chunk)
    session.pendingBytes += chunk.length
    if (session.pendingBytes >= this.timing.maxBatchBytes) {
      this.flush(session)
      return
    }
    session.timer ??= setTimeout(() => {
      this.flush(session)
    }, this.timing.flushIntervalMs)
  }

  private flush(session: Session): void {
    clearTimeout(session.timer)
    session.timer = undefined
    if (session.pendingBytes === 0) return
    // A fresh copy: a pooled Buffer's ArrayBuffer can hold unrelated bytes.
    const data = new Uint8Array(Buffer.concat(session.pending, session.pendingBytes))
    session.pending = []
    session.pendingBytes = 0
    if (session.owner.isDestroyed()) return
    session.owner.send('session:data', { sessionId: session.id, data })
    session.unacked += data.length
    if (!session.paused && session.unacked >= this.timing.highWaterBytes) {
      session.paused = true
      session.stream?.pause()
    }
  }
}
