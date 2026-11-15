import { z } from 'zod'
import type { IpcError } from './errors'
import { hostSaveRequestSchema, hostViewSchema, keyFileInfoSchema } from './hosts'
import type { IpcChannel } from './ipc-channels'
import type { IpcEvent } from './ipc-events'
import { idSchema } from './records'
import {
  knownHostForgetSchema,
  promptAnswerSchema,
  sessionAckSchema,
  sessionIdSchema,
  sessionInputSchema,
  sessionOpenRequestSchema,
  sessionOpenResponseSchema,
  sessionResizeSchema,
  type PromptRequest,
  type SessionDataEvent,
  type SessionStateEvent,
} from './session'
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
  /** Terminal paste: the user's clipboard text, read in main on request. */
  'clipboard:readText': {
    request: noPayload,
    response: z.object({ text: z.string() }),
  },
  /** Terminal copy-on-select. Never used for secrets: main copies those itself. */
  'clipboard:writeText': {
    request: z.strictObject({ text: z.string().max(10_000_000) }),
    response: z.undefined(),
  },
  'hosts:list': {
    request: noPayload,
    response: z.array(hostViewSchema),
  },
  'hosts:save': {
    request: hostSaveRequestSchema,
    response: hostViewSchema,
  },
  'hosts:delete': {
    request: z.strictObject({ id: idSchema }),
    response: z.undefined(),
  },
  /** Opens a file dialog in main. null when the user cancels. */
  'hosts:pickKeyFile': {
    request: noPayload,
    response: keyFileInfoSchema.nullable(),
  },
  /** Removes the trusted server key for an address and port (after a changed-key warning). */
  'knownHosts:forget': {
    request: knownHostForgetSchema,
    response: z.undefined(),
  },
  'prompt:answer': {
    request: promptAnswerSchema,
    response: z.undefined(),
  },
  /** Starts connecting and returns at once; progress arrives as session:state events. */
  'session:open': {
    request: sessionOpenRequestSchema,
    response: sessionOpenResponseSchema,
  },
  'session:input': {
    request: sessionInputSchema,
    response: z.undefined(),
  },
  'session:resize': {
    request: sessionResizeSchema,
    response: z.undefined(),
  },
  'session:ack': {
    request: sessionAckSchema,
    response: z.undefined(),
  },
  'session:close': {
    request: sessionIdSchema,
    response: z.undefined(),
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

/** Payloads of the events main pushes to the renderer. Main is trusted, so these are types only. */
export interface IpcEventPayloads {
  'session:data': SessionDataEvent
  'session:state': SessionStateEvent
  'prompt:request': PromptRequest
  'prompt:cancel': { promptId: string }
}
export type IpcEventPayload<E extends IpcEvent> = IpcEventPayloads[E]

/** The one object the preload exposes to the renderer as `window.api`. */
export interface RendererApi {
  invoke<C extends IpcChannel>(
    channel: C,
    ...args: IpcInvokeArgs<C>
  ): Promise<IpcResult<IpcResponse<C>>>
  /** Subscribes to an event from main. Returns the unsubscribe function. */
  on<E extends IpcEvent>(event: E, listener: (payload: IpcEventPayload<E>) => void): () => void
}
