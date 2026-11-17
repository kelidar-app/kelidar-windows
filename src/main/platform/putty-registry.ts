import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PUTTY_SESSIONS_KEY } from '../importers/putty'

/**
 * Reads PuTTY's saved sessions with `reg.exe export` into a private temp
 * folder and deletes it right away. Export writes UTF-16, so session names
 * and user names in any language survive (reg query would print them in
 * the console code page). Returns null when PuTTY has no saved sessions.
 * Read-only: nothing in the registry changes.
 */
export async function readPuttySessions(): Promise<string | null> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'putty-'))
  const file = path.join(dir, 'sessions.reg')
  try {
    const exported = await new Promise<boolean>((resolve) => {
      execFile(
        'reg.exe',
        ['export', PUTTY_SESSIONS_KEY, file, '/y'],
        { windowsHide: true, timeout: 15_000 },
        (error) => {
          // Exit code 1: the key does not exist (PuTTY never saved a session).
          resolve(error === null)
        },
      )
    })
    if (!exported) return null
    const bytes = await readFile(file)
    return bytes[0] === 0xff && bytes[1] === 0xfe
      ? bytes.subarray(2).toString('utf16le')
      : bytes.toString('utf8')
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
