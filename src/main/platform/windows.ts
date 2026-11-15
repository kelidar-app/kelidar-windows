import { app } from 'electron'
import { APP } from '@shared/app'

/**
 * Windows-only setup. The AppUserModelID ties taskbar grouping, pinned
 * shortcuts and (later) notifications to the installed app.
 */
export function applyWindowsAppIdentity(): void {
  if (process.platform !== 'win32') return
  app.setAppUserModelId(APP.id)
}
