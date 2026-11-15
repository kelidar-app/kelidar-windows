import type { ErrorCode } from '@shared/errors'

/** Throw this from an IPC handler to return a specific error code to the renderer. */
export class AppError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, options?: { cause?: unknown }) {
    super(code, options)
    this.name = 'AppError'
    this.code = code
  }
}
