import { normalizeAddress } from '@shared/address'
import type { ImportWarning } from '@shared/importers'
import type { ProxyType } from '@shared/records'
import { splitTarget, toPort, type RawImport } from './raw-import'

/** Where PuTTY keeps its saved sessions. */
export const PUTTY_SESSIONS_KEY = 'HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions'

type RegValue = string | number

/** A .reg string value: "text" with \\ and \" escaped. */
function regString(raw: string): string | undefined {
  const match = /^"((?:[^"\\]|\\.)*)"$/.exec(raw)
  if (match === null) return undefined
  return (match[1] ?? '').replace(/\\(.)/g, '$1')
}

/**
 * Reads the text of `reg export` (Windows Registry Editor 5.00 format): one
 * [key] per session, then "name"=value lines. Only strings and DWORDs are
 * needed; binary values (and their continuation lines) are skipped.
 */
export function parseRegExport(text: string): Map<string, Map<string, RegValue>> {
  const keys = new Map<string, Map<string, RegValue>>()
  let current: Map<string, RegValue> | undefined
  let continued = false
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (continued) {
      continued = line.endsWith('\\')
      continue
    }
    const key = /^\[(.+)\]$/.exec(line)
    if (key !== null) {
      current = new Map()
      keys.set(key[1] ?? '', current)
      continue
    }
    const value = /^"((?:[^"\\]|\\.)*)"=(.*)$/.exec(line)
    if (value === null || current === undefined) continue
    const name = (value[1] ?? '').replace(/\\(.)/g, '$1')
    const data = value[2] ?? ''
    if (data.endsWith('\\')) continued = true
    const dword = /^dword:([0-9a-fA-F]{8})$/.exec(data)
    if (dword !== null) current.set(name, parseInt(dword[1] ?? '0', 16))
    else {
      const text = regString(data)
      if (text !== undefined) current.set(name, text)
    }
  }
  return keys
}

/** Session names are stored %-encoded ("My%20Server"). */
function sessionName(key: string): string {
  const encoded = key.slice(key.lastIndexOf('\\') + 1)
  try {
    return decodeURIComponent(encoded)
  } catch {
    return encoded
  }
}

/** PuTTY's ProxyMethod numbers. */
const PROXY_METHODS: Record<number, ProxyType | 'ssh' | 'unsupported' | 'command'> = {
  1: 'unsupported', // SOCKS 4
  2: 'socks5',
  3: 'http',
  4: 'unsupported', // Telnet
  5: 'command', // local proxy command
  6: 'ssh', // SSH: a jump host
}

/** Every saved PuTTY session that uses SSH and names a host. */
export function parsePuttySessions(regText: string): RawImport[] {
  const out: RawImport[] = []
  for (const [key, values] of parseRegExport(regText)) {
    if (!key.toUpperCase().startsWith(`${PUTTY_SESSIONS_KEY.toUpperCase()}\\`)) continue
    const str = (name: string): string => {
      const value = values.get(name)
      return typeof value === 'string' ? value.trim() : ''
    }
    const num = (name: string): number | undefined => {
      const value = values.get(name)
      return typeof value === 'number' ? value : undefined
    }
    const protocol = str('Protocol')
    if (protocol !== '' && protocol.toLowerCase() !== 'ssh') continue
    const hostField = str('HostName')
    if (hostField === '') continue
    // "user@host" in the host field is how many people save a user name.
    const target = splitTarget(hostField)
    const address = normalizeAddress(target.host)
    if (address === null) continue

    const warnings: ImportWarning[] = []
    const username = str('UserName') !== '' ? str('UserName') : target.user
    if (username === undefined || username === '') warnings.push('noUsername')
    const keyFile = str('PublicKeyFile')

    let proxy: RawImport['proxy']
    let jump: string | undefined
    const method = PROXY_METHODS[num('ProxyMethod') ?? 0]
    const proxyHost = str('ProxyHost')
    if (method !== undefined && proxyHost !== '') {
      const proxyPort = toPort(num('ProxyPort'), method === 'ssh' ? 22 : 1080)
      const proxyUser = str('ProxyUsername')
      if (method === 'ssh') {
        jump = `${proxyUser === '' ? '' : `${proxyUser}@`}${proxyHost}:${String(proxyPort)}`
      } else if (method === 'command') warnings.push('proxyCommand')
      else if (method === 'unsupported') warnings.push('proxyUnsupported')
      else {
        const proxyAddress = normalizeAddress(proxyHost)
        if (proxyAddress !== null) {
          const password = str('ProxyPassword')
          proxy = {
            type: method,
            host: proxyAddress,
            port: proxyPort,
            ...(proxyUser === '' ? {} : { username: proxyUser }),
            ...(password === '' ? {} : { password }),
          }
        }
      }
    }

    out.push({
      source: 'putty',
      name: sessionName(key),
      address,
      port: toPort(num('PortNumber') ?? target.port),
      username: username === '' ? undefined : username,
      keyFiles: keyFile === '' ? [] : [keyFile],
      // PuTTY does not look for key files by itself.
      defaultKeys: false,
      ...(jump === undefined ? {} : { jump }),
      ...(proxy === undefined ? {} : { proxy }),
      agentForward: num('AgentFwd') === 1,
      warnings,
    })
  }
  return out
}
