import { randomUUID } from 'node:crypto'
import type { Duplex } from 'node:stream'
import { Client, type BaseAgent, type ClientChannel, type ConnectConfig } from 'ssh2'
import type { ErrorCode } from '@shared/errors'
import type {
  HostKeyInfo,
  SessionOpenResponse,
  SessionState,
  SessionStateEvent,
  SessionTarget,
} from '@shared/session'
import { AppError } from '../ipc/app-error'
import type { Agents } from '../keychain/agents'
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
import { openProxySocket, type ProxyConfig } from './proxy'
import { looksLikeSudoPrompt, SUDO_TAIL_BYTES } from './sudo'

/** One server on the way: a jump host or the target itself. */
export interface HopTarget extends SessionTarget {
  hostId?: string
  title: string
  credential: Credential
}

/** Everything needed to connect. Built in main from the vault or a Quick Connect string. */
export interface ConnectTarget extends HopTarget {
  /** Forward the local agent to the server (when one runs). */
  agentForward?: boolean
  /** Jump hosts in order: the first is reached from this computer. */
  via?: HopTarget[]
  /** Proxy for the connection from this computer (to the first jump host, or the target). */
  proxy?: ProxyConfig
  /** Typed into each new shell. */
  startupCommand?: string
  /** Run the shell inside tmux, so a dropped connection loses nothing. */
  stickySession?: boolean
}

/** What runCommand returns. The output is capped at MAX_COMMAND_OUTPUT bytes. */
export interface CommandResult {
  exitCode: number | null
  output: string
}

export const MAX_COMMAND_OUTPUT = 64 * 1024

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
  /** Waits between reconnect attempts; the last one repeats. */
  reconnectDelaysMs: readonly number[]
}

export const DEFAULT_TIMING: SessionTiming = {
  readyTimeoutMs: 20_000,
  keepaliveIntervalMs: 10_000,
  keepaliveCountMax: 3,
  flushIntervalMs: 8,
  maxBatchBytes: 256 * 1024,
  highWaterBytes: 1024 * 1024,
  lowWaterBytes: 256 * 1024,
  reconnectDelaysMs: [1000, 2000, 5000, 10_000, 30_000],
}

export const MAX_SESSIONS_PER_WINDOW = 64

/** Failures worth another try: the network or the server is away, not a refusal. */
const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'SSH_HOST_NOT_FOUND',
  'SSH_CONNECTION_REFUSED',
  'SSH_NETWORK_UNREACHABLE',
  'SSH_TIMEOUT',
  'SSH_CONNECTION_CLOSED_BY_SERVER',
  'SSH_CONNECTION_LOST',
  'SSH_FAILED',
  'PROXY_UNREACHABLE',
  'PROXY_REFUSED',
  'JUMP_FORWARD_FAILED',
])

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
  /** Agent sign-in and forwarding. Without it, agent sign-in fails with AGENT_UNAVAILABLE. */
  agents?: Pick<Agents, 'forSignIn' | 'forForwarding'>
  createClient?: () => Client
  timing?: Partial<SessionTiming>
}

export type SessionOpenRequest =
  | { hostId: string; cols: number; rows: number }
  | { quick: string; cols: number; rows: number }
  | { target: ConnectTarget; cols: number; rows: number }

const FINAL_STATES: ReadonlySet<SessionState> = new Set(['closed', 'error'])

/** One server on a link, with what was learned while connecting to it. */
class Hop {
  credential: Credential
  /** The credential being tried; becomes `used` once signed in. */
  trying: UsedCredential | null = null
  used: UsedCredential | undefined
  hostKey: HostKeyInfo | undefined
  hostKeyProblem: 'changed' | 'rejected' | undefined
  forcedError: ErrorCode | undefined

  constructor(
    readonly target: HopTarget,
    readonly last: boolean,
  ) {
    this.credential = target.credential
  }
}

/** Why a link failed, and on which server. */
class LinkFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly hop: Hop | undefined,
    readonly cancelled = false,
  ) {
    super(code)
  }
}

