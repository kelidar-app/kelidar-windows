import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { GroupService } from '../../../src/main/hosts/group-service'
import { HostService } from '../../../src/main/hosts/host-service'
import { KeyUpgrades } from '../../../src/main/hosts/key-upgrade'
import { Agents } from '../../../src/main/keychain/agents'
import { IdentityService } from '../../../src/main/keychain/identity-service'
import { KeyService } from '../../../src/main/keychain/key-service'
import { registerKeychainHandlers } from '../../../src/main/ipc/keychain-handlers'
import { countAgentKeys, openSshAgent } from '../../../src/main/platform/agent'
import { KeyFileImports } from '../../../src/main/hosts/key-files'
import { registerHostHandlers } from '../../../src/main/ipc/host-handlers'
import { createIpcRouter, type InvokeEventLike } from '../../../src/main/ipc/router'
import { createSenderCheck, type FrameLike } from '../../../src/main/ipc/sender'
import type { EventSink } from '../../../src/main/ssh/event-sink'
import { KnownHosts } from '../../../src/main/ssh/host-keys'
import { PromptBroker } from '../../../src/main/ssh/prompts'
import { quickConnectTarget } from '../../../src/main/ssh/quick-target'
import { SessionManager, type SessionTiming } from '../../../src/main/ssh/session-manager'
import { registerSessionHandlers } from '../../../src/main/ipc/session-handlers'
import { VaultService } from '../../../src/main/vault/service'
import { Vault } from '../../../src/main/vault/vault'
import { APP_ORIGIN } from '../../../src/shared/app'
import type { IpcEventPayloads } from '../../../src/shared/ipc'
import type { IpcEvent } from '../../../src/shared/ipc-events'
import { fakeWrapper } from '../../unit/helpers/fake-wrapper'

export type RecordedEvent = {
  [E in IpcEvent]: { event: E; payload: IpcEventPayloads[E] }
}[IpcEvent]

/** Stands in for a window's WebContents and records everything sent to it. */
export class FakeSink implements EventSink {
  readonly events: RecordedEvent[] = []
  destroyed = false
  private readonly listeners: ((event: RecordedEvent) => void)[] = []

  constructor(readonly id: number) {}

