import { randomBytes } from 'node:crypto'
import type { ParsedKey } from 'ssh2'
import type { HostView } from '@shared/hosts'
import type { GeneratedKeyType, KeyUpgradePlan } from '@shared/keychain'
import type { Id, KeyKind } from '@shared/records'
import { AppError } from '../ipc/app-error'
import { credentialFor, live } from '../keychain/auth-store'
import type { KeyService } from '../keychain/key-service'
import type { Credential } from '../ssh/auth'
import type { EventSink } from '../ssh/event-sink'
import { describePublicKey, generateKey } from '../ssh/keys'
import type { CommandResult, ConnectTarget } from '../ssh/session-manager'
import type { VaultService } from '../vault/service'
import type { HostService } from './host-service'

const PLAN_TTL_MS = 15 * 60 * 1000

/** POSIX shell single quotes: safe for any text. */
export function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`
}

/**
 * The command that adds a public key to ~/.ssh/authorized_keys, shown to the
 * user before it runs. It creates the folder and file if needed, adds the key
 * only once, starts it on a new line, and sets the permissions sshd expects.
 */
export function installKeyCommand(publicKey: string): string {
  const [type = '', blob = ''] = publicKey.split(' ')
  const keyOnly = shellQuote(`${type} ${blob}`)
  const line = shellQuote(`${type} ${blob} kelidar`)
  const file = '~/.ssh/authorized_keys'
  return [
    'umask 077',
    'mkdir -p ~/.ssh',
    `touch ${file}`,
    `{ grep -qF ${keyOnly} ${file} || { [ -z "$(tail -c 1 ${file})" ] || echo >> ${file}; echo ${line} >> ${file}; }; }`,
    'chmod 700 ~/.ssh',
    `chmod 600 ${file}`,
  ].join(' && ')
}

type PlannedKey =
  | { kind: 'existing'; keyId: Id }
  | { kind: 'new'; privateKey: string; parsed: ParsedKey; type: GeneratedKeyType }

interface Plan {
  ownerId: number
  hostId: Id
  key: PlannedKey
  command: string
  expires: number
}

export interface KeyUpgradeDeps {
  vaults: VaultService
  hosts: HostService
  keys: KeyService
  runCommand: (
    owner: EventSink,
    target: ConnectTarget,
    command: string,
    options?: { strict?: boolean },
  ) => Promise<CommandResult>
  now?: () => number
}

/**
 * "Upgrade to key login": pick or make a key, show the exact command, then
 * (after the user agrees) install the key with the host's current sign-in,
 * test a login with the key alone, and only then switch the host to it.
 * Nothing changes on the host if any step fails.
 */
export class KeyUpgrades {
  private readonly plans = new Map<string, Plan>()
  private readonly now: () => number

  constructor(private readonly deps: KeyUpgradeDeps) {
    this.now = deps.now ?? Date.now
  }

  /** The app locked: planned upgrades (with their new private keys) leave memory. */
  clear(): void {
    this.plans.clear()
  }

  async prepare(
    owner: EventSink,
    hostId: Id,
    key: { generate: GeneratedKeyType } | { keyId: Id },
  ): Promise<KeyUpgradePlan> {
    const host = await this.deps.hosts.view(hostId)
    if (host.signIn.method === 'key' || host.signIn.method === 'agent') {
      throw new AppError('KEY_UPGRADE_NOT_NEEDED')
    }
    let planned: PlannedKey
    let described: { type: KeyKind; publicKey: string; fingerprint: string }
    if ('generate' in key) {
      const generated = await generateKey(key.generate)
      planned = { kind: 'new', type: key.generate, ...generated }
      described = describePublicKey(generated.parsed)
    } else {
      const data = (await this.deps.vaults.get()).read()
      const record = data.keys.find((item) => item.id === key.keyId && live(item))
      if (record === undefined) throw new AppError('KEY_NOT_FOUND')
      planned = { kind: 'existing', keyId: record.id }
      described = record
    }
    this.prune()
    const upgradeId = randomBytes(16).toString('hex')
    const command = installKeyCommand(described.publicKey)
    this.plans.set(upgradeId, {
      ownerId: owner.id,
      hostId,
      key: planned,
      command,
      expires: this.now() + PLAN_TTL_MS,
    })
    return { upgradeId, command, keyType: described.type, fingerprint: described.fingerprint }
  }

  async run(owner: EventSink, upgradeId: string): Promise<HostView> {
    this.prune()
    const plan = this.plans.get(upgradeId)
    if (plan?.ownerId !== owner.id) throw new AppError('KEY_UPGRADE_EXPIRED')
    this.plans.delete(upgradeId)
    const host = await this.deps.hosts.view(plan.hostId)
    const target = await this.deps.hosts.connectTarget(plan.hostId)

    // 1. Install the key, signed in the way the host signs in today.
    const installed = await this.deps.runCommand(owner, target, plan.command)
    if (installed.exitCode !== 0) throw new AppError('KEY_UPGRADE_INSTALL_FAILED')

    // 2. Sign in again with the key alone.
    const keyCredential = await this.credential(plan.key, host.name)
    try {
      const test = await this.deps.runCommand(
        owner,
        { ...target, credential: keyCredential },
        'true',
        { strict: true },
      )
      if (test.exitCode !== 0) throw new AppError('KEY_UPGRADE_TEST_FAILED')
    } catch (error) {
      if (error instanceof AppError && error.code === 'SSH_AUTH_FAILED') {
        throw new AppError('KEY_UPGRADE_TEST_FAILED', { cause: error })
      }
      throw error
    }

    // 3. Keep the key and switch the host to it.
    const keyId =
      plan.key.kind === 'existing'
        ? plan.key.keyId
        : (
            await this.deps.keys.adopt({
              name: `${host.name} (${plan.key.type})`,
              privateKey: plan.key.privateKey,
              parsed: plan.key.parsed,
            })
          ).id
    return this.deps.hosts.switchToKey(plan.hostId, keyId)
  }

  private async credential(key: PlannedKey, hostName: string): Promise<Credential> {
    if (key.kind === 'new') {
      return { type: 'key', privateKey: key.privateKey, keyName: hostName }
    }
    // Keychain keys always have their passphrase stored, so no question is needed.
    return credentialFor((await this.deps.vaults.get()).read(), { type: 'key', keyId: key.keyId })
  }

  private prune(): void {
    const now = this.now()
    for (const [id, plan] of this.plans) if (plan.expires <= now) this.plans.delete(id)
  }
}
