import path from 'node:path'
import os from 'node:os'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from 'electron'
import { APP_ORIGIN } from '@shared/app'
import { pickDefaultLanguage, type Theme } from '@shared/settings'
import { configureAppPaths } from './app-paths'
import { GroupService } from './hosts/group-service'
import { HostService } from './hosts/host-service'
import { KeyUpgrades } from './hosts/key-upgrade'
import { KeyFileImports } from './hosts/key-files'
import { registerIpcHandlers } from './ipc/handlers'
import { registerHostHandlers } from './ipc/host-handlers'
import { registerKeychainHandlers } from './ipc/keychain-handlers'
import { registerSessionHandlers } from './ipc/session-handlers'
import { createSinkRegistry } from './ipc/web-contents-sink'
import { createIpcRouter } from './ipc/router'
import { createOriginMatcher, createSenderCheck } from './ipc/sender'
import { Agents } from './keychain/agents'
import { IdentityService } from './keychain/identity-service'
import { KeyService } from './keychain/key-service'
import { countAgentKeys, openSshAgent, PageantAgent, pagentExePath } from './platform/agent'
import { applyWindowsAppIdentity } from './platform/windows'
import { handleAppProtocol, registerAppScheme } from './security/app-protocol'
import { applyDevelopmentCsp, denyAllPermissions, denyNavigationAndPopups } from './security/harden'
import { SettingsStore } from './settings/store'
import { KnownHosts } from './ssh/host-keys'
import { PromptBroker } from './ssh/prompts'
import { quickConnectTarget } from './ssh/quick-target'
import { SessionManager } from './ssh/session-manager'
import { runVaultSelfTest, VAULT_SELF_TEST_FLAG } from './vault/self-test'
import { createSafeStorageWrapper } from './vault/safe-storage-wrapper'
import { VaultService } from './vault/service'
import { Vault } from './vault/vault'
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
  // No application menu: its accelerators (Ctrl+W closes the window, Ctrl+R
  // reloads) would fight the terminal and tab shortcuts.
  Menu.setApplicationMenu(null)
  handleAppProtocol(path.join(__dirname, '../renderer'))
  if (devServerUrl !== undefined) applyDevelopmentCsp(devServerUrl)

  const settings = await SettingsStore.open({
    directory: app.getPath('userData'),
    defaultLanguage: pickDefaultLanguage(app.getPreferredSystemLanguages()),
    onWarning: (message) => {
      console.warn(`[settings] ${message}`)
    },
  })

  const vaults = new VaultService(() =>
    Vault.open({ directory: app.getPath('userData'), wrapper: createSafeStorageWrapper() }),
  )
  const keyFiles = new KeyFileImports()
  const hosts = new HostService(vaults, keyFiles)
  const groups = new GroupService(vaults)
  const keys = new KeyService(vaults, keyFiles)
  const identities = new IdentityService(vaults, keyFiles)
  const pagentPath = pagentExePath(app.getAppPath())
  const agents = new Agents(
    {
      openssh: () => openSshAgent(),
      pageant: () => new PageantAgent(pagentPath),
      count: (agent) => countAgentKeys(agent),
    },
    () => settings.getUi().agent,
  )
  const prompts = new PromptBroker()
  const knownHosts = new KnownHosts(vaults)
  const sessions = new SessionManager({
    resolveHost: (id) => hosts.connectTarget(id),
    resolveQuick: (input) => quickConnectTarget(input, os.homedir()),
    knownHosts,
    prompts,
    log: (message) => {
      console.log(`[ssh] ${message}`)
    },
    agents,
    onConnected: (hostId) => {
      hosts.markConnected(hostId).catch((error: unknown) => {
        console.warn(`[hosts] could not record the connection: ${describeError(error)}`)
      })
    },
  })
  const sinkOf = createSinkRegistry((sink) => {
    sessions.closeAllFor(sink)
  })
  app.on('before-quit', () => {
    sessions.closeAll()
  })

  const applyTheme = (theme: Theme): void => {
    nativeTheme.themeSource = theme
  }
  applyTheme(settings.getUi().theme)

  let flushed = false
  app.on('will-quit', (event) => {
    if (flushed) return
    event.preventDefault()
    void Promise.allSettled([settings.flush(), vaults.flush()]).finally(() => {
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

  registerHostHandlers(router, {
    hosts,
    groups,
    keyFiles,
    sessionCredential: (event, sessionId) =>
      sessions.usedCredential(sinkOf(event.sender), sessionId),
    chooseKeyFile: async (event) => {
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = {
        properties: ['openFile', 'showHiddenFiles', 'dontAddToRecent'],
        defaultPath: path.join(os.homedir(), '.ssh'),
      }
      const result = await (owner === null
        ? dialog.showOpenDialog(options)
        : dialog.showOpenDialog(owner, options))
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
  })

  registerKeychainHandlers(router, {
    keys,
    identities,
    agents,
    upgrades: new KeyUpgrades({
      vaults,
      hosts,
      keys,
      runCommand: (owner, target, command, options) =>
        sessions.runCommand(owner, target, command, options),
    }),
    ownerOf: (event) => sinkOf(event.sender),
  })

  registerSessionHandlers(router, {
    sessions,
    prompts,
    knownHosts,
    ownerOf: (event) => sinkOf(event.sender),
  })

  registerIpcHandlers(router, {
    settings,
    applyTheme,
    onTitleBarColored: (win) => {
      if (win === created.win) created.markTitleBarColored()
    },
  })
}
