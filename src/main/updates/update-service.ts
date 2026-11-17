import { MAX_RELEASE_NOTES, type UpdateStatus } from '@shared/updates'

/** What the service needs from electron-updater's autoUpdater (a fake in tests). */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  on(
    event: 'update-available' | 'update-downloaded',
    listener: (info: UpdateInfoLike) => void,
  ): unknown
  on(event: 'update-not-available', listener: () => void): unknown
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdateInfoLike {
  version: string
  releaseNotes?: string | readonly { version: string; note: string | null }[] | null
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/**
 * Release notes arrive as HTML from GitHub. The window never renders remote
 * HTML: this keeps the text only, with list items and paragraphs on their
 * own lines.
 */
export function releaseNotesText(notes: UpdateInfoLike['releaseNotes']): string | undefined {
  if (notes === undefined || notes === null) return undefined
  const html =
    typeof notes === 'string'
      ? notes
      : notes.map((item) => `<h3>${item.version}</h3>${item.note ?? ''}`).join('\n')
  const text = html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\s*\/\s*(ul|ol)\s*>/gi, '\n\n')
    .replace(/<\s*\/\s*(p|div|h[1-6]|pre|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
      if (entity.startsWith('#x') || entity.startsWith('#X')) {
        return String.fromCodePoint(parseInt(entity.slice(2), 16))
      }
      if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10))
      return ENTITIES[entity.toLowerCase()] ?? whole
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (text === '') return undefined
  return text.length > MAX_RELEASE_NOTES ? `${text.slice(0, MAX_RELEASE_NOTES - 1)}…` : text
}

export interface UpdateServiceOptions {
  /** null: a development build or an app not installed by the installer. */
  updater: UpdaterLike | null
  currentVersion: string
  /** Tells every window about a change. */
  emit: (status: UpdateStatus) => void
  now?: () => Date
}

/**
 * Updates from GitHub Releases: check, download in the background, then
 * install when the user chooses "Restart to update" (or on the next quit).
 * Nothing is sent but the request for the release list; no telemetry.
 */
export class UpdateService {
  private status: UpdateStatus

  constructor(private readonly options: UpdateServiceOptions) {
    const { updater, currentVersion } = options
    this.status = { state: updater === null ? 'disabled' : 'idle', currentVersion }
    if (updater === null) return
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    // Releases below 1.0 are marked as pre-releases on GitHub.
    updater.allowPrerelease = currentVersion.startsWith('0.') || currentVersion.includes('-')
    updater.on('update-available', (info) => {
      this.set({
        state: 'downloading',
        version: info.version,
        percent: 0,
        ...this.notesOf(info),
      })
    })
    updater.on('update-not-available', () => {
      this.set({ state: 'upToDate', checkedAt: this.now() })
    })
    updater.on('download-progress', (progress) => {
      if (this.status.state !== 'downloading') return
      this.set({
        ...this.keep(),
        state: 'downloading',
        percent: Math.min(100, Math.max(0, progress.percent)),
      })
    })
    updater.on('update-downloaded', (info) => {
      this.set({
        state: 'ready',
        version: info.version,
        checkedAt: this.now(),
        ...this.notesOf(info),
      })
    })
    updater.on('error', () => {
      // The message can hold URLs and paths: only the code goes on.
      this.set({
        state: 'error',
        error:
          this.status.state === 'downloading' ? 'UPDATE_DOWNLOAD_FAILED' : 'UPDATE_CHECK_FAILED',
        checkedAt: this.now(),
      })
    })
  }

  get(): UpdateStatus {
    return this.status
  }

  /** Checks now, unless a check or download is running or an update is ready. */
  async check(): Promise<UpdateStatus> {
    const updater = this.options.updater
    if (updater === null) return this.status
    const busy = ['checking', 'downloading', 'ready'] as const
    if ((busy as readonly string[]).includes(this.status.state)) return this.status
    this.set({ state: 'checking' })
    try {
      await updater.checkForUpdates()
    } catch {
      if (this.status.state === 'checking' || this.status.state === 'downloading') {
        this.set({
          state: 'error',
          error:
            this.status.state === 'downloading' ? 'UPDATE_DOWNLOAD_FAILED' : 'UPDATE_CHECK_FAILED',
          checkedAt: this.now(),
        })
      }
    }
    return this.status
  }

  /** Quits, installs the downloaded update and starts the new version. */
  install(): boolean {
    if (this.options.updater === null || this.status.state !== 'ready') return false
    // Silent: the one-click installer shows no pages. Then start the app again.
    this.options.updater.quitAndInstall(true, true)
    return true
  }

  private keep(): Pick<UpdateStatus, 'version' | 'notes'> {
    return {
      ...(this.status.version === undefined ? {} : { version: this.status.version }),
      ...(this.status.notes === undefined ? {} : { notes: this.status.notes }),
    }
  }

  private notesOf(info: UpdateInfoLike): Pick<UpdateStatus, 'notes'> {
    const notes = releaseNotesText(info.releaseNotes)
    return notes === undefined ? {} : { notes }
  }

  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString()
  }

  private set(next: Omit<UpdateStatus, 'currentVersion'>): void {
    this.status = { ...next, currentVersion: this.options.currentVersion }
    this.options.emit(this.status)
  }
}
