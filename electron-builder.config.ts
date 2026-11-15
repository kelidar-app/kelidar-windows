import type { Configuration } from 'electron-builder'
import { APP } from './src/shared/app'

/**
 * Windows installer: NSIS, x64, installed for the current user only
 * (%LOCALAPPDATA%\Programs), so no admin rights are needed.
 */
const config: Configuration = {
  appId: APP.id,
  productName: APP.name,
  copyright: `Copyright © ${String(new Date().getFullYear())} ${APP.name} contributors`,
  directories: {
    output: 'dist',
    buildResources: 'resources',
  },
  files: ['out/**/*', 'package.json', '!**/*.map'],
  asar: true,
  // Chromium UI locales to ship; the app's own languages are bundled in the renderer.
  electronLanguages: ['en-US', 'fa'],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'resources/icon.png',
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: APP.name,
    artifactName: '${productName}-Setup-${version}-${arch}.${ext}',
  },
  // Turn off Electron features the app never needs. Applied right after packing.
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  },
  publish: [
    {
      provider: 'github',
      owner: APP.repository.owner,
      repo: APP.repository.name,
    },
  ],
}

export default config
