import { normalizeAddress } from './address'
import { MAX_PORT } from './records'

export interface QuickTarget {
  username: string
  address: string
  port?: number
  /** The -i path as typed; main resolves ~ and relative paths. */
  identityFile?: string
}

export type QuickConnectError =
  | 'empty'
  | 'missing-host'
  | 'missing-user'
  | 'invalid-host'
  | 'invalid-user'
  | 'invalid-port'
  | 'missing-value'
  | 'unsupported-option'
  | 'remote-command'
  | 'unclosed-quote'

export type QuickConnectResult =
  { ok: true; target: QuickTarget } | { ok: false; error: QuickConnectError; option?: string }

export const MAX_QUICK_CONNECT_LENGTH = 2000

/** Flags that change nothing for an interactive session here; accepted and ignored. */
const IGNORED_FLAGS = new Set(['4', '6', 'C', 'q', 't', 'v', 'x', 'X', 'Y', 'a', 'k'])
/** Options that take a value and that this version understands. */
const VALUE_OPTIONS = new Set(['p', 'l', 'i', 'o'])
/** Options that take a value but are not supported yet (jump hosts, tunnels, ...). */
const UNSUPPORTED_WITH_VALUE = new Set([
  'J',
  'L',
  'R',
  'D',
  'F',
  'W',
  'w',
  'b',
  'B',
  'c',
  'm',
  'e',
  'E',
  'S',
  'O',
  'Q',
  'I',
  'P',
])

/**
 * Splits like a shell, but simpler: whitespace separates, single or double
 * quotes group, and backslashes stay as they are (Windows paths).
 */
function tokenize(input: string): string[] | null {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let inToken = false
  for (const char of input) {
    if (quote !== null) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      inToken = true
    } else if (/\s/.test(char)) {
      if (inToken) tokens.push(current)
      current = ''
      inToken = false
    } else {
      current += char
      inToken = true
    }
  }
  if (quote !== null) return null
  if (inToken) tokens.push(current)
  return tokens
}

function parsePort(value: string): number | null {
  if (!/^\d{1,5}$/.test(value)) return null
  const port = Number(value)
  return port >= 1 && port <= MAX_PORT ? port : null
}

/** user@host, user@host:port, user@[ipv6]:port, ssh://user@host:port */
function parseDestination(
  raw: string,
): { username?: string; host: string; port?: string } | { error: QuickConnectError } {
  let value = raw
  if (/^ssh:\/\//i.test(value)) value = value.slice(6).replace(/\/+$/, '')
  const at = value.lastIndexOf('@')
  const username = at === -1 ? undefined : value.slice(0, at)
  const hostPart = at === -1 ? value : value.slice(at + 1)
  if (hostPart === '') return { error: 'missing-host' }

  if (hostPart.startsWith('[')) {
    const close = hostPart.indexOf(']')
    if (close === -1) return { error: 'invalid-host' }
    const rest = hostPart.slice(close + 1)
    if (rest !== '' && !rest.startsWith(':')) return { error: 'invalid-host' }
    return {
      ...(username === undefined ? {} : { username }),
      host: hostPart.slice(1, close),
      ...(rest === '' ? {} : { port: rest.slice(1) }),
    }
  }
  const colons = hostPart.split(':').length - 1
  if (colons === 1) {
    const [host = '', port = ''] = hostPart.split(':')
    return { ...(username === undefined ? {} : { username }), host, port }
  }
  // No colon, or a bare IPv6 address.
  return { ...(username === undefined ? {} : { username }), host: hostPart }
}

/**
 * Reads what a user types or pastes into Quick Connect: user@host,
 * user@host:port or a full command such as `ssh user@host -p 2222 -i key`.
 * Options: -p port, -l user, -i identity file, -o Port=/User=/IdentityFile=.
 * The user name in user@host wins over -l; -p wins over :port.
 */
export function parseQuickConnect(input: string): QuickConnectResult {
  if (input.length > MAX_QUICK_CONNECT_LENGTH) return { ok: false, error: 'invalid-host' }
  const tokens = tokenize(input.trim())
  if (tokens === null) return { ok: false, error: 'unclosed-quote' }
  if (tokens.length === 0) return { ok: false, error: 'empty' }
  if (/^ssh(\.exe)?$/i.test(tokens[0] ?? '')) tokens.shift()

  let destination: string | undefined
  let optionPort: string | undefined
  let optionUser: string | undefined
  let identityFile: string | undefined
  let optionsDone = false

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? ''
    if (!optionsDone && token === '--') {
      optionsDone = true
      continue
    }
    if (!optionsDone && token.startsWith('-') && token.length > 1) {
      const letter = token[1] ?? ''
      if (VALUE_OPTIONS.has(letter)) {
        let value: string | undefined = token.slice(2)
        if (value === '') {
          index++
          value = tokens[index]
        }
        if (value === undefined || value === '') {
          return { ok: false, error: 'missing-value', option: `-${letter}` }
        }
        if (letter === 'p') optionPort = value
        else if (letter === 'l') optionUser = value
        else if (letter === 'i') identityFile = value
        else {
          const match = /^(\w+)\s*[=\s]\s*(.+)$/.exec(value)
          const name = match?.[1]?.toLowerCase()
          const optionValue = match?.[2]?.trim() ?? ''
          if (name === 'port') optionPort = optionValue
          else if (name === 'user') optionUser = optionValue
          else if (name === 'identityfile') identityFile = optionValue
          else
            return { ok: false, error: 'unsupported-option', option: `-o ${match?.[1] ?? value}` }
        }
        continue
      }
      if (UNSUPPORTED_WITH_VALUE.has(letter)) {
        return { ok: false, error: 'unsupported-option', option: `-${letter}` }
      }
      const flags = token.slice(1)
      if (
        /^[A-Za-z0-9]+$/.test(flags) &&
        flags.split('').every((flag) => IGNORED_FLAGS.has(flag))
      ) {
        continue
      }
      return { ok: false, error: 'unsupported-option', option: token }
    }
    if (destination !== undefined) return { ok: false, error: 'remote-command' }
    destination = token
  }

  if (destination === undefined) return { ok: false, error: 'missing-host' }
  const parsed = parseDestination(destination)
  if ('error' in parsed) return { ok: false, error: parsed.error }

  const address = normalizeAddress(parsed.host)
  if (address === null) return { ok: false, error: 'invalid-host' }

  const portText = optionPort ?? parsed.port
  let port: number | undefined
  if (portText !== undefined) {
    const value = parsePort(portText)
    if (value === null) return { ok: false, error: 'invalid-port' }
    port = value
  }

  const username = parsed.username ?? optionUser
  if (username === undefined || username === '') return { ok: false, error: 'missing-user' }
  if (!/^[^\s@:]{1,255}$/.test(username)) return { ok: false, error: 'invalid-user' }

  return {
    ok: true,
    target: {
      username,
      address,
      ...(port === undefined ? {} : { port }),
      ...(identityFile === undefined ? {} : { identityFile }),
    },
  }
}
