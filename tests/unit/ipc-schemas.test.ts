import { describe, expect, it } from 'vitest'
import { ERROR_CODES, isErrorCode } from '../../src/shared/errors'
import { ipcContract } from '../../src/shared/ipc'
import { IPC_CHANNELS, isIpcChannel } from '../../src/shared/ipc-channels'

describe('IPC contract', () => {
  it('describes exactly the listed channels', () => {
    expect(Object.keys(ipcContract).sort()).toEqual([...IPC_CHANNELS].sort())
  })

  it('recognises only known channels', () => {
    expect(isIpcChannel('app:getVersion')).toBe(true)
    expect(isIpcChannel('app:quit')).toBe(false)
    expect(isIpcChannel(42)).toBe(false)
  })

  it('takes no payload for app:getVersion', () => {
    const schema = ipcContract['app:getVersion'].request
    expect(schema.safeParse(undefined).success).toBe(true)
    expect(schema.safeParse({}).success).toBe(false)
  })

  it('accepts only known settings with known values', () => {
    const schema = ipcContract['settings:update'].request
    expect(schema.safeParse({ language: 'fa' }).success).toBe(true)
    expect(schema.safeParse({ theme: 'dark', language: 'en' }).success).toBe(true)
    expect(schema.safeParse({ terminalTheme: 'soft' }).success).toBe(true)
    expect(schema.safeParse({ terminalTheme: 'neon' }).success).toBe(false)
    expect(schema.safeParse({ theme: 'blue' }).success).toBe(false)
    expect(schema.safeParse({ window: { width: 800 } }).success).toBe(false)
    expect(schema.safeParse({}).success).toBe(false)
    expect(schema.safeParse(null).success).toBe(false)
  })

  it('accepts only #rrggbb colors for the title bar overlay', () => {
    const schema = ipcContract['window:setTitleBarOverlay'].request
    expect(schema.safeParse({ color: '#112233', symbolColor: '#AABBCC' }).success).toBe(true)
    expect(schema.safeParse({ color: 'red', symbolColor: '#000000' }).success).toBe(false)
    expect(schema.safeParse({ color: '#112233' }).success).toBe(false)
    expect(
      schema.safeParse({ color: '#112233', symbolColor: '#000000', height: 999 }).success,
    ).toBe(false)
  })

  it('has unique error codes', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
    expect(isErrorCode('INTERNAL')).toBe(true)
    expect(isErrorCode('NOPE')).toBe(false)
  })
})
