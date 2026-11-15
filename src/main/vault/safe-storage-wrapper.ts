import { safeStorage } from 'electron'
import type { KeyWrapper } from './key-wrapper'

/**
 * Wraps the vault key with Electron safeStorage. Only the async API is used:
 * the synchronous one is deprecated and goes away in Electron 46.
 * The key travels as base64 text because safeStorage encrypts strings.
 */
export function createSafeStorageWrapper(): KeyWrapper {
  return {
    type: 'safeStorage',
    isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
    wrap: async (key) => {
      const encrypted = await safeStorage.encryptStringAsync(key.toString('base64'))
      return encrypted.toString('base64')
    },
    unwrap: async (wrapped) => {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(
        Buffer.from(wrapped, 'base64'),
      )
      return { key: Buffer.from(result, 'base64'), rewrap: shouldReEncrypt }
    },
  }
}
