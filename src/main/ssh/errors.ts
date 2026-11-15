import type { ErrorCode } from '@shared/errors'
import { AppError } from '../ipc/app-error'

/** What the session itself knows about why it failed. */
export interface FailureContext {
  hostKey?: 'changed' | 'rejected'
  /** The user closed a password or question dialog. */
  cancelled?: boolean
  /** The shell was open before the failure (a drop, not a failed connect). */
  wasReady?: boolean
}

function codeOf(error: Error): string | undefined {
  return 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

function levelOf(error: Error): string | undefined {
  return 'level' in error && typeof error.level === 'string' ? error.level : undefined
}

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'EAI_FAIL', 'EAI_NODATA'])
const UNREACHABLE_CODES = new Set([
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTDOWN',
  'EADDRNOTAVAIL',
])
const DROP_CODES = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED'])

/**
 * Turns whatever ssh2 or the socket threw into one error code. Messages are
 * only matched, never passed on: they can contain host names or worse.
 */
export function mapConnectionError(error: unknown, context: FailureContext = {}): ErrorCode {
  if (context.hostKey === 'changed') return 'SSH_HOST_KEY_CHANGED'
  if (context.hostKey === 'rejected') return 'SSH_HOST_KEY_REJECTED'
  if (error instanceof AppError) return error.code
  if (!(error instanceof Error)) return 'SSH_FAILED'

  const code = codeOf(error)
  const level = levelOf(error)
  const message = error.message

  if ((code !== undefined && DNS_CODES.has(code)) || level === 'client-dns') {
    return 'SSH_HOST_NOT_FOUND'
  }
  if (code === 'ECONNREFUSED') return 'SSH_CONNECTION_REFUSED'
  if (code !== undefined && UNREACHABLE_CODES.has(code)) return 'SSH_NETWORK_UNREACHABLE'
  if (message === 'Keepalive timeout') return 'SSH_CONNECTION_LOST'
  if (code === 'ETIMEDOUT' || level === 'client-timeout') {
    return context.wasReady === true ? 'SSH_CONNECTION_LOST' : 'SSH_TIMEOUT'
  }
  if (code !== undefined && DROP_CODES.has(code)) {
    return context.wasReady === true ? 'SSH_CONNECTION_LOST' : 'SSH_CONNECTION_CLOSED_BY_SERVER'
  }
  if (level === 'client-authentication') return 'SSH_AUTH_FAILED'
  if (/no matching/i.test(message) && (level === 'handshake' || level === 'protocol')) {
    return 'SSH_ALGORITHM_MISMATCH'
  }
  return 'SSH_FAILED'
}
