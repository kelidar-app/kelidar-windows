import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { KeyWrapper } from './key-wrapper'
import { listBackups, Vault, VAULT_BACKUP_COUNT, VaultError } from './vault'

export const VAULT_SELF_TEST_FLAG = '--vault-self-test'

export interface SelfTestResult {
  ok: boolean
  checks: { name: string; ok: boolean }[]
}

/**
 * Exercises the real vault with the real key wrapper (safeStorage inside
 * Electron) in a temporary folder: round trip, no plaintext on disk, backup
 * rotation and tamper detection. Unit tests cover the same logic in Node with
 * a fake wrapper; this proves it against DPAPI. Reports pass/fail only.
 */
export async function runVaultSelfTest(wrapper: KeyWrapper): Promise<SelfTestResult> {
  const checks: SelfTestResult['checks'] = []
  const check = async (name: string, run: () => Promise<boolean>): Promise<void> => {
    const ok = await run().catch(() => false)
    checks.push({ name, ok })
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), 'vault-self-test-'))
  const marker = `self-test-${randomBytes(16).toString('hex')}`
  const now = new Date().toISOString()
  const secret = { id: randomUUID(), createdAt: now, updatedAt: now, value: marker }

  try {
    await check('wrapper available', () => wrapper.isAvailable())

    await check('save and reopen', async () => {
      const vault = await Vault.open({ directory: dir, wrapper })
      await vault.update((data) => {
        data.secrets.push(secret)
      })
      const reopened = await Vault.open({ directory: dir, wrapper })
      return reopened.read().secrets[0]?.value === marker
    })

    await check('no plaintext on disk', async () => {
      const vault = await Vault.open({ directory: dir, wrapper })
      const text = await readFile(vault.filePath, 'utf8')
      return !text.includes(marker) && !text.includes(Buffer.from(marker).toString('base64'))
    })

    await check('backup rotation', async () => {
      const vault = await Vault.open({ directory: dir, wrapper })
      for (let i = 0; i < VAULT_BACKUP_COUNT + 2; i++) {
        await vault.update((data) => {
          data.hosts = []
        })
      }
      return (await listBackups(vault.backupDir)).length === VAULT_BACKUP_COUNT
    })

    await check('tamper detection', async () => {
      const vault = await Vault.open({ directory: dir, wrapper })
      const envelope = JSON.parse(await readFile(vault.filePath, 'utf8')) as { data: string }
      const bytes = Buffer.from(envelope.data, 'base64')
      bytes[0] = (bytes[0] ?? 0) ^ 0xff
      envelope.data = bytes.toString('base64')
      await writeFile(vault.filePath, JSON.stringify(envelope))
      try {
        await Vault.open({ directory: dir, wrapper })
        return false
      } catch (error) {
        return error instanceof VaultError && error.code === 'VAULT_CORRUPT'
      }
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  return { ok: checks.every((item) => item.ok), checks }
}
