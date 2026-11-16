import { z } from 'zod'
import { normalizeAddress } from './address'
import { authRequestSchema, signInViewSchema } from './keychain'
import {
  colorSchema,
  environmentSchema,
  idSchema,
  keyTypeSchema,
  MAX_STARTUP_COMMAND,
  MAX_TAGS,
  portSchema,
  proxyTypeSchema,
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
  /** The user name used to connect: the host's own, or its identity's. */
  username: z.string(),
  /** The user name the host sets itself; undefined when it uses an identity. */
  ownUsername: z.string().optional(),
  groupId: idSchema.optional(),
  tags: z.array(z.string()),
  color: colorSchema.optional(),
  /** The environment in effect: the host's own, else its group's. */
  environment: environmentSchema.optional(),
  ownEnvironment: environmentSchema.optional(),
  favorite: z.boolean(),
  /** The sign-in used to connect: the host's own, or its identity's. */
  signIn: signInViewSchema,
  /** Set when the host signs in with an identity: its own, or its group's. */
  identity: z
    .object({ id: idSchema, name: z.string(), from: z.enum(['host', 'group']) })
    .optional(),
  agentForward: z.boolean(),
  /** The jump host the host connects through: its own, or its group's. */
  jump: z
    .object({ hostId: idSchema, name: z.string(), from: z.enum(['host', 'group']) })
    .optional(),
  /** What the host itself says: inherit from the group, connect directly, or a host. */
  ownJump: z.union([
    z.object({ type: z.literal('inherit') }),
    z.object({ type: z.literal('none') }),
    z.object({ type: z.literal('host'), hostId: idSchema }),
  ]),
  proxy: z
    .object({
      type: proxyTypeSchema,
      host: z.string(),
      port: portSchema,
      username: z.string().optional(),
      hasPassword: z.boolean(),
    })
    .optional(),
  startupCommand: z.string().optional(),
  stickySession: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  lastConnectedAt: timestampSchema.optional(),
})
export type HostView = z.infer<typeof hostViewSchema>

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
 * environment, port, agent forwarding) replace the saved ones: left out means
 * none. Favorite is kept; hosts:setFavorite changes it.
 * Sign-in: the auth requests in keychain.ts, plus
 * - identity: sign in with a saved identity (no user name needed);
 * - inherit: sign in with the group's identity (no user name needed);
 * - fromSession: the password or key that worked in a Quick Connect session.
 * Every other sign-in needs a user name.
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
  agentForward: z.boolean().optional(),
  /** Missing: inherit the group's jump host. */
  jump: z
    .discriminatedUnion('type', [
      z.strictObject({ type: z.literal('inherit') }),
      z.strictObject({ type: z.literal('none') }),
      z.strictObject({ type: z.literal('host'), hostId: idSchema }),
    ])
    .optional(),
  /**
   * Missing: no proxy. A password value saves it; '' removes it; undefined
   * keeps the saved one when the proxy stays the same.
   */
  proxy: z
    .strictObject({
      type: proxyTypeSchema,
      host: addressSchema,
      port: portSchema,
      username: z.string().trim().min(1).max(255).optional(),
      password: z.string().max(4096).optional(),
    })
    .optional(),
  startupCommand: z
    .string()
    .trim()
    .max(MAX_STARTUP_COMMAND)
    .regex(/^[^\r\n]*$/)
    .optional(),
  stickySession: z.boolean().optional(),
  username: usernameSchema.optional(),
  auth: z.discriminatedUnion('type', [
    ...authRequestSchema.options,
    z.strictObject({ type: z.literal('identity'), identityId: idSchema }),
    z.strictObject({ type: z.literal('inherit') }),
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