/**
 * One SSH connection (through its proxy and jump hosts) shared by one or more
 * sessions. It reconnects by itself when a ready connection drops.
 */
class Link {
  readonly id = randomUUID()
  state: 'connecting' | 'ready' | 'reconnecting' | 'closed' = 'connecting'
  readonly sessions = new Set<Session>()
  readonly hops: Hop[]
  clients: Client[] = []
  sockets: Duplex[] = []
  client: Client | undefined
  agent: BaseAgent | undefined
  forwardAgent = false
  prepared = false
  wasReady = false
  attempt = 0
  retryTimer: NodeJS.Timeout | undefined
  cancelled = false

  constructor(
    readonly owner: EventSink,
    readonly target: ConnectTarget,
    /** runCommand: try only the given credential on the target, and never reconnect. */
    readonly strict: boolean,
  ) {
    const via = target.via ?? []
    this.hops = [...via.map((hop) => new Hop(hop, false)), new Hop(target, true)]
  }

  get final(): Hop {
    const hop = this.hops.at(-1)
    if (hop === undefined) throw new Error('A link always has its target')
    return hop
  }

  /** Reads the state anew: it may change while an await is pending (a tab closed). */
  is(state: Link['state']): boolean {
    return this.state === state
  }

  liveSessions(): Session[] {
    return [...this.sessions].filter((session) => !FINAL_STATES.has(session.state))
  }
}

class Session {
  state: SessionState = 'connecting'
  stream: ClientChannel | undefined
  pending: Buffer[] = []
  pendingBytes = 0
  timer: NodeJS.Timeout | undefined
  unacked = 0
  paused = false
  userClosed = false
  /** The server reported the shell's exit: a closed channel is the end, not a drop. */
  shellExited = false
  /** The last output, to spot a sudo password prompt. */
  tail = ''
  sudoPrompt = false
  /** runCommand: no terminal, no events to the renderer (prompts still go to the window). */
  exec:
    | {
        command: string
        output: Buffer[]
        bytes: number
        settled: boolean
        resolve: (result: CommandResult) => void
        reject: (error: AppError) => void
      }
    | undefined

