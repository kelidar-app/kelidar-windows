import { z } from 'zod'
import type { IpcError } from './errors'
import type { IpcChannel } from './ipc-channels'
import { uiSettingsPatchSchema, uiSettingsSchema } from './settings'

/**
 * The single IPC contract between renderer and main. Every channel is listed
 * in ipc-channels.ts and described here: the request main accepts and the
 * response it returns. Main parses each request with `request` and passes
 * each response through `response`, which strips unknown fields.
 */
const noPayload = z.undefined()
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const ipcContract = {
  'app:getVersion': {
    request: noPayload,
    response: z.object({ version: z.string() }),
  },
  'settings:get': {
    request: noPayload,
    response: uiSettingsSchema,
  },
  'settings:update': {
    request: uiSettingsPatchSchema,
    response: uiSettingsSchema,
  },
  'window:setTitleBarOverlay': {
    request: z.strictObject({ color: hexColor, symbolColor: hexColor }),
    response: z.undefined(),
  },
} as const satisfies Record<IpcChannel, { request: z.ZodType; response: z.ZodType }>

export type IpcContract = typeof ipcContract
export type IpcRequest<C extends IpcChannel> = z.input<IpcContract[C]['request']>
export type IpcParsedRequest<C extends IpcChannel> = z.output<IpcContract[C]['request']>
export type IpcResponse<C extends IpcChannel> = z.output<IpcContract[C]['response']>

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }

/** Arguments after the channel name: none for channels without a payload. */
export type IpcInvokeArgs<C extends IpcChannel> =
  undefined extends IpcRequest<C> ? [] : [payload: IpcRequest<C>]

/** The one object the preload exposes to the renderer as `window.api`. */
export interface RendererApi {
  invoke<C extends IpcChannel>(
    channel: C,
    ...args: IpcInvokeArgs<C>
  ): Promise<IpcResult<IpcResponse<C>>>
}
