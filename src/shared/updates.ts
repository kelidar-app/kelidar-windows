import { z } from 'zod'
import { ERROR_CODES } from './errors'

/**
 * Step 2.7: updates from GitHub Releases (electron-updater). Main checks
 * on start (when allowed), downloads in the background, and the renderer
 * offers "Restart to update" once the download is ready.
 */
export const UPDATE_STATES = [
  /** A development build, or not installed by the installer: nothing to update. */
  'disabled',
  'idle',
  'checking',
  'upToDate',
  'downloading',
  'ready',
  'error',
] as const

export const MAX_RELEASE_NOTES = 10_000

export const updateStatusSchema = z.object({
  state: z.enum(UPDATE_STATES),
  currentVersion: z.string(),
  /** The new version (downloading or ready). */
  version: z.string().optional(),
  /** Release notes as plain text: main strips any markup from GitHub. */
  notes: z.string().max(MAX_RELEASE_NOTES).optional(),
  /** Download progress, 0 to 100. */
  percent: z.number().min(0).max(100).optional(),
  error: z.enum(ERROR_CODES).optional(),
  /** When the last check finished. */
  checkedAt: z.iso.datetime().optional(),
})
export type UpdateStatus = z.infer<typeof updateStatusSchema>
