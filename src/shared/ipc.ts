import { z } from 'zod'
import type { IpcError } from './errors'
import { groupSaveRequestSchema, groupViewSchema } from './groups'
import { hostSaveRequestSchema, hostViewSchema, keyFileInfoSchema } from './hosts'
import {
  agentStatusSchema,
  identitySaveRequestSchema,
  identityViewSchema,
  keyGenerateRequestSchema,
  keyImportRequestSchema,
  keyUpgradePlanSchema,
  keyUpgradePrepareSchema,
  keyUpgradeRunSchema,
  keyViewSchema,
} from './keychain'
import type { IpcChannel } from './ipc-channels'
import type { IpcEvent } from './ipc-events'
import { idSchema } from './records'
import {
  knownHostForgetSchema,
  promptAnswerSchema,
  sessionAckSchema,
  sessionDuplicateSchema,
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

const byId = z.strictObject({ id: idSchema })

export const ipcContract = {
  /** Which agents run and how many keys they offer. Never the keys. */
  'agent:status': {
    request: noPayload,
    response: agentStatusSchema,
  },
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
  'groups:list': {
    request: noPayload,
    response: z.array(groupViewSchema),
  },
  'groups:save': {
    request: groupSaveRequestSchema,
    response: groupViewSchema,
  },
  /** Drag and drop: a group into another group, or to the top level (no parentId). */
  'groups:move': {
    request: z.strictObject({ id: idSchema, parentId: idSchema.optional() }),
    response: groupViewSchema,
  },
  /** Its hosts and subgroups move up to the deleted group's parent. */
  'groups:delete': {
    request: z.strictObject({ id: idSchema }),
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
  /** Drag and drop: a host into a group, or out of any group (no groupId). */
  'hosts:move': {
    request: z.strictObject({ id: idSchema, groupId: idSchema.optional() }),
    response: hostViewSchema,
  },
  'hosts:setFavorite': {
    request: z.strictObject({ id: idSchema, favorite: z.boolean() }),
    response: hostViewSchema,
  },
  /** Opens a file dialog in main. null when the user cancels. */
  'hosts:pickKeyFile': {
    request: noPayload,
    response: keyFileInfoSchema.nullable(),
  },
  /** Upgrade to key login, step 1: the key and the exact command, nothing run yet. */
  'hosts:upgradePrepare': {
    request: keyUpgradePrepareSchema,
    response: keyUpgradePlanSchema,
  },
  /** Step 2: install the key with the shown command, test it, switch the host to it. */
  'hosts:upgradeRun': {
    request: keyUpgradeRunSchema,
    response: hostViewSchema,
  },
  'identities:list': {
    request: noPayload,
    response: z.array(identityViewSchema),
  },
  'identities:save': {
    request: identitySaveRequestSchema,
    response: identityViewSchema,
  },
  /** Refused while a host or group uses the identity. */
  'identities:delete': {
    request: byId,
    response: z.undefined(),
  },
  'keys:list': {
    request: noPayload,
    response: z.array(keyViewSchema),
  },
  'keys:generate': {
    request: keyGenerateRequestSchema,
    response: keyViewSchema,
  },
  /** A file chosen with hosts:pickKeyFile joins the Keychain. */
  'keys:import': {
    request: keyImportRequestSchema,
    response: keyViewSchema,
  },
  'keys:rename': {
    request: z.strictObject({ id: idSchema, name: z.string().trim().min(1).max(200) }),
    response: keyViewSchema,
  },
  /** Refused while a host or identity uses the key. */
  'keys:delete': {
    request: byId,
    response: z.undefined(),
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
  /** A new tab on the same connection: a new channel, no new sign-in. */
  'session:duplicate': {
    request: sessionDuplicateSchema,
    response: sessionOpenResponseSchema,
  },
  /** While reconnecting: try now instead of waiting for the next attempt. */
  'session:reconnectNow': {
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
