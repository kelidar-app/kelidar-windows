import { z } from 'zod'
import type { ErrorCode } from './errors'
import { idSchema, portSchema } from './records'

/** Connection states, in the order a healthy session goes through them. */
export const SESSION_STATES = [
  'connecting',
  'verifying-host-key',
  'authenticating',
  'ready',
  'closed',
  'error',
] as const
export type SessionState = (typeof SESSION_STATES)[number]

export const terminalSizeSchema = z.object({
  cols: z.int().min(2).max(1000),
  rows: z.int().min(1).max(500),
})

export const sessionOpenRequestSchema = z.union([
  z.strictObject({ hostId: idSchema, ...terminalSizeSchema.shape }),
])
export type SessionOpenRequest = z.input<typeof sessionOpenRequestSchema>

export const sessionTargetSchema = z.object({
  address: z.string(),
  port: portSchema,
  username: z.string(),
})
export type SessionTarget = z.infer<typeof sessionTargetSchema>

export const sessionOpenResponseSchema = z.object({
  sessionId: idSchema,
  title: z.string(),
  target: sessionTargetSchema,
  hostId: idSchema.optional(),
})
export type SessionOpenResponse = z.infer<typeof sessionOpenResponseSchema>

/** Keystrokes and pastes. 1 MB is far more than any paste a terminal should take at once. */
export const sessionInputSchema = z.strictObject({
  sessionId: idSchema,
  data: z.string().min(1).max(1_000_000),
})

export const sessionResizeSchema = z.strictObject({
  sessionId: idSchema,
  ...terminalSizeSchema.shape,
})

/** The renderer reports how many output bytes it has rendered (flow control). */
export const sessionAckSchema = z.strictObject({
  sessionId: idSchema,
  bytes: z.int().min(0).max(1_000_000_000),
})

export const sessionIdSchema = z.strictObject({ sessionId: idSchema })

export const hostKeyInfoSchema = z.object({
  host: z.string(),
  port: portSchema,
  keyType: z.string(),
  fingerprint: z.string(),
})
export type HostKeyInfo = z.infer<typeof hostKeyInfoSchema>

/** session:state (main to renderer). `hostKey` is set for host key problems. */
export interface SessionStateEvent {
  sessionId: string
  state: SessionState
  error?: ErrorCode
  hostKey?: HostKeyInfo
}

/** session:data (main to renderer): a batch of terminal output. */
export interface SessionDataEvent {
  sessionId: string
  data: Uint8Array
}

/** Questions main asks the user during a connection. */
export type PromptRequest =
  | ({ promptId: string; sessionId: string; kind: 'hostKey' } & HostKeyInfo)
  | {
      promptId: string
      sessionId: string
      kind: 'password'
      username: string
      host: string
      /** 0 on the first try; higher after a wrong password. */
      attempt: number
    }
  | {
      promptId: string
      sessionId: string
      kind: 'keyboardInteractive'
      host: string
      name: string
      instructions: string
      prompts: { text: string; echo: boolean }[]
    }

export const promptAnswerSchema = z.strictObject({
  promptId: z.string().regex(/^[0-9a-f]{32}$/),
  answer: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('hostKey'), trust: z.boolean() }),
    z.strictObject({ kind: z.literal('password'), value: z.string().max(4096).nullable() }),
    z.strictObject({
      kind: z.literal('keyboardInteractive'),
      values: z.array(z.string().max(4096)).max(20).nullable(),
    }),
  ]),
})
export type PromptAnswer = z.infer<typeof promptAnswerSchema>['answer']

export const knownHostForgetSchema = z.strictObject({ host: z.string().max(255), port: portSchema })
