import { randomBytes } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'

/** Write to a temp file next to the target, then rename it over the target. */
export async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const tempPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(tempPath, contents, { encoding: 'utf8', flush: true })
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}
