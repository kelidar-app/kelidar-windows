export interface AutoLockDeps {
  /** Seconds since the last keyboard or mouse input anywhere (powerMonitor). */
  idleSeconds: () => number
  /** Calls `listener` when Windows locks or the computer goes to sleep. Returns an unsubscribe. */
  onSystemLock: (listener: () => void) => () => void
  settings: () => { autoLockMinutes: number; lockOnWindowsLock: boolean }
  lock: () => void
  /** How often idle time is checked. */
  checkEveryMs?: number
}

/**
 * Locks the vault after the chosen minutes without input, and when Windows
 * locks or sleeps. The vault itself ignores a lock without a master password.
 */
export class AutoLock {
  private timer: NodeJS.Timeout | undefined
  private unsubscribe: (() => void) | undefined

  constructor(private readonly deps: AutoLockDeps) {}

  start(): void {
    this.stop()
    this.unsubscribe = this.deps.onSystemLock(() => {
      if (this.deps.settings().lockOnWindowsLock) this.deps.lock()
    })
    this.timer = setInterval(() => {
      this.check()
    }, this.deps.checkEveryMs ?? 15_000)
    this.timer.unref()
  }

  check(): void {
    const minutes = this.deps.settings().autoLockMinutes
    if (minutes > 0 && this.deps.idleSeconds() >= minutes * 60) this.deps.lock()
  }

  stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }
}
