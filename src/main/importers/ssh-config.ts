import path from 'node:path'
import SSHConfig, { LineType, type Line } from 'ssh-config'
import { normalizeAddress } from '@shared/address'
import type { ImportWarning } from '@shared/importers'
import { splitTarget, toPort, type RawImport } from './raw-import'

export interface SshConfigContext {
  /** The user's home folder (~). */
  home: string
  /** The Windows user name: OpenSSH's default user. */
  localUser: string
}

export interface ConfigFiles {
  readFile: (filePath: string) => Promise<string>
  /** File names in a folder; [] when it does not exist. */
  listDir: (dir: string) => Promise<string[]>
}

const MAX_INCLUDE_DEPTH = 5

function expandHome(value: string, home: string): string {
  if (value === '~') return home
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(home, value.slice(2))
  return value
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')
}

/**
 * Replaces `Include` lines with the files they name, as OpenSSH reads them:
 * relative paths are in ~/.ssh, and * and ? may appear in the file name.
 * Nothing is run; Include is the only directive that reads another file.
 */
export async function expandIncludes(
  text: string,
  files: ConfigFiles,
  context: SshConfigContext,
  depth = 0,
): Promise<string> {
  if (depth >= MAX_INCLUDE_DEPTH) return text
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*include\s+(.+?)\s*$/i.exec(line)
    if (match === null) {
      out.push(line)
      continue
    }
    for (const raw of (match[1] ?? '').split(/\s+/)) {
      const pattern = expandHome(raw.replace(/^"|"$/g, ''), context.home)
      const full = path.isAbsolute(pattern) ? pattern : path.join(context.home, '.ssh', pattern)
      const dir = path.dirname(full)
      const base = path.basename(full)
      const names = /[*?]/.test(base)
        ? (await files.listDir(dir)).filter((name) => wildcardToRegExp(base).test(name)).sort()
        : [base]
      for (const name of names) {
        try {
          const included = await files.readFile(path.join(dir, name))
          out.push(await expandIncludes(included, files, context, depth + 1))
        } catch {
          // A missing included file is skipped, as OpenSSH does.
        }
      }
    }
  }
  return out.join('\n')
}

/** The plain aliases of every Host line: patterns (*, ?, !) are not hosts. */
function aliases(config: SSHConfig): string[] {
  const out: string[] = []
  const visit = (line: Line): void => {
    if (line.type !== LineType.DIRECTIVE || line.param.toLowerCase() !== 'host') return
    const values =
      typeof line.value === 'string' ? line.value.split(/\s+/) : line.value.map((v) => v.val)
    for (const value of values) {
      if (value !== '' && !/[*?!]/.test(value) && !out.includes(value)) out.push(value)
    }
  }
  for (const line of config) visit(line)
  return out
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

const list = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]

/** OpenSSH's % tokens in HostName and IdentityFile. */
function expandTokens(
  value: string,
  tokens: { h: string; r: string; p: number; d: string; u: string; n: string },
): string {
  return value.replace(/%([%hrpdun])/g, (_whole, token: string) => {
    if (token === '%') return '%'
    const replaced = tokens[token as keyof typeof tokens]
    return String(replaced)
  })
}

/**
 * The hosts in an ssh config: one per Host alias, with the values OpenSSH
 * would use (Host * defaults included). Match exec is never run.
 */
export function parseSshConfig(text: string, context: SshConfigContext): RawImport[] {
  const config = SSHConfig.parse(text)
  const out: RawImport[] = []
  for (const alias of aliases(config)) {
    const computed = config.compute(alias, { ignoreCase: true, matchExec: false })
    const warnings: ImportWarning[] = []
    const port = toPort(single(computed['port']))
    const user = single(computed['user'])
    const username = user ?? context.localUser
    const tokens = {
      h: alias,
      r: username,
      p: port,
      d: context.home,
      u: context.localUser,
      n: alias,
    }
    const hostName = expandTokens(single(computed['hostname']) ?? alias, tokens)
    tokens.h = hostName
    const address = normalizeAddress(hostName)
    if (address === null) continue

    const keyFiles = list(computed['identityfile'])
      .filter((file) => file.toLowerCase() !== 'none')
      .map((file) =>
        path.resolve(context.home, expandHome(expandTokens(file, tokens), context.home)),
      )

    let jump: string | undefined
    const proxyJump = single(computed['proxyjump'])
    if (proxyJump !== undefined && proxyJump.toLowerCase() !== 'none') {
      const hops = proxyJump
        .split(',')
        .map((hop) => hop.trim())
        .filter((hop) => hop !== '')
      if (hops.length > 1) warnings.push('jumpChain')
      jump = hops.at(-1)?.replace(/^ssh:\/\//i, '')
    }
    const proxyCommand = single(computed['proxycommand'])
    if (proxyCommand !== undefined && proxyCommand.toLowerCase() !== 'none') {
      warnings.push('proxyCommand')
    }

    out.push({
      source: 'sshConfig',
      name: alias,
      address,
      port,
      username,
      keyFiles,
      defaultKeys: keyFiles.length === 0,
      ...(jump === undefined || jump === '' ? {} : { jump }),
      agentForward: single(computed['forwardagent'])?.toLowerCase() === 'yes',
      warnings,
    })
  }
  return out
}

/** The address a jump written as [user@]host[:port] points at. */
export function jumpAddress(jump: string): { address: string | null; port?: number } {
  const target = splitTarget(jump)
  return {
    address: normalizeAddress(target.host),
    ...(target.port === undefined ? {} : { port: target.port }),
  }
}
