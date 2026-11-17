import { randomBytes, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ParsedKey } from 'ssh2'
import {
  IMPORT_TAGS,
  type ImportApplyResult,
  type ImportCandidate,
  type ImportScan,
  type ImportSource,
  type ImportWarning,
} from '@shared/importers'
import type { AuthRef, HostRecord, Id } from '@shared/records'
import { AppError } from '../ipc/app-error'
import { addKey, addSecret, live } from '../keychain/auth-store'
import { describePublicKey, inspectPrivateKey } from '../ssh/keys'
import type { VaultService } from '../vault/service'
import type { VaultData } from '../vault/vault'
import { jumpChain } from '../hosts/host-service'
import { parsePuttySessions } from './putty'
import type { RawImport } from './raw-import'
import { jumpAddress, parseSshConfig, type SshConfigContext } from './ssh-config'

export interface ImportSourcesDeps extends SshConfigContext {
  /** ~/.ssh/config with its Include files expanded; null when there is none. */
  readSshConfig: () => Promise<string | null>
  /** The `reg export` text of PuTTY's sessions; null when there are none. */
  readPutty: () => Promise<string | null>
  /** Reads a key file; throws when it is missing or too big. */
  readKeyFile: (filePath: string) => Promise<string>
  now?: () => Date
  clock?: () => number
}

/** OpenSSH's default identities, in the order it tries them. */
const DEFAULT_KEYS = ['id_ed25519', 'id_ecdsa', 'id_rsa']
const TOKEN_TTL_MS = 30 * 60 * 1000

type ResolvedAuth =
  | { type: 'key'; path: string; name: string; content: string; parsed: ParsedKey }
  | { type: 'agent' }
  | { type: 'ask' }

interface Candidate {
  id: string
  raw: RawImport
  auth: ResolvedAuth
  warnings: ImportWarning[]
  /** Another candidate (by id) or a saved host (by id) to connect through. */
  jump?: { kind: 'candidate' | 'saved'; id: string; name: string }
}

interface Scan {
  candidates: Candidate[]
  expires: number
}

/**
 * "Import hosts": reads ~/.ssh/config and PuTTY's saved sessions, builds a
 * preview, and saves the rows the user keeps. Key files are read at scan
 * time and added to the Keychain on import (a key already there is reused).
 */
export class HostImports {
  private readonly scans = new Map<string, Scan>()

  constructor(
    private readonly vaults: VaultService,
    private readonly deps: ImportSourcesDeps,
  ) {}

  private clock(): number {
    return (this.deps.clock ?? Date.now)()
  }

  async scan(): Promise<ImportScan> {
    const data = (await this.vaults.get()).read()
    const [configText, puttyText] = await Promise.all([
      this.deps.readSshConfig().catch(() => null),
      this.deps.readPutty().catch(() => null),
    ])
    const raws: RawImport[] = [
      ...(configText === null ? [] : safeParse(() => parseSshConfig(configText, this.deps))),
      ...(puttyText === null ? [] : safeParse(() => parsePuttySessions(puttyText))),
    ]

    const keyCache = new Map<string, Promise<KeyRead>>()
    const readKey = (file: string): Promise<KeyRead> => {
      let pending = keyCache.get(file)
      if (pending === undefined) {
        pending = this.readKey(file)
        keyCache.set(file, pending)
      }
      return pending
    }

    const candidates: Candidate[] = []
    for (const [index, raw] of raws.entries()) {
      const warnings = [...raw.warnings]
      const files =
        raw.keyFiles.length > 0
          ? raw.keyFiles
          : raw.defaultKeys
            ? DEFAULT_KEYS.map((name) => path.join(this.deps.home, '.ssh', name))
            : []
      const reads = await Promise.all(files.map(readKey))
      const usable = reads.find((read) => read.kind === 'plain')
      let auth: ResolvedAuth
      if (usable?.kind === 'plain') {
        auth = { type: 'key', ...usable.key }
      } else if (reads.some((read) => read.kind === 'encrypted')) {
        auth = { type: 'agent' }
        warnings.push('keyEncrypted')
      } else {
        auth = { type: 'ask' }
        if (raw.keyFiles.length > 0) warnings.push('keyUnreadable')
      }
      candidates.push({ id: `c${String(index)}`, raw, auth, warnings })
    }

    for (const candidate of candidates) {
      const jump = candidate.raw.jump
      if (jump === undefined) continue
      const found = findJump(jump, candidate, candidates, data)
      if (found === undefined) candidate.warnings.push('jumpNotFound')
      else candidate.jump = found
    }

    this.prune()
    const token = randomBytes(16).toString('hex')
    this.scans.set(token, { candidates, expires: this.clock() + TOKEN_TTL_MS })
    const sources: ImportSource[] = ['sshConfig', 'putty']
    return {
      token,
      sources: sources.map((source) => ({
        source,
        found: source === 'sshConfig' ? configText !== null : puttyText !== null,
      })),
      candidates: candidates.map((candidate) => toView(candidate, data, this.deps.localUser)),
    }
  }

