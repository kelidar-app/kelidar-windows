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
  files: [
    'out/**/*',
    'package.json',
    '!**/*.map',
    // ssh2 runs on Node's own crypto. Its optional native addons (built only
    // when a compiler happens to be installed) are never shipped, so every
    // build behaves the same and no build machine needs native tools.
    '!**/node_modules/cpu-features/**',
    '!**/node_modules/nan/**',
    '!**/node_modules/buildcheck/**',
    '!**/node_modules/ssh2/lib/protocol/crypto/build/**',
    '!**/node_modules/ssh2/lib/protocol/crypto/src/**',
    '!**/node_modules/ssh2/lib/protocol/crypto/binding.gyp',
    '!**/node_modules/ssh2/install.js',
    '!**/node_modules/ssh2/util/*.c',
    '!**/node_modules/ssh2/util/*.bat',
  ],
  // ssh2's prebuilt Pageant helper (for agent sign-in). Windows cannot run a
  // program from inside app.asar, so it is unpacked next to it.
  asarUnpack: ['**/node_modules/ssh2/util/pagent.exe'],
  // Nothing to compile for Electron: see the native addons note above.
  npmRebuild: false,
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
