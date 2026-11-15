import type { KeyWrapper } from '../../../src/main/vault/key-wrapper'

/** Stands in for safeStorage: reversible, but not plaintext. */
export function fakeWrapper(overrides: Partial<KeyWrapper> = {}): KeyWrapper & { wraps: number } {
  const wrapper = {
    type: 'safeStorage' as const,
    wraps: 0,
    isAvailable: () => Promise.resolve(true),
    wrap: (key: Buffer) => {
      wrapper.wraps++
      return Promise.resolve(Buffer.from(key.map((b) => b ^ 0x5a)).toString('base64'))
    },
    unwrap: (wrapped: string) =>
      Promise.resolve({
        key: Buffer.from(Buffer.from(wrapped, 'base64').map((b) => b ^ 0x5a)),
        rewrap: false,
      }),
    ...overrides,
  }
  return wrapper
}
