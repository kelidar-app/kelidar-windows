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
import { parseOsRelease } from '../../../src/main/hosts/os-release'
import { HostImports, type ImportSourcesDeps } from '../../../src/main/importers/import-service'
import { registerImportHandlers } from '../../../src/main/ipc/import-handlers'
import { registerSecurityHandlers } from '../../../src/main/ipc/security-handlers'
import { registerUpdateHandlers } from '../../../src/main/ipc/update-handlers'
import { UpdateService, type UpdaterLike } from '../../../src/main/updates/update-service'
import { OS_RELEASE_COMMAND } from '../../../src/shared/host-extras'
import { registerSessionHandlers } from '../../../src/main/ipc/session-handlers'
import { SecretClipboard } from '../../../src/main/security/secret-clipboard'
import { DataTransfer } from '../../../src/main/vault/data-transfer'
import { VaultService } from '../../../src/main/vault/service'
import { APP_ORIGIN } from '../../../src/shared/app'
import type { IpcEventPayloads } from '../../../src/shared/ipc'
import type { IpcEvent } from '../../../src/shared/ipc-events'
import { fakeWrapper } from '../../unit/helpers/fake-wrapper'

/** scrypt at its lowest accepted cost, for speed. */
export const TEST_SCRYPT_COST = { N: 2 ** 14, r: 8, p: 1 }

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
    /** The vault folder; a new temp folder by default (removed on close). */
    vaultDir?: string
    /** Read /etc/os-release after a host's first connection (as the app does by default). */
    osProbe?: boolean
    /** What "Import hosts" finds; nothing by default. */
    importSources?: Partial<ImportSourcesDeps>
    /** electron-updater's stand-in; a development build (no updates) by default. */
    updater?: UpdaterLike
  } = {},
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kelidar-it-'))
  const logs: string[] = []
  const responses: unknown[] = []
  // A cheap scrypt cost keeps master-password tests fast; the format is the same.
  const vaults = new VaultService({
    directory: options.vaultDir ?? dir,
    wrapper: fakeWrapper(),
    scryptCost: TEST_SCRYPT_COST,
    sleep: () => Promise.resolve(),
  })
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
    ...(options.osProbe === true
      ? {
          osProbe: {
            command: OS_RELEASE_COMMAND,
            wanted: (hostId: string) => hosts.needsOs(hostId),
            onResult: (hostId: string, output: string) => {
              const os = parseOsRelease(output)
              if (os !== undefined) {
                void hosts.setOs(hostId, os).then(() => {
                  sink.send('host:os', { hostId, os })
                })
              }
            },
          },
        }
      : {}),
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

  /** The system clipboard, in memory. */
  const clipboard = {
    text: '',
    writeText(text: string) {
      this.text = text
    },
    readText() {
      return this.text
    },
    clear() {
      this.text = ''
    },
  }
  const clipboardSeconds = { value: 30 }
  const secretClipboard = new SecretClipboard(clipboard, () => clipboardSeconds.value)
  /** What the save and open dialogs return; null: the user cancelled. */
  const dialogs: { exportPath: string | null; importPath: string | null } = {
    exportPath: null,
    importPath: null,
  }
  registerSecurityHandlers(router, {
    vaults,
    hosts,
    identities,
    clipboard: secretClipboard,
    transfer: new DataTransfer(vaults, { scryptCost: TEST_SCRYPT_COST }),
    chooseExportPath: () => Promise.resolve(dialogs.exportPath),
    chooseImportPath: () => Promise.resolve(dialogs.importPath),
  })

  const sink = new FakeSink(1)
  registerImportHandlers(router, {
    imports: new HostImports(vaults, {
      home: dir,
      localUser: 'windows-user',
      readSshConfig: () => Promise.resolve(null),
      readPutty: () => Promise.resolve(null),
      readKeyFile: () => Promise.reject(new Error('no key files')),
      ...options.importSources,
    }),
  })

  registerUpdateHandlers(router, {
    updates: new UpdateService({
      updater: options.updater ?? null,
      currentVersion: '0.2.0',
      emit: (status) => {
        sink.send('update:status', status)
      },
    }),
  })

  // As in src/main/index.ts: locking drops secrets and tells the window.
  vaults.onChange((status) => {
    if (status.state === 'locked') {
      sessions.forgetSecrets()
      keyFiles.clear()
      void secretClipboard.clear()
    }
    sink.send('vault:state', status)
  })
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
    clipboard,
    clipboardSeconds,
    dialogs,
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
