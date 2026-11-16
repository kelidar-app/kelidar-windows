import { z } from 'zod'
import { ERROR_CODES } from './errors'
import { idSchema } from './records'

/**
 * Step 2.5: master password, lock, clipboard clearing, encrypted export and
 * import, and the automatic backups.
 */

export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 1024

/** A master or export password typed by the user. Never sent back to the renderer. */
export const newPasswordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH)
/** A password being checked: any length, so a wrong one gets the "wrong password" message. */
export const typedPasswordSchema = z.string().min(1).max(MAX_PASSWORD_LENGTH)

export const VAULT_STATES = ['opening', 'unlocked', 'locked', 'failed'] as const

export const vaultStatusSchema = z.object({
  state: z.enum(VAULT_STATES),
  /** A master password is set. */
  masterPassword: z.boolean(),
  /** Why the vault could not be opened (state 'failed'). */
  error: z.enum(ERROR_CODES).optional(),
})
export type VaultStatus = z.infer<typeof vaultStatusSchema>

/** Set (no current), change (both), or remove (next null) the master password. */
export const masterPasswordRequestSchema = z.strictObject({
  current: typedPasswordSchema.optional(),
  next: newPasswordSchema.nullable(),
})

export const backupInfoSchema = z.object({
  name: z.string(),
  savedAt: z.iso.datetime(),
  size: z.int().min(0),
  /** null: the file is damaged and cannot be restored. */
  protection: z.enum(['safeStorage', 'password']).nullable(),
})
export type BackupInfoView = z.infer<typeof backupInfoSchema>

export const backupNameSchema = z
  .string()
  .max(200)
  .regex(/^vault-[\w-]+\.json$/)

/** The password of a saved host or identity goes to the clipboard, written by main. */
export const secretCopyRequestSchema = z.strictObject({
  kind: z.enum(['host', 'identity']),
  id: idSchema,
})
export const secretCopyResponseSchema = z.object({
  /** Seconds until main clears the clipboard; 0: it is not cleared. */
  clearsIn: z.int().min(0),
})

export const exportRequestSchema = z.strictObject({ password: newPasswordSchema })
/** null when the user cancelled the save dialog. */
export const exportResponseSchema = z.object({ fileName: z.string() }).nullable()

const tokenSchema = z.string().regex(/^[0-9a-f]{32}$/)

/** Import, step 1: the file chosen in main's dialog. */
export const importPickResponseSchema = z
  .object({ token: tokenSchema, fileName: z.string() })
  .nullable()
/** Import, step 2: its password; the records are merged into the vault. */
export const importRequestSchema = z.strictObject({
  token: tokenSchema,
  password: typedPasswordSchema,
})
export const importSummarySchema = z.object({
  added: z.int().min(0),
  updated: z.int().min(0),
  unchanged: z.int().min(0),
})
export type ImportSummary = z.infer<typeof importSummarySchema>

/** Values for the Security settings. */
export const AUTO_LOCK_MINUTES = [0, 1, 5, 15, 30, 60] as const
export const CLIPBOARD_CLEAR_SECONDS = [0, 15, 30, 60, 120] as const
