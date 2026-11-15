import { z } from 'zod'
import { normalizeAddress } from './address'
import { idSchema, keyTypeSchema, portSchema, timestampSchema } from './records'

/**
 * What the renderer may know about a saved host. No secret values and no
 * secret ids: only how the host signs in.
 */
export const hostViewSchema = z.object({
  id: idSchema,
  name: z.string(),
  address: z.string(),
  port: portSchema,
  username: z.string(),
  signIn: z.discriminatedUnion('method', [
    z.object({ method: z.literal('password') }),
    z.object({ method: z.literal('ask') }),
    z.object({
      method: z.literal('key'),
      keyName: z.string(),
      keyType: keyTypeSchema,
      hasPassphrase: z.boolean(),
    }),
  ]),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  lastConnectedAt: timestampSchema.optional(),
})
export type HostView = z.infer<typeof hostViewSchema>

const MAX_SECRET_LENGTH = 4096

export const addressSchema = z
  .string()
  .max(260)
  .transform((value, ctx) => {
    const address = normalizeAddress(value)
    if (address === null) {
      ctx.addIssue({ code: 'custom', message: 'Invalid address' })
      return z.NEVER
    }
    return address
  })

export const usernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^\s@:]+$/)

/**
 * hosts:save. `id` present = edit.
 * Password: a value saves it; '' asks every time; undefined keeps the saved
 * one (and on a new host means: ask every time).
 * Key: `keyFileToken` comes from hosts:pickKeyFile; undefined keeps the key.
 */
export const hostSaveRequestSchema = z.strictObject({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(200),
  address: addressSchema,
  port: portSchema.optional(),
  username: usernameSchema,
  auth: z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('password'),
      password: z.string().max(MAX_SECRET_LENGTH).optional(),
    }),
    z.strictObject({
      type: z.literal('key'),
      keyFileToken: z
        .string()
        .regex(/^[0-9a-f]{32}$/)
        .optional(),
      passphrase: z.string().max(MAX_SECRET_LENGTH).optional(),
    }),
  ]),
})
export type HostSaveRequest = z.input<typeof hostSaveRequestSchema>
export type ParsedHostSaveRequest = z.output<typeof hostSaveRequestSchema>

/** What main tells the renderer about a key file the user picked. Never the key itself. */
export const keyFileInfoSchema = z.object({
  token: z.string(),
  fileName: z.string(),
  keyType: keyTypeSchema.optional(),
  encrypted: z.boolean(),
})
export type KeyFileInfo = z.infer<typeof keyFileInfoSchema>