  constructor(
    readonly id: string,
    readonly owner: EventSink,
    readonly link: Link,
    public cols: number,
    public rows: number,
    /** tmux session name for a sticky session. */
    readonly stickyName: string | undefined,
  ) {}
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
    this.checkLimit(owner)
    const target = await this.resolve(request)
    const link = new Link(owner, target, false)
    const session = this.addSession(owner, link, request.cols, request.rows)
    // Answer the renderer first, then start; events for this id may follow right away.
    setImmediate(() => {
      this.sendState(session, { state: 'connecting' })
      void this.startLink(link)
    })
    return this.describe(session)
  }

  /** A new tab on the connection of an open one: a new channel, no new sign-in. */
  duplicate(owner: EventSink, sessionId: string, cols: number, rows: number): SessionOpenResponse {
    const source = this.owned(owner, sessionId)
    const link = source.link
    if (link.state === 'closed' || link.strict) throw new AppError('SESSION_NOT_FOUND')
    this.checkLimit(owner)
    const session = this.addSession(owner, link, cols, rows)
    setImmediate(() => {
      if (link.state === 'ready' && link.client !== undefined) {
        this.sendState(session, { state: 'connecting' })
        this.openChannel(session, link.client)
      } else if (link.state === 'reconnecting') {
        session.state = 'reconnecting'
        this.sendState(session, {
          state: 'reconnecting',
          reconnect: { attempt: link.attempt, retryAt: Date.now() },
        })
      } else {
        this.sendState(session, { state: 'connecting' })
      }
    })
    return this.describe(session)
  }

  private checkLimit(owner: EventSink): void {
    const owned = [...this.sessions.values()].filter((s) => s.owner.id === owner.id).length
    if (owned >= MAX_SESSIONS_PER_WINDOW) throw new AppError('SESSION_LIMIT')
  }

  private addSession(owner: EventSink, link: Link, cols: number, rows: number): Session {
    const session = new Session(randomUUID(), owner, link, cols, rows, this.stickyName(link))
    link.sessions.add(session)
    this.sessions.set(session.id, session)
    return session
  }

  /** kelidar-<host id prefix>, then -2, -3… for more tabs on the same host. */
  private stickyName(link: Link): string | undefined {
    const hostId = link.target.hostId
    if (link.target.stickySession !== true || hostId === undefined || link.strict) return undefined
    const base = `kelidar-${hostId.replaceAll('-', '').slice(0, 8)}`
    const taken = new Set(
      [...this.sessions.values()]
        .filter((s) => s.link.target.hostId === hostId && !FINAL_STATES.has(s.state))
        .map((s) => s.stickyName),
    )
    for (let n = 1; ; n++) {
      const name = n === 1 ? base : `${base}-${String(n)}`
      if (!taken.has(name)) return name
    }
  }

  private describe(session: Session): SessionOpenResponse {
    const target = session.link.target
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

  /**
   * The sudo hotkey: types the session's sign-in password, followed by Enter,
   * but only while the output ends with a sudo password prompt (input not
   * echoed), so the password cannot land on the screen.
   */
  fillSudo(owner: EventSink, sessionId: string): void {
    const session = this.owned(owner, sessionId)
    const stream = session.stream
    if (session.state !== 'ready' || stream === undefined || !session.sudoPrompt) {
      throw new AppError('SUDO_NO_PROMPT')
    }
    const password = this.signInPassword(session)
    if (password === undefined) throw new AppError('SUDO_NO_PASSWORD')
    stream.write(`${password}\r`)
    session.tail = ''
    this.setSudoPrompt(session, false)
  }

  /** The password the session signed in with (saved, or typed when asked). */
  private signInPassword(session: Session): string | undefined {
    const final = session.link.final
    if (final.used?.type === 'password') return final.used.password
    return final.credential.type === 'password' ? final.credential.password : undefined
  }

  private setSudoPrompt(session: Session, prompt: boolean): void {
    if (session.sudoPrompt === prompt) return
    session.sudoPrompt = prompt
    if (session.owner.isDestroyed() || session.exec !== undefined) return
    session.owner.send('session:sudo', {
      sessionId: session.id,
      prompt,
      canFill: this.signInPassword(session) !== undefined,
    })
  }

  /** While reconnecting: try now instead of waiting. */
  reconnectNow(owner: EventSink, sessionId: string): void {
    const link = this.owned(owner, sessionId).link
    if (link.state !== 'reconnecting') return
    clearTimeout(link.retryTimer)
    void this.reconnect(link)
  }

  /** Ends the session (the tab was closed); the connection ends with its last session. */
  close(owner: EventSink, sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session?.owner.id !== owner.id) return
    session.userClosed = true
    this.finishSession(session, 'closed')
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
    return this.owned(owner, sessionId).link.final.used
  }

  target(owner: EventSink, sessionId: string): ConnectTarget {
    return this.owned(owner, sessionId).link.target
  }

  private owned(owner: EventSink, sessionId: string): Session {
    const session = this.sessions.get(sessionId)
    if (session?.owner.id !== owner.id) throw new AppError('SESSION_NOT_FOUND')
    return session
  }

  // --- State ---------------------------------------------------------------

  private sendState(session: Session, event: Omit<SessionStateEvent, 'sessionId'>): void {
    this.options.log?.(
      `session ${session.id.slice(0, 8)} ${event.state}${event.error === undefined ? '' : ` ${event.error}`}`,
    )
    if (session.owner.isDestroyed() || session.exec !== undefined) return
    session.owner.send('session:state', { sessionId: session.id, ...event })
  }

  private setState(
    session: Session,
    state: SessionState,
    extra: Omit<SessionStateEvent, 'sessionId' | 'state'> = {},
  ): void {
    if (FINAL_STATES.has(session.state)) return
    if (session.state === state && state !== 'reconnecting') return
    session.state = state
    this.sendState(session, { state, ...extra })
  }

  /** Connection phases for the target, shown on every session of a first connect. */
  private setPhase(link: Link, state: 'verifying-host-key' | 'authenticating'): void {
    if (link.wasReady) return
    for (const session of link.liveSessions()) this.setState(session, state)
  }

  /** Moves a session to a final state once, and ends its link when it was the last. */
  private finishSession(
    session: Session,
    state: 'closed' | 'error',
    error?: ErrorCode,
    extra: Omit<SessionStateEvent, 'sessionId' | 'state' | 'error'> = {},
  ): void {
    if (!FINAL_STATES.has(session.state)) {
      this.flush(session)
      if (state === 'error')
        this.setState(session, 'error', { error: error ?? 'SSH_FAILED', ...extra })
      else this.setState(session, 'closed')
      if (session.exec !== undefined && !session.exec.settled) {
        session.exec.settled = true
        session.exec.reject(
          new AppError(state === 'error' ? (error ?? 'SSH_FAILED') : 'OPERATION_CANCELLED'),
        )
      }
    }
    clearTimeout(session.timer)
    session.timer = undefined
    session.pending = []
    session.pendingBytes = 0
    const stream = session.stream
    session.stream = undefined
    stream?.close()
    this.sessions.delete(session.id)
    const link = session.link
    link.sessions.delete(session)
    if (link.sessions.size === 0) this.endLink(link)
  }

  // --- Connecting ----------------------------------------------------------

  private async startLink(link: Link): Promise<void> {
    try {
      await this.prepare(link)
      const client = await this.establish(link)
      this.onLinkReady(link, client)
    } catch (error) {
      this.onLinkFailed(link, error)
    }
  }

  /** Agents and key passphrases, once per link. */
  private async prepare(link: Link): Promise<void> {
    if (link.prepared) return
    if (link.hops.some((hop) => hop.credential.type === 'agent')) {
      if (this.options.agents === undefined) throw new LinkFailure('AGENT_UNAVAILABLE', undefined)
      link.agent = await this.options.agents.forSignIn()
    }
    if (link.target.agentForward === true && !link.strict) {
      link.agent ??= await this.options.agents?.forForwarding()
      link.forwardAgent = link.agent !== undefined
    }
    for (const hop of link.hops) {
      const credential = hop.credential
      if (credential.type === 'key' && credential.needsPassphrase === true) {
        hop.credential = await this.unlockKey(link, hop, credential)
      }
    }
    link.prepared = true
  }

  /** Asks for a key's passphrase (three tries) and checks it locally. */
  private async unlockKey(
    link: Link,
    hop: Hop,
    credential: Extract<Credential, { type: 'key' }>,
  ): Promise<Credential> {
    for (let attempt = 0; attempt < MAX_PASSWORD_ATTEMPTS; attempt++) {
      const answer = await this.options.prompts.ask(link.owner, {
        sessionId: link.id,
        kind: 'passphrase',
        keyName: credential.keyName,
        attempt,
      })
      if (link.state === 'closed' || answer?.kind !== 'passphrase' || answer.value === null) {
        throw new LinkFailure('OPERATION_CANCELLED', hop, true)
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
    throw new LinkFailure('KEY_PASSPHRASE_WRONG', hop)
  }

  /** Proxy, then each jump host, then the target. Resolves with the target's client. */
  private async establish(link: Link): Promise<Client> {
    this.endClients(link)
    let sock: Duplex | undefined
    const first = link.hops[0] ?? link.final
    if (link.target.proxy !== undefined) {
      try {
        sock = await openProxySocket(
          link.target.proxy,
          first.target.address,
          first.target.port,
          this.timing.readyTimeoutMs,
        )
      } catch (error) {
        throw new LinkFailure(
          error instanceof AppError ? error.code : 'PROXY_REFUSED',
          link.hops.length > 1 ? first : undefined,
        )
      }
      link.sockets.push(sock)
    }
    let client: Client | undefined
    for (const [index, hop] of link.hops.entries()) {
      client = await this.connectHop(link, hop, sock)
      link.clients.push(client)
      const next = link.hops[index + 1]
      if (next !== undefined) sock = await this.forward(client, hop, next)
    }
    if (client === undefined) throw new LinkFailure('SSH_FAILED', undefined)
    return client
  }

  /** A TCP channel from a jump host to the next server, used as that server's socket. */
  private forward(client: Client, hop: Hop, next: Hop): Promise<Duplex> {
    return new Promise((resolve, reject) => {
      try {
        client.forwardOut(
          '127.0.0.1',
          0,
          next.target.address,
          next.target.port,
          (error, stream) => {
            if (error instanceof Error) reject(new LinkFailure('JUMP_FORWARD_FAILED', hop))
            else resolve(stream)
          },
        )
      } catch {
        // ssh2 throws "Not connected" when the jump host just went away.
        reject(new LinkFailure('SSH_CONNECTION_LOST', hop))
      }
    })
  }

  private connectHop(link: Link, hop: Hop, sock: Duplex | undefined): Promise<Client> {
    const client = this.options.createClient?.() ?? new Client()
    const target = hop.target
    return new Promise<Client>((resolve, reject) => {
      let settled = false
      const failure = (error: unknown): LinkFailure => {
        if (link.cancelled || link.state === 'closed') {
          return new LinkFailure('OPERATION_CANCELLED', hop, true)
        }
        const code =
          hop.forcedError ??
          mapConnectionError(error, {
            ...(hop.hostKeyProblem === undefined ? {} : { hostKey: hop.hostKeyProblem }),
            wasReady: false,
          })
        return new LinkFailure(code, hop)
      }
      client.on('ready', () => {
        settled = true
        hop.used = hop.trying ?? undefined
        hop.trying = null
        // Reconnects sign in the same way without asking again.
        if (hop.used !== undefined) hop.credential = hop.used
        resolve(client)
      })
      client.on('error', (error) => {
        if (!settled) {
          settled = true
          reject(failure(error))
        }
      })
      client.on('close', () => {
        if (!settled) {
          settled = true
          reject(failure(new Error('Connection lost before handshake')))
        }
      })

      const config: ConnectConfig = {
        ...(sock === undefined ? { host: target.address, port: target.port } : { sock }),
        username: target.username,
        readyTimeout: this.timing.readyTimeoutMs,
        keepaliveInterval: this.timing.keepaliveIntervalMs,
        keepaliveCountMax: this.timing.keepaliveCountMax,
        tryKeyboard: true,
        ...(link.agent === undefined ? {} : { agent: link.agent }),
        ...(hop.last && link.forwardAgent ? { agentForward: true } : {}),
        hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
          this.verifyHostKey(link, hop, key, verify)
        },
        authHandler: createAuthHandler(
          target.username,
          hop.credential,
          {
            askPassword: async (attempt) => {
              const answer = await this.options.prompts.ask(link.owner, {
                sessionId: link.id,
                kind: 'password',
                username: target.username,
                host: target.address,
                attempt,
              })
              return answer?.kind === 'password' ? answer.value : null
            },
            askKeyboard: async (name, instructions, prompts) => {
              const answer = await this.options.prompts.ask(link.owner, {
                sessionId: link.id,
                kind: 'keyboardInteractive',
                host: target.address,
                name,
                instructions,
                prompts,
              })
              return answer?.kind === 'keyboardInteractive' ? answer.values : null
            },
            onCancelled: () => {
              link.cancelled = true
            },
            onTry: (used) => {
              hop.trying = used
            },
          },
          { agent: link.agent, strict: link.strict && hop.last },
        ),
      }
      try {
        client.connect(config)
      } catch (error) {
        settled = true
        reject(failure(error))
      }
    })
  }

  private verifyHostKey(link: Link, hop: Hop, key: Buffer, verify: (valid: boolean) => void): void {
    if (hop.last) this.setPhase(link, 'verifying-host-key')
    const info = describeHostKey(hop.target.address, hop.target.port, key)
    hop.hostKey = info
    const accept = (): void => {
      if (link.state === 'closed') {
        verify(false)
        return
      }
      verify(true)
      if (hop.last) this.setPhase(link, 'authenticating')
    }
    void (async () => {
      try {
        const check = await this.options.knownHosts.check(info)
        if (check.status === 'trusted') {
          accept()
          return
        }
        if (check.status === 'changed') {
          hop.hostKeyProblem = 'changed'
          verify(false)
          return
        }
        const answer = await this.options.prompts.ask(link.owner, {
          sessionId: link.id,
          kind: 'hostKey',
          ...info,
        })
        if (answer?.kind === 'hostKey' && answer.trust) {
          await this.options.knownHosts.trust(info)
          accept()
        } else {
          hop.hostKeyProblem = 'rejected'
          if (answer === null) link.cancelled = true
          verify(false)
        }
      } catch (error) {
        hop.forcedError = error instanceof AppError ? error.code : 'SSH_FAILED'
        verify(false)
      }
    })()
  }

  private onLinkReady(link: Link, client: Client): void {
    if (link.state === 'closed' || link.sessions.size === 0) {
      this.endClients(link)
      return
    }
    link.client = client
    link.state = 'ready'
    link.wasReady = true
    link.attempt = 0
    client.on('close', () => {
      this.onLinkDropped(link, client)
    })
    for (const session of link.liveSessions()) this.openChannel(session, client)
  }

  private onLinkFailed(link: Link, error: unknown): void {
    const failure =
      error instanceof LinkFailure
        ? error
        : new LinkFailure(error instanceof AppError ? error.code : 'SSH_FAILED', undefined)
    if (link.state === 'closed') return
    if (failure.cancelled || link.cancelled) {
      for (const session of link.liveSessions()) this.finishSession(session, 'closed')
      this.endLink(link)
      return
    }
    if (link.state === 'reconnecting' && RETRYABLE.has(failure.code)) {
      this.scheduleReconnect(link)
      return
    }
    const hop = failure.hop
    const hostKeyError =
      failure.code === 'SSH_HOST_KEY_CHANGED' || failure.code === 'SSH_HOST_KEY_REJECTED'
    for (const session of link.liveSessions()) {
      this.finishSession(session, 'error', failure.code, {
        ...(hop !== undefined && !hop.last ? { via: hop.target.title } : {}),
        ...(hostKeyError && hop?.hostKey !== undefined ? { hostKey: hop.hostKey } : {}),
      })
    }
    this.endLink(link)
  }

  /** The ready connection is gone: reconnect, unless nobody needs it any more. */
  private onLinkDropped(link: Link, client: Client): void {
    if (link.client !== client || link.state !== 'ready') return
    link.client = undefined
    const live = link.liveSessions()
    if (live.length === 0) {
      this.endLink(link)
      return
    }
    if (link.strict) {
      for (const session of live) this.finishSession(session, 'error', 'SSH_CONNECTION_LOST')
      return
    }
    for (const session of live) {
      this.flush(session)
      session.stream = undefined
    }
    this.scheduleReconnect(link)
  }

  private scheduleReconnect(link: Link): void {
    this.endClients(link)
    link.state = 'reconnecting'
    link.attempt += 1
    const delays = this.timing.reconnectDelaysMs
    const delay = delays[Math.min(link.attempt - 1, delays.length - 1)] ?? 30_000
    const retryAt = Date.now() + delay
    for (const session of link.liveSessions()) {
      this.setState(session, 'reconnecting', { reconnect: { attempt: link.attempt, retryAt } })
    }
    clearTimeout(link.retryTimer)
    link.retryTimer = setTimeout(() => {
      void this.reconnect(link)
    }, delay)
  }

  private async reconnect(link: Link): Promise<void> {
    if (link.state !== 'reconnecting') return
    clearTimeout(link.retryTimer)
    try {
      const client = await this.establish(link)
      if (!link.is('reconnecting')) {
        client.end()
        return
      }
      this.onLinkReady(link, client)
    } catch (error) {
      this.onLinkFailed(link, error)
    }
  }

  private endLink(link: Link): void {
    if (link.state === 'closed') return
    link.state = 'closed'
    clearTimeout(link.retryTimer)
    this.options.prompts.cancelSession(link.id)
    link.client = undefined
    this.endClients(link)
  }

  private endClients(link: Link): void {
    for (const client of link.clients.reverse()) {
      client.end()
      // If the server never answers the disconnect, drop the socket.
      setTimeout(() => {
        client.destroy()
      }, 2000).unref()
    }
    for (const socket of link.sockets) socket.destroy()
    link.clients = []
    link.sockets = []
  }

  // --- Channels ------------------------------------------------------------

  private openChannel(session: Session, client: Client): void {
    if (!this.waitsForChannel(session, client)) return
    if (session.exec !== undefined) this.runExec(session, client)
    else if (session.stickyName !== undefined) this.openSticky(session, client, session.stickyName)
    else this.openShell(session, client, undefined)
  }

  /**
   * A channel is only opened, or its failure reported, while the session still
   * waits for one on this connection. The tab may have closed meanwhile (the
   * connection ended), or the connection may have dropped (the link
   * reconnects and opens a new channel then).
   */
  private waitsForChannel(session: Session, client: Client): boolean {
    return (
      !FINAL_STATES.has(session.state) && session.link.is('ready') && session.link.client === client
    )
  }

  /**
   * Runs one of ssh2's channel calls, which throw "Not connected" when the
   * socket is already gone, instead of reporting through the callback.
   */
  private tryChannel(session: Session, client: Client, open: () => void): void {
    try {
      open()
    } catch {
      if (this.waitsForChannel(session, client)) {
        this.finishSession(session, 'error', 'SSH_SHELL_FAILED')
      }
    }
  }

  private openShell(session: Session, client: Client, sticky: 'unavailable' | undefined): void {
    this.tryChannel(session, client, () => {
      client.shell(
        { term: 'xterm-256color', cols: session.cols, rows: session.rows, width: 0, height: 0 },
        (error, stream) => {
          this.attach(session, client, error, stream, sticky)
        },
      )
    })
  }

  /**
   * Sticky session: checks for tmux, then starts the shell inside
   * `tmux new-session -A -s <name>`, which resumes the session when it exists.
   * Without tmux, a normal shell opens and the tab explains how to install it.
   */
  private openSticky(session: Session, client: Client, name: string): void {
    const probe = `command -v tmux >/dev/null 2>&1 || exit 127; tmux has-session -t ${name} 2>/dev/null && exit 3; exit 0`
    this.tryChannel(session, client, () => {
      client.exec(probe, (error, stream) => {
        if (!this.waitsForChannel(session, client)) return
        if (error instanceof Error) {
          this.openShell(session, client, 'unavailable')
          return
        }
        let code: number | null = null
        stream.on('exit', (exitCode: number | null) => {
          code = exitCode
        })
        stream.resume()
        stream.on('close', () => {
          if (!this.waitsForChannel(session, client)) return
          if (code !== 0 && code !== 3) {
            this.openShell(session, client, 'unavailable')
            return
          }
          const pty = {
            term: 'xterm-256color',
            cols: session.cols,
            rows: session.rows,
            width: 0,
            height: 0,
          }
          this.tryChannel(session, client, () => {
            client.exec(`tmux new-session -A -s ${name}`, { pty }, (execError, shell) => {
              this.attach(session, client, execError, shell, code === 3 ? 'resumed' : 'started')
            })
          })
        })
      })
    })
  }

  private attach(
    session: Session,
    client: Client,
    error: Error | undefined,
    stream: ClientChannel,
    sticky: 'started' | 'resumed' | 'unavailable' | undefined,
  ): void {
    if (!this.waitsForChannel(session, client)) {
      if (!(error instanceof Error)) stream.close()
      return
    }
    if (error instanceof Error) {
      this.finishSession(session, 'error', 'SSH_SHELL_FAILED')
      return
    }
    const link = session.link
    session.stream = stream
    session.shellExited = false
    // In case the window was resized while connecting.
    stream.setWindow(session.rows, session.cols, 0, 0)
    if (session.paused) stream.pause()
    stream.on('data', (chunk: Buffer) => {
      this.enqueue(session, chunk)
    })
    stream.stderr.on('data', (chunk: Buffer) => {
      this.enqueue(session, chunk)
    })
    stream.on('exit', () => {
      session.shellExited = true
    })
    stream.on('close', () => {
      if (session.stream !== stream) return
      this.flush(session)
      // A dropped connection closes its channels too; the link handles that.
      if (link.state !== 'ready' && !session.shellExited) return
      session.stream = undefined
      this.finishSession(session, 'closed')
    })
    this.setState(session, 'ready', sticky === undefined ? {} : { sticky })
    const startup = link.target.startupCommand
    if (startup !== undefined && startup !== '' && sticky !== 'resumed') {
      stream.write(`${startup}\r`)
    }
    if (link.target.hostId !== undefined) this.options.onConnected?.(link.target.hostId)
  }

  /** runCommand: one command over an exec channel, its output collected in main. */
  private runExec(session: Session, client: Client): void {
    const exec = session.exec
    if (exec === undefined) return
    this.tryChannel(session, client, () => {
      this.execCommand(session, client, exec)
    })
  }

  private execCommand(session: Session, client: Client, exec: NonNullable<Session['exec']>): void {
    client.exec(exec.command, (error, stream) => {
      if (!this.waitsForChannel(session, client)) return
      if (error instanceof Error) {
        this.finishSession(session, 'error', 'SSH_SHELL_FAILED')
        return
      }
      this.setState(session, 'ready')
      let exitCode: number | null = null
      const collect = (chunk: Buffer): void => {
        if (exec.bytes >= MAX_COMMAND_OUTPUT) return
        const piece = chunk.subarray(0, MAX_COMMAND_OUTPUT - exec.bytes)
        exec.output.push(piece)
        exec.bytes += piece.length
      }
      stream.on('data', collect)
      stream.stderr.on('data', collect)
      stream.on('exit', (code: number | null) => {
        exitCode = code
      })
      stream.on('close', () => {
        if (!exec.settled) {
          exec.settled = true
          exec.resolve({ exitCode, output: Buffer.concat(exec.output).toString('utf8') })
        }
        this.finishSession(session, 'closed')
      })
    })
  }

  /**
   * Connects, runs one command and disconnects, with the same proxy, jump
   * hosts, host key checks and sign-in questions as a terminal session.
   * `strict`: sign in to the target with its credential only.
   */
  runCommand(
    owner: EventSink,
    target: ConnectTarget,
    command: string,
    options: { strict?: boolean } = {},
  ): Promise<CommandResult> {
    const link = new Link(owner, target, options.strict === true)
    const session = new Session(randomUUID(), owner, link, 80, 24, undefined)
    link.sessions.add(session)
    this.sessions.set(session.id, session)
    const result = new Promise<CommandResult>((resolve, reject) => {
      session.exec = { command, output: [], bytes: 0, settled: false, resolve, reject }
    })
    setImmediate(() => {
      void this.startLink(link)
    })
    return result
  }

  // --- Output --------------------------------------------------------------

  private enqueue(session: Session, chunk: Buffer): void {
    session.tail = (session.tail + chunk.toString('utf8')).slice(-SUDO_TAIL_BYTES)
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
    this.setSudoPrompt(session, looksLikeSudoPrompt(session.tail))
    session.unacked += data.length
    if (!session.paused && session.unacked >= this.timing.highWaterBytes) {
      session.paused = true
      session.stream?.pause()
    }
  }
}
