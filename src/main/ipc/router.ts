import { ipcContract, type IpcParsedRequest, type IpcResponse, type IpcResult } from '@shared/ipc'
import type { IpcChannel } from '@shared/ipc-channels'
import { AppError } from './app-error'
import type { FrameLike } from './sender'

/** The parts of an invoke event the router needs (Electron's IpcMainInvokeEvent fits). */
export interface InvokeEventLike {
  readonly senderFrame: FrameLike | null
}

/** The part of Electron's ipcMain the router needs. */
export interface IpcMainLike<E extends InvokeEventLike> {
  handle(channel: string, listener: (event: E, ...args: unknown[]) => unknown): void
}

export type IpcHandler<C extends IpcChannel, E extends InvokeEventLike> = (
  payload: IpcParsedRequest<C>,
  event: E,
) => IpcResponse<C> | Promise<IpcResponse<C>>

export interface IpcRouterOptions<E extends InvokeEventLike> {
  isTrustedSender: (frame: FrameLike | null) => boolean
  onInternalError?: (channel: IpcChannel, error: unknown, event: E) => void
}

/**
 * Wraps ipcMain.handle. Every call goes through the same three gates:
 * 1. the sender frame must be one of ours,
 * 2. the payload must match the channel's zod schema,
 * 3. the result must match the response schema (unknown fields are stripped).
 * Handlers never throw across IPC; the renderer always gets an IpcResult.
 */
export function createIpcRouter<E extends InvokeEventLike>(
  ipc: IpcMainLike<E>,
  options: IpcRouterOptions<E>,
) {
  return {
    handle<C extends IpcChannel>(channel: C, handler: IpcHandler<C, E>): void {
      const contract = ipcContract[channel]
      ipc.handle(channel, async (event, ...args): Promise<IpcResult<IpcResponse<C>>> => {
        if (!options.isTrustedSender(event.senderFrame)) {
          return { ok: false, error: { code: 'IPC_FORBIDDEN' } }
        }
        if (args.length > 1) {
          return { ok: false, error: { code: 'IPC_INVALID_PAYLOAD' } }
        }
        const parsed = contract.request.safeParse(args[0])
        if (!parsed.success) {
          return { ok: false, error: { code: 'IPC_INVALID_PAYLOAD' } }
        }
        try {
          const result = await handler(parsed.data as IpcParsedRequest<C>, event)
          const data = contract.response.parse(result) as IpcResponse<C>
          return { ok: true, data }
        } catch (error) {
          if (error instanceof AppError) {
            return { ok: false, error: { code: error.code } }
          }
          options.onInternalError?.(channel, error, event)
          return { ok: false, error: { code: 'INTERNAL' } }
        }
      })
    },
  }
}

export type IpcRouter<E extends InvokeEventLike> = ReturnType<typeof createIpcRouter<E>>
