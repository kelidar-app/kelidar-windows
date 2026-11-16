import { normalizeAddress } from '@shared/address'
import type { HostSaveRequest, HostView } from '@shared/hosts'
import { MAX_PORT, MAX_STARTUP_COMMAND, type ProxyType } from '@shared/records'

/** The connection options of the host form, as typed. Lives in form state only. */
export interface ConnectionDraft {
  /** '' = from the group, 'none' = connect directly, else a host id. */
  jump: string
  proxyType: ProxyType | ''
  proxyHost: string
  proxyPort: string
  proxyUser: string
  proxyPassword: string
  forgetProxyPassword: boolean
  startup: string
  sticky: boolean
}

export type ConnectionErrors = Partial<Record<'proxyHost' | 'proxyPort' | 'startup', true>>

export function initialConnection(host: HostView | undefined): ConnectionDraft {
  const own = host?.ownJump
  return {
    jump:
      own === undefined || own.type === 'inherit' ? '' : own.type === 'none' ? 'none' : own.hostId,
    proxyType: host?.proxy?.type ?? '',
    proxyHost: host?.proxy?.host ?? '',
    proxyPort: host?.proxy === undefined ? '' : String(host.proxy.port),
    proxyUser: host?.proxy?.username ?? '',
    proxyPassword: '',
    forgetProxyPassword: false,
    startup: host?.startupCommand ?? '',
    sticky: host?.stickySession ?? false,
  }
}

/** True when the host uses any connection option (so "More options" starts open). */
export function hasConnectionOptions(host: HostView | undefined): boolean {
  return (
    host !== undefined &&
    (host.ownJump.type !== 'inherit' ||
      host.proxy !== undefined ||
      host.startupCommand !== undefined ||
      host.stickySession)
  )
}

/** The default port of each proxy type. */
export const PROXY_DEFAULT_PORT: Record<ProxyType, number> = { socks5: 1080, http: 8080 }

export function connectionRequest(
  draft: ConnectionDraft,
  saved: HostView | undefined,
):
  | {
      ok: true
      fields: Pick<HostSaveRequest, 'jump' | 'proxy' | 'startupCommand' | 'stickySession'>
    }
  | { ok: false; errors: ConnectionErrors } {
  const errors: ConnectionErrors = {}
  let proxy: HostSaveRequest['proxy']
  if (draft.proxyType !== '') {
    const host = normalizeAddress(draft.proxyHost)
    const port =
      draft.proxyPort.trim() === '' ? PROXY_DEFAULT_PORT[draft.proxyType] : Number(draft.proxyPort)
    if (host === null) errors.proxyHost = true
    if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) errors.proxyPort = true
    const user = draft.proxyUser.trim()
    const keepPassword = saved?.proxy?.hasPassword === true && !draft.forgetProxyPassword
    proxy = {
      type: draft.proxyType,
      host: host ?? '',
      port,
      ...(user === '' ? {} : { username: user }),
      ...(draft.proxyPassword !== ''
        ? { password: draft.proxyPassword }
        : keepPassword
          ? {}
          : { password: '' }),
    }
  }
  const startup = draft.startup.trim()
  if (startup.length > MAX_STARTUP_COMMAND || /[\r\n]/.test(startup)) errors.startup = true
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    fields: {
      jump:
        draft.jump === ''
          ? { type: 'inherit' }
          : draft.jump === 'none'
            ? { type: 'none' }
            : { type: 'host', hostId: draft.jump },
      ...(proxy === undefined ? {} : { proxy }),
      ...(startup === '' ? {} : { startupCommand: startup }),
      ...(draft.sticky ? { stickySession: true } : {}),
    },
  }
}

/** The tmux session a sticky session of this host starts in (the first tab's name). */
export function stickySessionName(hostId: string | undefined): string {
  return hostId === undefined ? 'kelidar-…' : `kelidar-${hostId.replaceAll('-', '').slice(0, 8)}`
}
