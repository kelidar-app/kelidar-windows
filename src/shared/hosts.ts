import { z } from 'zod'
import { normalizeAddress } from './address'
import {
  colorSchema,
  environmentSchema,
  idSchema,
  keyTypeSchema,
  MAX_TAGS,
  portSchema,
  tagSchema,
  timestampSchema,
} from './records'

/**
 * What the renderer may know about a saved host. No secret values and no
 * secret ids: only how the host signs in.
 */
export const hostViewSchema = z.object({
  id: idSchema,
  name: z.string(),
  address: z.string(),
  /** The port used to connect: the host's own, else its group's, else 22. */
  port: portSchema,
  /** The port the host sets itself (shown in the form). */
  ownPort: portSchema.optional(),
  username: z.string(),
  groupId: idSchema.optional(),
  tags: z.array(z.string()),
  color: colorSchema.optional(),
  /** The environment in effect: the host's own, else its group's. */
  environment: environmentSchema.optional(),
  ownEnvironment: environmentSchema.optional(),
  favorite: z.boolean(),
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
 * Tags as typed: trimmed, without a leading #, duplicates (ignoring case)
 * dropped, first spelling kept.
 */
export const tagListSchema = z
  .array(
    z
      .string()
      .trim()
      .transform((tag) => tag.replace(/^#+/, '')),
  )
  .max(MAX_TAGS * 2)
  .transform((tags) => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const tag of tags) {
      const key = tag.toLocaleLowerCase()
      if (tag === '' || seen.has(key)) continue
      seen.add(key)
      out.push(tag)
    }
    return out
  })
  .pipe(z.array(tagSchema).max(MAX_TAGS))

/** Splits what the user typed in the tags field: commas or spaces separate tags. */
export function splitTags(text: string): string[] {
  return text.split(/[\s,،]+/u).filter((tag) => tag !== '')
}

/**
 * hosts:save. `id` present = edit. Organizing fields (group, tags, color,
 * environment, port) replace the saved ones: left out means none. Favorite
 * is kept; hosts:setFavorite changes it.
 * Password: a value saves it; '' asks every time; undefined keeps the saved
 * one (and on a new host means: ask every time).
 * Key: `keyFileToken` comes from hosts:pickKeyFile; undefined keeps the key.
 * fromSession: the password or key that worked in a Quick Connect session.
 */
export const hostSaveRequestSchema = z.strictObject({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(200),
  address: addressSchema,
  port: portSchema.optional(),
  groupId: idSchema.optional(),
  tags: tagListSchema.optional(),
  color: colorSchema.optional(),
  environment: environmentSchema.optional(),
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
    /** The sign-in that worked in a Quick Connect session (main keeps it). */
    z.strictObject({ type: z.literal('fromSession'), sessionId: idSchema }),
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
