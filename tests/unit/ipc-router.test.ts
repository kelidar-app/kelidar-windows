import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/main/ipc/app-error'
import { createIpcRouter, type InvokeEventLike } from '../../src/main/ipc/router'
import { createSenderCheck, type FrameLike } from '../../src/main/ipc/sender'
import { APP_ORIGIN } from '../../src/shared/app'

type Listener = (event: InvokeEventLike, ...args: unknown[]) => unknown

function setup() {
  const listeners = new Map<string, Listener>()
  const ipc = {
    handle(channel: string, listener: Listener) {
      listeners.set(channel, listener)
    },
  }
  const onInternalError = vi.fn()
  const router = createIpcRouter(ipc, {
    isTrustedSender: createSenderCheck([APP_ORIGIN]),
    onInternalError,
  })
  const call = (channel: string, frame: FrameLike | null, ...args: unknown[]) => {
    const listener = listeners.get(channel)
    if (listener === undefined) throw new Error(`no handler for ${channel}`)
    return listener({ senderFrame: frame }, ...args)
  }
  return { router, call, onInternalError }
}

const trusted: FrameLike = { url: `${APP_ORIGIN}/index.html`, parent: null }

describe('IPC router', () => {
  it('answers app:getVersion for a trusted sender', async () => {
    const { router, call } = setup()
    router.handle('app:getVersion', () => ({ version: '1.2.3' }))
    await expect(call('app:getVersion', trusted)).resolves.toEqual({
      ok: true,
      data: { version: '1.2.3' },
    })
  })

  it('refuses senders from other origins, iframes and missing frames', async () => {
    const { router, call } = setup()
    const handler = vi.fn(() => ({ version: '1.2.3' }))
    router.handle('app:getVersion', handler)
    const forbidden = { ok: false, error: { code: 'IPC_FORBIDDEN' } }
    await expect(
      call('app:getVersion', { url: 'https://evil.example/', parent: null }),
    ).resolves.toEqual(forbidden)
    await expect(
      call('app:getVersion', { url: 'file:///C:/index.html', parent: null }),
    ).resolves.toEqual(forbidden)
    await expect(call('app:getVersion', { ...trusted, parent: trusted })).resolves.toEqual(
      forbidden,
    )
    await expect(call('app:getVersion', null)).resolves.toEqual(forbidden)
    expect(handler).not.toHaveBeenCalled()
  })

  it('refuses payloads that do not match the schema', async () => {
    const { router, call } = setup()
    const handler = vi.fn(() => ({
      language: 'en' as const,
      theme: 'system' as const,
      terminalTheme: 'kelidar' as const,
    }))
    const versionHandler = vi.fn(() => ({ version: '1.2.3' }))
    router.handle('settings:update', handler)
    router.handle('app:getVersion', versionHandler)
    const invalid = { ok: false, error: { code: 'IPC_INVALID_PAYLOAD' } }
    await expect(call('settings:update', trusted, { language: 'de' })).resolves.toEqual(invalid)
    await expect(call('settings:update', trusted, { language: 'en', extra: 1 })).resolves.toEqual(
      invalid,
    )
    await expect(call('settings:update', trusted, {})).resolves.toEqual(invalid)
    await expect(call('settings:update', trusted)).resolves.toEqual(invalid)
    await expect(call('settings:update', trusted, { theme: 'dark' }, 'second')).resolves.toEqual(
      invalid,
    )
    await expect(call('app:getVersion', trusted, 'unexpected')).resolves.toEqual(invalid)
    expect(handler).not.toHaveBeenCalled()
    expect(versionHandler).not.toHaveBeenCalled()
  })

  it('passes the parsed payload to the handler', async () => {
    const { router, call } = setup()
    const handler = vi.fn(() => ({
      language: 'fa' as const,
      theme: 'dark' as const,
      terminalTheme: 'soft' as const,
    }))
    router.handle('settings:update', handler)
    await call('settings:update', trusted, { theme: 'dark' })
    expect(handler).toHaveBeenCalledWith({ theme: 'dark' }, expect.anything())
  })

  it('strips fields the response schema does not declare', async () => {
    const { router, call } = setup()
    router.handle('settings:get', () => {
      const withExtra = {
        language: 'en' as const,
        theme: 'light' as const,
        terminalTheme: 'classic' as const,
        window: { width: 1 },
      }
      return withExtra
    })
    await expect(call('settings:get', trusted)).resolves.toEqual({
      ok: true,
      data: { language: 'en', theme: 'light', terminalTheme: 'classic' },
    })
  })

  it('maps AppError to its code and anything else to INTERNAL', async () => {
    const { router, call, onInternalError } = setup()
    router.handle('settings:update', () => {
      throw new AppError('SETTINGS_WRITE_FAILED')
    })
    router.handle('app:getVersion', () => {
      throw new Error('boom')
    })
    await expect(call('settings:update', trusted, { theme: 'dark' })).resolves.toEqual({
      ok: false,
      error: { code: 'SETTINGS_WRITE_FAILED' },
    })
    await expect(call('app:getVersion', trusted)).resolves.toEqual({
      ok: false,
      error: { code: 'INTERNAL' },
    })
    expect(onInternalError).toHaveBeenCalledTimes(1)
  })
})