  send<E extends IpcEvent>(event: E, payload: IpcEventPayloads[E]): void {
    const record = { event, payload } as RecordedEvent
    this.events.push(record)
    for (const listener of this.listeners) listener(record)
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  onEvent(listener: (event: RecordedEvent) => void): void {
    this.listeners.push(listener)
  }

  /** All terminal output of a session so far, as text. */
  output(sessionId: string): string {
    return Buffer.concat(
      this.events.flatMap((e) =>
        e.event === 'session:data' && e.payload.sessionId === sessionId ? [e.payload.data] : [],
      ),
    ).toString('utf8')
  }

  states(sessionId: string): IpcEventPayloads['session:state'][] {
    return this.events.flatMap((e) =>
      e.event === 'session:state' && e.payload.sessionId === sessionId ? [e.payload] : [],
    )
  }

  prompts(): IpcEventPayloads['prompt:request'][] {
    return this.events.flatMap((e) => (e.event === 'prompt:request' ? [e.payload] : []))
  }
}

interface FakeInvokeEvent extends InvokeEventLike {
  sink: FakeSink
}

export async function waitFor<T>(
  check: () => T | undefined | false,
  { timeout = 10_000, label = 'condition' } = {},
): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = check()
    if (value !== undefined && value !== false) return value
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/**
 * The real main-process services and IPC handlers, wired to a fake ipcMain
 * and fake windows. Only Electron itself is missing.
 */
export async function createHarness(
  options: {
    timing?: Partial<SessionTiming>
    keyFile?: () => string | null
    /** Home folder for Quick Connect's -i paths; the temp folder by default. */
    homeDir?: string
    /** Named pipe of a test agent; agent sign-in finds no agent when omitted. */
    agentPipe?: string
  } = {},
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kelidar-it-'))
  const logs: string[] = []
  const responses: unknown[] = []
  const vaults = new VaultService(() => Vault.open({ directory: dir, wrapper: fakeWrapper() }))
  const keyFiles = new KeyFileImports()
  const hosts = new HostService(vaults, keyFiles)
  const groups = new GroupService(vaults)
  const keys = new KeyService(vaults, keyFiles)
  const identities = new IdentityService(vaults, keyFiles)
  const noAgentPipe = '\\\\.\\pipe\\kelidar-no-agent-here'
  const agents = new Agents(
    {
      openssh: () => openSshAgent(options.agentPipe ?? noAgentPipe),
      // Pageant is never running in tests.
      pageant: () => openSshAgent(noAgentPipe),
      count: (agent) => countAgentKeys(agent, 1000),
    },
    () => 'auto',
  )
  const prompts = new PromptBroker()
  const knownHosts = new KnownHosts(vaults)
  const sessions = new SessionManager({
    resolveHost: (id) => hosts.connectTarget(id),
    resolveQuick: (input) => quickConnectTarget(input, options.homeDir ?? dir),
    knownHosts,
    prompts,
    log: (message) => logs.push(message),
    agents,
    onConnected: (hostId) => {
      void hosts.markConnected(hostId)
    },
    ...(options.timing === undefined ? {} : { timing: options.timing }),
  })

  const listeners = new Map<string, (event: FakeInvokeEvent, ...args: unknown[]) => unknown>()
  const router = createIpcRouter<FakeInvokeEvent>(
    {
      handle: (channel, listener) => {
        listeners.set(channel, listener)
      },
    },
    {
      isTrustedSender: createSenderCheck([APP_ORIGIN]),
      onInternalError: (channel, error) => {
        logs.push(`internal error on ${channel}: ${String(error)}`)
      },
    },
  )
  registerHostHandlers(router, {
    hosts,
    groups,
    keyFiles,
    chooseKeyFile: () => Promise.resolve(options.keyFile?.() ?? null),
    sessionCredential: (event, sessionId) => sessions.usedCredential(event.sink, sessionId),
  })
  registerKeychainHandlers(router, {
    keys,
    identities,
    agents,
    upgrades: new KeyUpgrades({
      vaults,
      hosts,
      keys,
      runCommand: (owner, target, command, runOptions) =>
        sessions.runCommand(owner, target, command, runOptions),
    }),
    ownerOf: (event) => event.sink,
  })
  registerSessionHandlers(router, {
    sessions,
    prompts,
    knownHosts,
    ownerOf: (event) => event.sink,
  })

  const sink = new FakeSink(1)
  const frame: FrameLike = { url: `${APP_ORIGIN}/index.html`, parent: null }

  /** Calls a channel exactly as the renderer would, and records the response. */
  const invoke = async (channel: string, payload?: unknown, from: FakeSink = sink) => {
    const listener = listeners.get(channel)
    if (listener === undefined) throw new Error(`no handler for ${channel}`)
    const args = payload === undefined ? [] : [payload]
    const result = (await listener({ senderFrame: frame, sink: from }, ...args)) as
      { ok: true; data: unknown } | { ok: false; error: { code: string } }
    responses.push(result)
    return result
  }

  /** Like invoke, but fails the test on an error result. */
  const call = async <T>(channel: string, payload?: unknown, from: FakeSink = sink): Promise<T> => {
    const result = await invoke(channel, payload, from)
    if (!result.ok) throw new Error(`${channel} failed with ${result.error.code}`)
    return result.data as T
  }

  return {
    dir,
    logs,
    responses,
    sink,
    vaults,
    knownHosts,
    sessions,
    invoke,
    call,
    close: async () => {
      sessions.closeAll()
      await vaults.flush()
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    },
  }
}

export type Harness = Awaited<ReturnType<typeof createHarness>>
