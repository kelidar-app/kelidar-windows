/**
 * Server addresses: a host name, an IPv4 address or an IPv6 address (with or
 * without [brackets]). Returned without brackets and in lower case.
 * Returns null for anything else, including values that start with "-".
 */
export function normalizeAddress(input: string): string | null {
  let value = input.trim()
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1)
  if (value === '' || value.length > 253) return null
  if (value.includes(':')) {
    // IPv6, optionally with a zone id (fe80::1%eth0).
    return /^[0-9a-fA-F:.]+(%[\w.-]+)?$/.test(value) && (value.match(/:/g)?.length ?? 0) >= 2
      ? value.toLowerCase()
      : null
  }
  const labels = value.split('.')
  const validLabel = (label: string): boolean =>
    /^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$/.test(label)
  // A trailing dot is a valid fully qualified name.
  if (labels.at(-1) === '') labels.pop()
  if (labels.length === 0 || !labels.every(validLabel)) return null
  return value.toLowerCase()
}

/** user@host:port for display; IPv6 addresses get brackets when a port follows. */
export function formatTarget(target: { username?: string; address: string; port: number }): string {
  const host = target.address.includes(':') ? `[${target.address}]` : target.address
  const user = target.username === undefined ? '' : `${target.username}@`
  return target.port === 22 ? `${user}${host}` : `${user}${host}:${String(target.port)}`
}
