import type { ImportSource, ImportWarning } from '@shared/importers'
import type { ProxyType } from '@shared/records'

/** One host as an importer read it, before key files and jump hosts are looked up. */
export interface RawImport {
  source: ImportSource
  name: string
  /** Already normalized (lower case, no brackets). */
  address: string
  port: number
  username: string | undefined
  /** Key files to try, in order, as absolute paths. */
  keyFiles: string[]
  /** OpenSSH tries its default keys when the config names none. */
  defaultKeys: boolean
  /** The jump host as written: an alias, or [user@]host[:port]. */
  jump?: string
  proxy?: { type: ProxyType; host: string; port: number; username?: string; password?: string }
  agentForward: boolean
  warnings: ImportWarning[]
}

/** Splits "[user@]host[:port]" (IPv6 in brackets). */
export function splitTarget(text: string): { user?: string; host: string; port?: number } {
  let rest = text.trim()
  let user: string | undefined
  const at = rest.lastIndexOf('@')
  if (at > 0) {
    user = rest.slice(0, at)
    rest = rest.slice(at + 1)
  }
  let port: number | undefined
  const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(rest)
  if (bracket !== null) {
    rest = bracket[1] ?? ''
    if (bracket[2] !== undefined) port = Number(bracket[2])
  } else {
    const colon = /^([^:]+):(\d+)$/.exec(rest)
    if (colon !== null) {
      rest = colon[1] ?? ''
      port = Number(colon[2])
    }
  }
  return {
    ...(user === undefined ? {} : { user }),
    host: rest,
    ...(port === undefined || port < 1 || port > 65_535 ? {} : { port }),
  }
}

export function toPort(value: string | number | undefined, fallback = 22): number {
  const port = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : fallback
}
