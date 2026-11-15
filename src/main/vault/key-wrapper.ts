/**
 * Protects the random vault key at rest. Phase 1 has one wrapper, Electron
 * safeStorage (Windows DPAPI). Phase 2 adds a master-password wrapper (scrypt)
 * behind the same interface.
 */
export interface KeyWrapper {
  readonly type: 'safeStorage'
  isAvailable(): Promise<boolean>
  /** Returns base64 text that only this wrapper can turn back into the key. */
  wrap(key: Buffer): Promise<string>
  /** `rewrap` is true when the wrapper wants the key wrapped again on the next save. */
  unwrap(wrapped: string): Promise<{ key: Buffer; rewrap: boolean }>
}
