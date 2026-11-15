import { app, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { TITLE_BAR_HEIGHT } from '@shared/app'
import type { Theme } from '@shared/settings'
import type { SettingsStore } from '../settings/store'
import type { IpcRouter } from './router'

export interface HandlerDeps {
  settings: SettingsStore
  applyTheme: (theme: Theme) => void
  onTitleBarColored: (win: BrowserWindow) => void
}

export function registerIpcHandlers(
  router: IpcRouter<IpcMainInvokeEvent>,
  deps: HandlerDeps,
): void {
  router.handle('app:getVersion', () => ({ version: app.getVersion() }))

  router.handle('settings:get', () => deps.settings.getUi())

  router.handle('settings:update', async (patch) => {
    const next = await deps.settings.updateUi(patch)
    deps.applyTheme(next.theme)
    return next
  })

  router.handle('window:setTitleBarOverlay', (colors, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win !== null) {
      win.setTitleBarOverlay({ ...colors, height: TITLE_BAR_HEIGHT })
      deps.onTitleBarColored(win)
    }
    return undefined
  })
}
