/**
 * Error codes main returns over IPC. The renderer maps each code to a
 * translated message (errors.<code> in en.json and fa.json).
 */
export const ERROR_CODES = [
  'IPC_FORBIDDEN',
  'IPC_INVALID_PAYLOAD',
  'INTERNAL',
  'SETTINGS_WRITE_FAILED',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export interface IpcError {
  code: ErrorCode
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)
}
