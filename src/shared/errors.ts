/**
 * Error codes main returns over IPC. The renderer maps each code to a
 * translated message (errors.<code> in en.json and fa.json) that says what
 * failed and what the user can do next.
 */
export const ERROR_CODES = [
  'IPC_FORBIDDEN',
  'IPC_INVALID_PAYLOAD',
  'INTERNAL',
  'SETTINGS_WRITE_FAILED',
  'VAULT_UNAVAILABLE',
  'VAULT_KEY_UNREADABLE',
  'VAULT_CORRUPT',
  'VAULT_NEWER_VERSION',
  'VAULT_WRITE_FAILED',
  'HOST_NOT_FOUND',
  'GROUP_NOT_FOUND',
  'GROUP_PARENT_INVALID',
  'GROUP_TOO_DEEP',
  'KEY_FILE_UNREADABLE',
  'KEY_FILE_EXPIRED',
  'KEY_INVALID',
  'KEY_PASSPHRASE_REQUIRED',
  'KEY_PASSPHRASE_WRONG',
  'KEY_REQUIRED',
  'QUICK_CONNECT_INVALID',
  'SESSION_NOT_FOUND',
  'SESSION_LIMIT',
  'SSH_HOST_NOT_FOUND',
  'SSH_CONNECTION_REFUSED',
  'SSH_NETWORK_UNREACHABLE',
  'SSH_TIMEOUT',
  'SSH_CONNECTION_CLOSED_BY_SERVER',
  'SSH_CONNECTION_LOST',
  'SSH_HOST_KEY_CHANGED',
  'SSH_HOST_KEY_REJECTED',
  'SSH_AUTH_FAILED',
  'SSH_ALGORITHM_MISMATCH',
  'SSH_SHELL_FAILED',
  'SSH_FAILED',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export interface IpcError {
  code: ErrorCode
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)
}
