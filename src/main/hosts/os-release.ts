import type { HostOs, OsId } from '@shared/host-extras'

/** ID (or ID_LIKE) values of /etc/os-release, to the badge shown for the host. */
const OS_BY_ID: Record<string, OsId> = {
  ubuntu: 'ubuntu',
  debian: 'debian',
  fedora: 'fedora',
  centos: 'centos',
  rhel: 'rhel',
  rocky: 'rocky',
  almalinux: 'almalinux',
  alpine: 'alpine',
  arch: 'arch',
  archarm: 'arch',
  manjaro: 'arch',
  opensuse: 'opensuse',
  'opensuse-leap': 'opensuse',
  'opensuse-tumbleweed': 'opensuse',
  sles: 'opensuse',
  amzn: 'amazon',
  ol: 'oracle',
  linuxmint: 'mint',
  kali: 'kali',
  raspbian: 'raspbian',
  freebsd: 'freebsd',
}

/** Reads KEY=value lines; values may be quoted. */
function fields(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match === null) continue
    const value = (match[2] ?? '').replace(/^"(.*)"$|^'(.*)'$/, '$1$2').replace(/\\(.)/g, '$1')
    out.set(match[1] ?? '', value)
  }
  return out
}

/**
 * The system a server runs, from the output of `cat /etc/os-release`.
 * undefined when the output is not an os-release file.
 */
export function parseOsRelease(text: string): HostOs | undefined {
  const values = fields(text)
  const id = values.get('ID')?.toLowerCase()
  if (id === undefined || id === '') return undefined
  const like = (values.get('ID_LIKE') ?? '').toLowerCase().split(/\s+/)
  const osId = OS_BY_ID[id] ?? like.map((item) => OS_BY_ID[item]).find((item) => item !== undefined)
  const name =
    values.get('PRETTY_NAME') ??
    [values.get('NAME'), values.get('VERSION_ID')].filter((part) => part !== undefined).join(' ')
  return {
    id: osId ?? (id === 'freebsd' ? 'freebsd' : 'linux'),
    name: (name === '' ? id : name).slice(0, 200),
  }
}
