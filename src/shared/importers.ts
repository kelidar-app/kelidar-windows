import { z } from 'zod'
import { portSchema, proxyTypeSchema } from './records'

/**
 * Step 2.6: importing hosts from the user's ssh config and PuTTY sessions.
 * Main reads both and keeps what it found under a token; the renderer sees a
 * preview (never a key or a password) and sends back the rows to import.
 */
export const IMPORT_SOURCES = ['sshConfig', 'putty'] as const
export const importSourceSchema = z.enum(IMPORT_SOURCES)
export type ImportSource = z.infer<typeof importSourceSchema>

/** Things the preview tells the user about a row. Each has a translated explanation. */
export const IMPORT_WARNINGS = [
  /** The key file needs a passphrase: the host signs in with the agent (Pageant) instead. */
  'keyEncrypted',
  /** The key file named in the settings could not be read. */
  'keyUnreadable',
  /** No user name was saved: the Windows user name is used. */
  'noUsername',
  /** The jump host is not among the imported or saved hosts. */
  'jumpNotFound',
  /** Several jump hosts in a row: only the last one is kept. */
  'jumpChain',
  /** ProxyCommand (or PuTTY's local proxy command) is not supported. */
  'proxyCommand',
  /** SOCKS4 or Telnet proxies are not supported. */
  'proxyUnsupported',
] as const
export const importWarningSchema = z.enum(IMPORT_WARNINGS)
export type ImportWarning = z.infer<typeof importWarningSchema>

export const importCandidateSchema = z.object({
  id: z.string(),
  source: importSourceSchema,
  name: z.string(),
  address: z.string(),
  port: portSchema,
  username: z.string(),
  signIn: z.enum(['key', 'agent', 'ask']),
  keyName: z.string().optional(),
  /** The jump host, by name. */
  jump: z.string().optional(),
  proxy: z.object({ type: proxyTypeSchema, host: z.string(), port: portSchema }).optional(),
  agentForward: z.boolean(),
  /** A saved host already has this address, port and user name. */
  duplicateOf: z.string().optional(),
  warnings: z.array(importWarningSchema),
})
export type ImportCandidate = z.infer<typeof importCandidateSchema>

export const importScanSchema = z.object({
  token: z.string(),
  /** found: the file or the PuTTY settings exist (even with no usable host). */
  sources: z.array(z.object({ source: importSourceSchema, found: z.boolean() })),
  candidates: z.array(importCandidateSchema),
})
export type ImportScan = z.infer<typeof importScanSchema>

export const importApplyRequestSchema = z.strictObject({
  token: z.string().regex(/^[0-9a-f]{32}$/),
  ids: z.array(z.string().max(20)).min(1).max(5000),
})
export const importApplyResponseSchema = z.object({
  hosts: z.int().min(0),
  keys: z.int().min(0),
})
export type ImportApplyResult = z.infer<typeof importApplyResponseSchema>

/** The tag each imported host gets, so they are easy to find afterwards. */
export const IMPORT_TAGS: Record<ImportSource, string> = {
  sshConfig: 'ssh-config',
  putty: 'putty',
}
