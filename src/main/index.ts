import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { app, ipcMain, nativeTheme } from 'electron'
import { APP_ORIGIN } from '@shared/app'
import { pickDefaultLanguage, type Theme } from '@shared/settings'
import { configureAppPaths } from './app-paths'
import { registerIpcHandlers } from './ipc/handlers'
import { createIpcRouter } from './ipc/router'
import { createOriginMatcher, createSenderCheck } from './ipc/sender'
import { applyWindowsAppIdentity } from './platform/windows'
import { handleAppProtocol, registerAppScheme } from './security/app-protocol'
import { applyDevelopmentCsp, denyAllPermissions, denyNavigationAndPopups } from './security/harden'
import { SettingsStore } from './settings/store'
import { runVaultSelfTest, VAULT_SELF_TEST_FLAG } from './vault/self-test'
import { createSafeStorageWrapper } from './vault/safe-storage-wrapper'
import { createMainWindow } from './window'

configureAppPaths()

if (process.argv.includes(VAULT_SELF_TEST_FLAG)) {
  // `<app> --vault-self-test`: checks the vault against the real safeStorage,
  // prints {"ok":true|false,...} (check names only) and exits. No window.
  void app.whenReady().then(async () => {
    const result = await runVaultSelfTest(createSafeStorageWrapper())
    process.stdout.write(`${JSON.stringify(result)}
`)
    app.exit(result.ok ? 0 : 1)
  })
} else if (!app.requestSingleInstanceLock()) {
  // Another instance owns this userData folder; it brings its window forward.
  app.quit()
} else {
  void start()
}

/** Never log error messages or payloads: later phases handle secrets. Name and code only. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? ` (${error.code})` : ''
    return `${error.name}${code}`
  }
  return typeof error
}

async function start(): Promise<void> {
  const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
  const rendererUrl = devServerUrl ?? `${APP_ORIGIN}/index.html`
  const allowedOrigins = [APP_ORIGIN]
  if (devServerUrl !== undefined) allowedOrigins.push(new URL(devServerUrl).origin)

  registerAppScheme()
  app.enableSandbox()
  applyWindowsAppIdentity()
  denyNavigationAndPopups({ isAppUrl: createOriginMatcher(allowedOrigins), homeUrl: rendererUrl })

  let mainWindow: BrowserWindow | null = null

  app.on('second-instance', () => {
    if (mainWindow === null) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  await app.whenReady()

  denyAllPermissions()
  handleAppProtocol(path.join(__dirname, '../renderer'))
  if (devServerUrl !== undefined) applyDevelopmentCsp(devServerUrl)

  const settings = await SettingsStore.open({
    directory: app.getPath('userData'),
    defaultLanguage: pickDefaultLanguage(app.getPreferredSystemLanguages()),
    onWarning: (message) => {
      console.warn(`[settings] ${message}`)
    },
  })

  const applyTheme = (theme: Theme): void => {
    nativeTheme.themeSource = theme
  }
  applyTheme(settings.getUi().theme)

  let flushed = false
  app.on('will-quit', (event) => {
    if (flushed) return
    event.preventDefault()
    void settings.flush().finally(() => {
      flushed = true
      app.quit()
    })
  })

  const router = createIpcRouter(ipcMain, {
    isTrustedSender: createSenderCheck(allowedOrigins),
    onInternalError: (channel, error) => {
      console.error(`[ipc] ${channel} failed: ${describeError(error)}`)
    },
  })

  const created = createMainWindow({
    settings,
    rendererUrl,
    preloadPath: path.join(__dirname, '../preload/index.js'),
  })
  mainWindow = created.win
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  registerIpcHandlers(router, {
    settings,
    applyTheme,
    onTitleBarColored: (win) => {
      if (win === created.win) created.markTitleBarColored()
    },
  })
}
