import { z } from 'zod'

/**
 * Step 2.6: what a host carries besides how to reach it: notes, links (the
 * admin panel, the provider's console…) and the system found on the server.
 */

/**
 * Only plain http and https links may leave the app, and never with
 * credentials in them. Everything else (file:, javascript:, custom schemes,
 * UNC paths) is refused.
 */
export function isSafeExternalUrl(url: string): boolean {
  if (url.length > 2048) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (parsed.username !== '' || parsed.password !== '') return false
  return parsed.hostname !== ''
}

export const MAX_NOTES = 10_000
export const MAX_LINKS = 20

export const notesSchema = z.string().max(MAX_NOTES)

export const hostLinkSchema = z.object({
  title: z.string().trim().max(100).optional(),
  url: z.string().trim().max(2048).refine(isSafeExternalUrl),
})
export type HostLink = z.infer<typeof hostLinkSchema>
export const hostLinksSchema = z.array(hostLinkSchema).max(MAX_LINKS)

/**
 * Systems with their own badge. Anything else that reads as Linux is
 * 'linux'. The renderer draws a colored badge with the system's name: no
 * trademarked logos.
 */
export const OS_IDS = [
  'ubuntu',
  'debian',
  'fedora',
  'centos',
  'rhel',
  'rocky',
  'almalinux',
  'alpine',
  'arch',
  'opensuse',
  'amazon',
  'oracle',
  'mint',
  'kali',
  'raspbian',
  'freebsd',
  'linux',
] as const
export const osIdSchema = z.enum(OS_IDS)
export type OsId = z.infer<typeof osIdSchema>

/** What /etc/os-release said after the first connection. */
export const hostOsSchema = z.object({
  id: osIdSchema,
  /** PRETTY_NAME, e.g. "Ubuntu 24.04.1 LTS". */
  name: z.string().min(1).max(200),
})
export type HostOs = z.infer<typeof hostOsSchema>

/** The command that reads it. Read-only; shown in Settings before it ever runs. */
export const OS_RELEASE_COMMAND = 'cat /etc/os-release'
