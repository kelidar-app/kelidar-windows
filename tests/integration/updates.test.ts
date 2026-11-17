import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdaterLike } from '../../src/main/updates/update-service'
import type { UpdateStatus } from '../../src/shared/updates'
import { createHarness, type Harness } from './helpers/harness'

/** Step 2.7 (Shipping): updates through the real IPC handlers. */

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function setup(options: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
  const harness = await createHarness(options)
  cleanups.push(harness.close)
  return harness
}

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = false
  autoInstallOnAppQuit = false
  allowPrerelease = false
  quitAndInstall = vi.fn()
  checkForUpdates(): Promise<unknown> {
    this.emit('update-available', { version: '0.2.1', releaseNotes: '<p>New</p>' })
    setTimeout(() => {
      this.emit('download-progress', { percent: 50 })
      this.emit('update-downloaded', { version: '0.2.1', releaseNotes: '<p>New</p>' })
    }, 10)
    return Promise.resolve(null)
  }
}

const updateEvents = (h: Harness): UpdateStatus[] =>
  h.sink.events.flatMap((e) => (e.event === 'update:status' ? [e.payload] : []))

describe('updates over IPC', () => {
  it('reports a development build as not updating itself', async () => {
    const h = await setup()
    await expect(h.call('update:status')).resolves.toEqual({
      state: 'disabled',
      currentVersion: '0.2.0',
    })
    await expect(h.invoke('update:install')).resolves.toEqual({
      ok: false,
      error: { code: 'UPDATE_NOT_READY' },
    })
  })

  it('checks, tells the window as it downloads, and restarts on request', async () => {
    const updater = new FakeUpdater()
    const h = await setup({ updater })
    await expect(h.call('update:check')).resolves.toMatchObject({
      state: 'downloading',
      version: '0.2.1',
    })
    await expect(h.invoke('update:install')).resolves.toEqual({
      ok: false,
      error: { code: 'UPDATE_NOT_READY' },
    })
    await vi.waitFor(() => {
      expect(updateEvents(h).at(-1)?.state).toBe('ready')
    })
    expect(updateEvents(h).map((status) => status.state)).toEqual([
      'checking',
      'downloading',
      'downloading',
      'ready',
    ])
    expect(updateEvents(h).at(-1)?.notes).toBe('New')
    await h.call('update:install')
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })
})
