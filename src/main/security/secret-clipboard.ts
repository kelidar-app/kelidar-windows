import { createHash } from 'node:crypto'

/** Electron's clipboard (its read and write return promises in this version). */
export interface ClipboardAccess {
  writeText: (text: string) => Promise<void> | void
  readText: () => Promise<string> | string
  clear: () => Promise<void> | void
}

const fingerprint = (text: string): string => createHash('sha256').update(text).digest('hex')

/**
 * Copies a saved password to the clipboard for the user (AGENTS.md, rule 4:
 * main writes it, the renderer never sees it) and takes it away again after
 * the chosen number of seconds, when the app locks and when it quits. Only a
 * hash is kept to recognise it, and the clipboard is cleared only while it
 * still holds that password, so text the user copied since stays.
 */
export class SecretClipboard {
  private copied: string | null = null
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly clipboard: ClipboardAccess,
    /** Seconds to keep it; 0 keeps it until lock or quit. */
    private readonly clearAfterSeconds: () => number,
  ) {}

  /** Returns the seconds until it is cleared (0: not on a timer). */
  async copy(secret: string): Promise<number> {
    clearTimeout(this.timer)
    this.timer = undefined
    await this.clipboard.writeText(secret)
    this.copied = fingerprint(secret)
    const seconds = this.clearAfterSeconds()
    if (seconds > 0) {
      this.timer = setTimeout(() => {
        void this.clear()
      }, seconds * 1000)
      this.timer.unref()
    }
    return seconds
  }

  /** Clears the clipboard if it still holds the copied password. */
  async clear(): Promise<void> {
    clearTimeout(this.timer)
    this.timer = undefined
    const copied = this.copied
    if (copied === null) return
    this.copied = null
    try {
      if (fingerprint(await this.clipboard.readText()) === copied) await this.clipboard.clear()
    } catch {
      // The clipboard is busy (another app holds it); nothing else to do.
    }
  }
}
