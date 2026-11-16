import { z } from 'zod'

/**
 * The stored data model (docs/ARCHITECTURE.md, "مدل داده"). Every record has
 * id, createdAt, updatedAt and an optional deletedAt so two copies of the data
 * can be merged later (AGENTS.md, architecture rule 8). Deleting a record sets
 * deletedAt and keeps a tombstone; secrets also lose their value.
 *
 * Secret and SshKey are vault-internal: main never sends them to the renderer.
 * The renderer only sees the views in hosts.ts.
 */

export const idSchema = z.uuid()
export type Id = z.infer<typeof idSchema>

export const timestampSchema = z.iso.datetime()

export const baseRecordSchema = z.object({
  id: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: timestampSchema.optional(),
})
export type BaseRecord = z.infer<typeof baseRecordSchema>

export const MAX_PORT = 65_535
export const DEFAULT_SSH_PORT = 22
export const portSchema = z.int().min(1).max(MAX_PORT)

/** How a host signs in. `ask` means: ask for the password every time. */
export const authRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('password'), secretId: idSchema }),
  z.object({ type: z.literal('key'), keyId: idSchema }),
  z.object({ type: z.literal('ask') }),
])
export type AuthRef = z.infer<typeof authRefSchema>

/** Named colors, not hex values, so each one can have a light and a dark shade. */
export const COLORS = [
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'violet',
  'pink',
  'gray',
] as const
export const colorSchema = z.enum(COLORS)
export type ColorId = z.infer<typeof colorSchema>

export const ENVIRONMENTS = ['production', 'staging', 'development'] as const
export const environmentSchema = z.enum(ENVIRONMENTS)
export type Environment = z.infer<typeof environmentSchema>

export const MAX_TAGS = 30
/** One word: no spaces, commas or #, so "#tag" works in search. */
export const tagSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[^\s,#]+$/u)

/**
 * Values a group hands down to its hosts (and subgroups) unless they set
 * their own. Identity and jump host join this object in Steps 2.2 and 2.3.
 */
export const groupDefaultsSchema = z.object({
  port: portSchema.optional(),
  environment: environmentSchema.optional(),
})
export type GroupDefaults = z.infer<typeof groupDefaultsSchema>

export const MAX_GROUP_DEPTH = 8

export const groupRecordSchema = baseRecordSchema.extend({
  name: z.string().min(1).max(200),
  parentId: idSchema.optional(),
  color: colorSchema.optional(),
  defaults: groupDefaultsSchema.optional(),
})
export type GroupRecord = z.infer<typeof groupRecordSchema>

export const hostRecordSchema = baseRecordSchema.extend({
  name: z.string().min(1).max(200),
  address: z.string().min(1).max(255),
  port: portSchema.optional(),
  groupId: idSchema.optional(),
  tags: z.array(tagSchema).max(MAX_TAGS),
  color: colorSchema.optional(),
  environment: environmentSchema.optional(),
  favorite: z.boolean().optional(),
  username: z.string().min(1).max(255).optional(),
  auth: authRefSchema.optional(),
  lastConnectedAt: timestampSchema.optional(),
})
export type HostRecord = z.infer<typeof hostRecordSchema>

/** Never leaves the main process. */
export const secretRecordSchema = baseRecordSchema.extend({
  value: z.string().max(1_000_000),
})
export type SecretRecord = z.infer<typeof secretRecordSchema>

export const KEY_TYPES = ['ed25519', 'rsa', 'ecdsa', 'dsa'] as const
export const keyTypeSchema = z.enum(KEY_TYPES)
export type KeyKind = z.infer<typeof keyTypeSchema>

export const sshKeyRecordSchema = baseRecordSchema.extend({
  name: z.string().min(1).max(260),
  type: keyTypeSchema,
  publicKey: z.string().max(20_000),
  fingerprint: z.string().max(200),
  privateKeySecretId: idSchema,
  passphraseSecretId: idSchema.optional(),
})
export type SshKeyRecord = z.infer<typeof sshKeyRecordSchema>

/**
 * A server key the user trusted. One entry per address and port.
 * The architecture document lists only host, port, keyType, fingerprint and
 * addedAt; the base fields are added for rule 8 (createdAt plays addedAt).
 */
export const knownHostRecordSchema = baseRecordSchema.extend({
  host: z.string().min(1).max(255),
  port: portSchema,
  keyType: z.string().min(1).max(100),
  fingerprint: z.string().min(1).max(200),
})
export type KnownHostRecord = z.infer<typeof knownHostRecordSchema>
