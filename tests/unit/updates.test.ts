import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  releaseNotesText,
  UpdateService,
  type UpdateInfoLike,
  type UpdaterLike,
} from '../../src/main/updates/update-service'
import { MAX_RELEASE_NOTES, type UpdateStatus } from '../../src/shared/updates'

/** Stands in for electron-updater's autoUpdater. */
class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = false
  autoInstallOnAppQuit = false
  allowPrerelease = false
  check = vi.fn<() => Promise<unknown>>(() => Promise.resolve(null))
  quitAndInstall = vi.fn()
  checkForUpdates(): Promise<unknown> {
    return this.check()
  }
}

const NOW = new Date('2026-11-18T09:00:00.000Z')

function setup(currentVersion = '0.2.0') {
  const updater = new FakeUpdater()
  const seen: UpdateStatus[] = []
  const service = new UpdateService({
    updater,
    currentVersion,
    emit: (status) => seen.push(status),
    now: () => NOW,
  })
  return { updater, service, seen }
}

describe('UpdateService', () => {
  it('does nothing in a development build', async () => {
    const seen: UpdateStatus[] = []
    const service = new UpdateService({
      updater: null,
      currentVersion: '0.2.0',
      emit: (status) => seen.push(status),
    })
    await expect(service.check()).resolves.toEqual({ state: 'disabled', currentVersion: '0.2.0' })
    expect(service.install()).toBe(false)
    expect(seen).toEqual([])
  })

  it('downloads in the background and installs only when asked', async () => {
    const { updater, service, seen } = setup()
    expect(updater).toMatchObject({ autoDownload: true, autoInstallOnAppQuit: true })
    // Below 1.0 every GitHub release is a pre-release.
    expect(updater.allowPrerelease).toBe(true)
    expect(service.install()).toBe(false)

    updater.check.mockImplementation(() => {
      updater.emit('update-available', {
        version: '0.2.1',
        releaseNotes: '<ul><li>Faster tabs</li></ul>',
      } satisfies UpdateInfoLike)
      return Promise.resolve(null)
    })
    await expect(service.check()).resolves.toMatchObject({
      state: 'downloading',
      version: '0.2.1',
      percent: 0,
      notes: '• Faster tabs',
    })
    updater.emit('download-progress', { percent: 42.5 })
    expect(service.get()).toMatchObject({ state: 'downloading', percent: 42.5, version: '0.2.1' })
    // A check while downloading changes nothing.
    await service.check()
    expect(updater.check).toHaveBeenCalledTimes(1)

    updater.emit('update-downloaded', { version: '0.2.1', releaseNotes: '<p>Faster tabs</p>' })
    expect(service.get()).toEqual({
      state: 'ready',
      currentVersion: '0.2.0',
      version: '0.2.1',
      notes: 'Faster tabs',
      checkedAt: NOW.toISOString(),
    })
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(service.install()).toBe(true)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
    expect(seen.map((status) => status.state)).toEqual([
      'checking',
      'downloading',
      'downloading',
      'ready',
    ])
  })

  it('reports up to date, and failures as codes only', async () => {
    const { updater, service } = setup('1.4.0')
    expect(updater.allowPrerelease).toBe(false)
    updater.check.mockImplementation(() => {
      updater.emit('update-not-available')
      return Promise.resolve(null)
    })
    await expect(service.check()).resolves.toEqual({
      state: 'upToDate',
      currentVersion: '1.4.0',
      checkedAt: NOW.toISOString(),
    })

    updater.check.mockRejectedValue(
      new Error('net::ERR_INTERNET_DISCONNECTED https://github.com/x'),
    )
    const failed = await service.check()
    expect(failed).toMatchObject({ state: 'error', error: 'UPDATE_CHECK_FAILED' })
    expect(JSON.stringify(failed)).not.toContain('github')

    updater.emit('update-available', { version: '1.5.0' })
    updater.emit('error', new Error('disk full'))
    expect(service.get()).toMatchObject({ state: 'error', error: 'UPDATE_DOWNLOAD_FAILED' })
  })
})

describe('releaseNotesText', () => {
  it('keeps the text of GitHub release notes and drops the markup', () => {
    expect(
      releaseNotesText(
        '<h2>Features</h2><ul><li>Smart <b>Paste</b> &amp; import</li><li>Lock&nbsp;screen</li></ul>' +
          '<script>alert(1)</script><p>See <a href="https://example.test">notes</a> &#x2192; done</p>',
      ),
    ).toBe('Features\n\n• Smart Paste & import\n• Lock screen\n\nSee notes → done')
  })

  it('joins notes of several versions, and handles none or very long notes', () => {
    expect(
      releaseNotesText([
        { version: '0.2.1', note: '<p>One</p>' },
        { version: '0.2.0', note: null },
      ]),
    ).toBe('0.2.1\nOne\n\n0.2.0')
    expect(releaseNotesText(null)).toBeUndefined()
    expect(releaseNotesText('<p> </p>')).toBeUndefined()
    expect(releaseNotesText('x'.repeat(MAX_RELEASE_NOTES + 50))?.length).toBe(MAX_RELEASE_NOTES)
  })
})
