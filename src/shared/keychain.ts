import { z } from 'zod'
import { idSchema, keyTypeSchema, timestampSchema } from './records'

const MAX_SECRET_LENGTH = 4096
const tokenSchema = z.string().regex(/^[0-9a-f]{32}$/)
const nameSchema = z.string().trim().min(1).max(200)

/**
 * How something signs in, as the renderer may know it: the method and, for a
 * key, which key. Never a secret value or a secret id.
 */
export const signInViewSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('password') }),
  z.object({ method: z.literal('ask') }),
  z.object({ method: z.literal('agent') }),
  z.object({
    method: z.literal('key'),
    keyId: idSchema,
    keyName: z.string(),
    keyType: keyTypeSchema,
    hasPassphrase: z.boolean(),
  }),
])
export type SignInView = z.infer<typeof signInViewSchema>

/**
 * A new or changed sign-in, used by hosts:save and identities:save.
 * - password: a value saves it; '' means ask every time; undefined keeps the
 *   saved password (on a new record: ask every time).
 * - key: a key file from hosts:pickKeyFile (it joins the Keychain), or, with
 *   no token, the key already in use (optionally with a new passphrase).
 * - savedKey: a key from the Keychain.
 * - agent: the keys in the Windows OpenSSH agent or Pageant.
 */
export const authRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('password'),
    password: z.string().max(MAX_SECRET_LENGTH).optional(),
  }),
  z.strictObject({
    type: z.literal('key'),
    keyFileToken: tokenSchema.optional(),
    passphrase: z.string().max(MAX_SECRET_LENGTH).optional(),
  }),
  z.strictObject({ type: z.literal('savedKey'), keyId: idSchema }),
  z.strictObject({ type: z.literal('agent') }),
])
export type AuthRequest = z.infer<typeof authRequestSchema>

export const keyViewSchema = z.object({
  id: idSchema,
  name: z.string(),
  type: keyTypeSchema,
  fingerprint: z.string(),
  /** OpenSSH one-line public key. Public, so the renderer may copy it. */
  publicKey: z.string(),
  hasPassphrase: z.boolean(),
  /** Hosts and identities that sign in with this key. */
  usedBy: z.int().min(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})
export type KeyView = z.infer<typeof keyViewSchema>

export const GENERATED_KEY_TYPES = ['ed25519', 'rsa'] as const
export const generatedKeyTypeSchema = z.enum(GENERATED_KEY_TYPES)
export type GeneratedKeyType = z.infer<typeof generatedKeyTypeSchema>

export const keyGenerateRequestSchema = z.strictObject({
  name: nameSchema,
  type: generatedKeyTypeSchema,
  /** '' or missing: the private key is stored without a passphrase (still inside the vault). */
  passphrase: z.string().max(MAX_SECRET_LENGTH).optional(),
})
export type KeyGenerateRequest = z.input<typeof keyGenerateRequestSchema>

export const keyImportRequestSchema = z.strictObject({
  keyFileToken: tokenSchema,
  /** The file name when missing. */
  name: nameSchema.optional(),
  passphrase: z.string().max(MAX_SECRET_LENGTH).optional(),
})
export type KeyImportRequest = z.input<typeof keyImportRequestSchema>

export const identityViewSchema = z.object({
  id: idSchema,
  name: z.string(),
  username: z.string(),
  signIn: signInViewSchema,
  /** Hosts and groups that use this identity. */
  usedBy: z.int().min(0),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})
export type IdentityView = z.infer<typeof identityViewSchema>

export const identitySaveRequestSchema = z.strictObject({
  id: idSchema.optional(),
  name: nameSchema,
  username: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[^\s@:]+$/),
  auth: authRequestSchema,
})
export type IdentitySaveRequest = z.input<typeof identitySaveRequestSchema>
export type ParsedIdentitySaveRequest = z.output<typeof identitySaveRequestSchema>

/** Which agent "Agent" sign-in uses. `auto`: the OpenSSH agent when it runs, else Pageant. */
export const AGENT_SOURCES = ['auto', 'openssh', 'pageant'] as const
export const agentSourceSchema = z.enum(AGENT_SOURCES)
export type AgentSource = z.infer<typeof agentSourceSchema>

const agentProbeSchema = z.object({
  running: z.boolean(),
  /** Keys the agent offers; null when it is not running. */
  keys: z.int().min(0).nullable(),
})

export const agentStatusSchema = z.object({
  openssh: agentProbeSchema,
  pageant: agentProbeSchema,
  /** The agent "Agent" sign-in would use now; null when none runs. */
  active: z.enum(['openssh', 'pageant']).nullable(),
})
export type AgentStatus = z.infer<typeof agentStatusSchema>

/** "Upgrade to key login", step 1: pick or make a key and see the exact command. */
export const keyUpgradePrepareSchema = z.strictObject({
  hostId: idSchema,
  key: z.union([
    z.strictObject({ generate: generatedKeyTypeSchema }),
    z.strictObject({ keyId: idSchema }),
  ]),
})
export type KeyUpgradePrepareRequest = z.input<typeof keyUpgradePrepareSchema>

export const keyUpgradePlanSchema = z.object({
  upgradeId: tokenSchema,
  /** Runs on the server, exactly as shown. */
  command: z.string(),
  keyType: keyTypeSchema,
  fingerprint: z.string(),
})
export type KeyUpgradePlan = z.infer<typeof keyUpgradePlanSchema>

/** Step 2: run the command, test the key, switch the host. */
export const keyUpgradeRunSchema = z.strictObject({ upgradeId: tokenSchema })
