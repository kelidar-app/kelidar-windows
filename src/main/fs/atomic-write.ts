import { randomBytes } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'

/**
 * On Windows a rename can fail for a moment while another process (often an
 * antivirus scanner or the search indexer) has the file open.
 */
const TRANSIENT_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_ATTEMPTS = 8

function isTransient(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    TRANSIENT_CODES.has(error.code)
  )
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      if (attempt >= RENAME_ATTEMPTS || !isTransient(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt))
    }
  }
}

/** Write to a temp file next to the target, then rename it over the target. */
export async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const tempPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(tempPath, contents, { encoding: 'utf8', flush: true })
    await renameWithRetry(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}