  /** Saves the chosen rows as hosts. Their jump hosts are linked when imported too. */
  async apply(token: string, ids: readonly string[]): Promise<ImportApplyResult> {
    this.prune()
    const scan = this.scans.get(token)
    if (scan === undefined) throw new AppError('IMPORT_EXPIRED')
    const chosen = scan.candidates.filter((candidate) => ids.includes(candidate.id))
    const vault = await this.vaults.get()
    const result = await vault.update((data) => {
      const now = (this.deps.now?.() ?? new Date()).toISOString()
      const keyIds = new Map<string, Id>()
      const hostIds = new Map<string, Id>()
      let keys = 0
      for (const candidate of chosen) {
        const raw = candidate.raw
        let auth: AuthRef
        if (candidate.auth.type === 'key') {
          const key = candidate.auth
          const fingerprint = describePublicKey(key.parsed).fingerprint
          let keyId =
            keyIds.get(key.path) ??
            data.keys.find((item) => live(item) && item.fingerprint === fingerprint)?.id
          if (keyId === undefined) {
            keyId = addKey(
              data,
              { name: key.name, privateKey: key.content, parsed: key.parsed, encrypted: false },
              now,
            )
            keys += 1
          }
          keyIds.set(key.path, keyId)
          auth = { type: 'key', keyId }
        } else {
          auth = { type: candidate.auth.type }
        }
        const proxy = raw.proxy
        const host: HostRecord = {
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
          name: raw.name.slice(0, 200),
          address: raw.address,
          ...(raw.port === 22 ? {} : { port: raw.port }),
          tags: [IMPORT_TAGS[raw.source]],
          username: (raw.username ?? this.deps.localUser).slice(0, 255),
          auth,
          ...(raw.agentForward ? { agentForward: true } : {}),
          ...(proxy === undefined
            ? {}
            : {
                proxy: {
                  type: proxy.type,
                  host: proxy.host,
                  port: proxy.port,
                  ...(proxy.username === undefined ? {} : { username: proxy.username }),
                  ...(proxy.password === undefined
                    ? {}
                    : { secretId: addSecret(data, proxy.password, now) }),
                },
              }),
        }
        data.hosts.push(host)
        hostIds.set(candidate.id, host.id)
      }
      // Jump hosts: an imported row, or a host saved before.
      for (const candidate of chosen) {
        const jump = candidate.jump
        const hostId = hostIds.get(candidate.id)
        const host = data.hosts.find((item) => item.id === hostId)
        if (jump === undefined || host === undefined) continue
        const jumpId = jump.kind === 'saved' ? jump.id : hostIds.get(jump.id)
        if (jumpId === undefined || jumpId === host.id) continue
        host.jumpHostId = jumpId
        try {
          jumpChain(data, host)
        } catch {
          // A loop (a goes through b, b through a): connect directly instead.
          delete host.jumpHostId
        }
      }
      return { hosts: chosen.length, keys }
    })
    this.scans.delete(token)
    return result
  }

  private async readKey(file: string): Promise<KeyRead> {
    let content: string
    try {
      content = await this.deps.readKeyFile(file)
    } catch {
      return { kind: 'missing' }
    }
    try {
      const inspected = inspectPrivateKey(content)
      if (inspected.parsed === undefined) return { kind: 'encrypted' }
      return {
        kind: 'plain',
        key: { path: file, name: path.basename(file), content, parsed: inspected.parsed },
      }
    } catch {
      return { kind: 'missing' }
    }
  }

  private prune(): void {
    const now = this.clock()
    for (const [token, scan] of this.scans) {
      if (scan.expires <= now) this.scans.delete(token)
    }
  }
}

type KeyRead =
  | { kind: 'plain'; key: { path: string; name: string; content: string; parsed: ParsedKey } }
  | { kind: 'encrypted' }
  | { kind: 'missing' }

function safeParse(parse: () => RawImport[]): RawImport[] {
  try {
    return parse()
  } catch {
    return []
  }
}

/** The jump host: a row of the same source by name or address, else a saved host. */
function findJump(
  jump: string,
  candidate: Candidate,
  candidates: readonly Candidate[],
  data: VaultData,
): Candidate['jump'] {
  const byName = candidates.find(
    (other) =>
      other !== candidate && other.raw.source === candidate.raw.source && other.raw.name === jump,
  )
  if (byName !== undefined) return { kind: 'candidate', id: byName.id, name: byName.raw.name }
  const { address, port } = jumpAddress(jump)
  if (address === null) return undefined
  const samePort = (value: number): boolean => port === undefined || value === port
  const byAddress = candidates.find(
    (other) =>
      other !== candidate &&
      other.raw.source === candidate.raw.source &&
      other.raw.address === address &&
      samePort(other.raw.port),
  )
  if (byAddress !== undefined) {
    return { kind: 'candidate', id: byAddress.id, name: byAddress.raw.name }
  }
  const saved = data.hosts.find(
    (host) =>
      live(host) && (host.name === jump || (host.address === address && samePort(host.port ?? 22))),
  )
  return saved === undefined ? undefined : { kind: 'saved', id: saved.id, name: saved.name }
}

function toView(candidate: Candidate, data: VaultData, localUser: string): ImportCandidate {
  const raw = candidate.raw
  const username = raw.username ?? localUser
  const duplicate = data.hosts.find(
    (host) =>
      live(host) &&
      host.address === raw.address &&
      (host.port ?? 22) === raw.port &&
      (host.username === undefined || host.username === username),
  )
  return {
    id: candidate.id,
    source: raw.source,
    name: raw.name,
    address: raw.address,
    port: raw.port,
    username,
    signIn: candidate.auth.type,
    ...(candidate.auth.type === 'key' ? { keyName: candidate.auth.name } : {}),
    ...(candidate.jump === undefined ? {} : { jump: candidate.jump.name }),
    ...(raw.proxy === undefined
      ? {}
      : { proxy: { type: raw.proxy.type, host: raw.proxy.host, port: raw.proxy.port } }),
    agentForward: raw.agentForward,
    ...(duplicate === undefined ? {} : { duplicateOf: duplicate.name }),
    warnings: candidate.warnings,
  }
}
