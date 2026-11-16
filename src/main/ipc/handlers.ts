import { app, BrowserWindow, clipboard, shell, type IpcMainInvokeEvent } from 'electron'
import { TITLE_BAR_HEIGHT } from '@shared/app'
import type { Theme } from '@shared/settings'
import { isSafeExternalUrl } from '../security/external-url'
import type { SettingsStore } from '../settings/store'
import { AppError } from './app-error'
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

  // Ctrl+click on a link in a terminal: http and https only, no credentials in it.
  router.handle('app:openExternal', async ({ url }) => {
    if (!isSafeExternalUrl(url)) throw new AppError('LINK_REFUSED')
    await shell.openExternal(url)
    return undefined
  })

  router.handle('clipboard:readText', async () => ({ text: await clipboard.readText() }))

  router.handle('clipboard:writeText', async ({ text }) => {
    await clipboard.writeText(text)
    return undefined
  })

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
