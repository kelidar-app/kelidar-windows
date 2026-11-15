import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export const VAULT_KEY_BYTES = 32
const NONCE_BYTES = 12
const TAG_BYTES = 16
const ALGORITHM = 'aes-256-gcm'

export interface SealedBox {
  nonce: Buffer
  tag: Buffer
  ciphertext: Buffer
}

export function generateVaultKey(): Buffer {
  return randomBytes(VAULT_KEY_BYTES)
}

/** AES-256-GCM with a fresh random nonce. `aad` is authenticated but not encrypted. */
export function seal(key: Buffer, plaintext: Buffer, aad: Buffer): SealedBox {
  if (key.length !== VAULT_KEY_BYTES) throw new Error('Bad vault key length')
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES })
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return { nonce, tag: cipher.getAuthTag(), ciphertext }
}

/** Throws when the key is wrong or any byte of the box or the AAD was changed. */
export function open(key: Buffer, box: SealedBox, aad: Buffer): Buffer {
  if (key.length !== VAULT_KEY_BYTES) throw new Error('Bad vault key length')
  if (box.nonce.length !== NONCE_BYTES || box.tag.length !== TAG_BYTES) {
    throw new Error('Bad nonce or tag length')
  }
  const decipher = createDecipheriv(ALGORITHM, key, box.nonce, { authTagLength: TAG_BYTES })
  decipher.setAAD(aad)
  decipher.setAuthTag(box.tag)
  return Buffer.concat([decipher.update(box.ciphertext), decipher.final()])
}
