import { normalizeAddress } from './address'

/**
 * Smart Paste: finds a server's address, port, user name and password in
 * free text, such as a hosting provider's welcome e-mail, in English or
 * Persian. The result only fills the host form; the user checks it there
 * before anything is saved.
 */
export interface SmartPasteResult {
  address?: string
  port?: number
  username?: string
  password?: string
}

type Field = keyof SmartPasteResult

/** Persian and Arabic-Indic digits to 0-9, so "۲۲" reads as 22. */
export function westernDigits(text: string): string {
  return text.replace(/[\u06f0-\u06f9\u0660-\u0669]/g, (digit) => {
    const code = digit.charCodeAt(0)
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660)
  })
}

/**
 * Words that name each field in a "Label: value" line. Checked in this
 * order, so "Server password" is a password and "SSH user" a user name.
 */
const LABELS: readonly (readonly [Field, readonly string[]])[] = [
  [
    'password',
    ['password', 'passwd', 'pass', 'pwd', 'رمز', 'پسورد', 'گذرواژه', 'کلمه عبور', 'کلمه ی عبور'],
  ],
  ['username', ['username', 'user', 'login', 'نام کاربری', 'یوزر', 'کاربر']],
  ['port', ['port', 'پورت']],
  ['address', ['hostname', 'host', 'server', 'ip', 'address', 'آدرس', 'سرور', 'آی پی', 'هاست']],
]

function labelField(label: string): Field | undefined {
  const folded = label
    .toLowerCase()
    .replace(/[\u200c\u200f\u200e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (folded === '' || folded.length > 40) return undefined
  for (const [field, words] of LABELS) {
    if (
      words.some((word) =>
        /^[a-z]+$/.test(word)
          ? new RegExp(`(^|[^a-z])${word}([^a-z]|$)`).test(folded) || folded.includes(`${word}name`)
          : folded.includes(word),
      )
    ) {
      return field
    }
  }
  return undefined
}

const unquote = (value: string): string => value.trim().replace(/^(["'`«“])(.*)(["'`»”])$/u, '$2')

/** Trailing punctuation that is not part of an address, port or user name. */
const tidy = (value: string): string => unquote(value).replace(/[.,،;؛)]+$/u, '')

function parsePort(value: string): number | undefined {
  const port = Number(westernDigits(value).trim())
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : undefined
}

const USERNAME = /^[^\s@:]{1,64}$/

/** "1.2.3.4", "1.2.3.4:2222", "[::1]:22", "host.example.com". */
function parseAddress(value: string): { address: string; port?: number } | undefined {
  const text = westernDigits(tidy(value)).replace(/^(?:ssh|sftp|https?):\/\//i, '')
  const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(text)
  const hostPort = /^([^:\s/]+):(\d+)\/?$/.exec(text)
  const [host, port] =
    bracket !== null
      ? [bracket[1] ?? '', bracket[2]]
      : hostPort !== null
        ? [hostPort[1] ?? '', hostPort[2]]
        : [text.replace(/\/$/, ''), undefined]
  if (host.includes('/')) return undefined
  const address = normalizeAddress(host)
  if (address === null || !/[.:]/.test(address)) return undefined
  const parsedPort = port === undefined ? undefined : parsePort(port)
  return { address, ...(parsedPort === undefined ? {} : { port: parsedPort }) }
}

const IPV4 =
  /(?<![\d.])((?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})(?![\d.])/

export function parseSmartPaste(input: string): SmartPasteResult {
  const result: SmartPasteResult = {}
  const set = <K extends Field>(field: K, value: SmartPasteResult[K] | undefined): void => {
    if (value !== undefined && result[field] === undefined) result[field] = value
  }
  const lines = input.split(/\r?\n/)

  // 1. "Label: value" lines.
  for (const line of lines) {
    const match = /^\s*(?:[-*•>]\s*)?([^:：=]{1,40}?)\s*[:：=]\s*(.+?)\s*$/u.exec(line)
    if (match === null) continue
    const field = labelField(match[1] ?? '')
    const value = match[2] ?? ''
    if (field === 'password') set('password', unquote(value))
    else if (field === 'username') {
      const user = tidy(value)
      if (USERNAME.test(user)) set('username', user)
    } else if (field === 'port') set('port', parsePort(tidy(value)))
    else if (field === 'address') {
      const parsed = parseAddress(value)
      set('address', parsed?.address)
      set('port', parsed?.port)
    }
  }

  const text = westernDigits(input)
  // 2. An ssh command or an ssh:// link: ssh -p 2222 root@203.0.113.7
  const command =
    /\bssh\s+(?:-p\s*(\d+)\s+)?(?:-\w+\s+\S+\s+)*([^\s@]+)@(\[[^\]]+\]|[^\s:]+)(?::(\d+))?(?:\s+-p\s*(\d+))?/i.exec(
      text,
    ) ?? /\bssh:\/\/(?:([^\s@:/]+)@)?(\[[^\]]+\]|[^\s:/]+)(?::(\d+))?/i.exec(text)
  if (command !== null) {
    const isUrl = command[0].toLowerCase().startsWith('ssh://')
    const user = isUrl ? command[1] : command[2]
    const host = isUrl ? command[2] : command[3]
    const port = isUrl ? command[3] : (command[1] ?? command[4] ?? command[5])
    if (user !== undefined && USERNAME.test(user)) set('username', user)
    const parsed = host === undefined ? undefined : parseAddress(host)
    set('address', parsed?.address)
    if (port !== undefined) set('port', parsePort(port))
  }

  // 3. user@1.2.3.4 (an IP only: user@example.com is usually an e-mail address).
  const userAtIp = /(?:^|\s)([^\s@:]+)@((?:\d{1,3}\.){3}\d{1,3})(?::(\d+))?/.exec(text)
  if (userAtIp !== null) {
    if (USERNAME.test(userAtIp[1] ?? '')) set('username', userAtIp[1])
    set('address', parseAddress(userAtIp[2] ?? '')?.address)
    if (userAtIp[3] !== undefined) set('port', parsePort(userAtIp[3]))
  }

  // 4. Any IPv4 address.
  const ip = IPV4.exec(text)
  if (ip !== null) set('address', ip[1])
  return result
}

/** True when nothing useful was found. */
export function isEmptyPaste(result: SmartPasteResult): boolean {
  return Object.keys(result).length === 0
}
