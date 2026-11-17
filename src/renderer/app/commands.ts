import { FOCUS, paneIds } from '@renderer/features/terminal/layout'
import { terminalActions } from '@renderer/features/terminal/terminal-registry'
import { api } from '@renderer/lib/api'
import { useGroupFormStore, useHostFormStore, useHostsStore } from '@renderer/stores/hosts'
import { useImportStore } from '@renderer/stores/import'
import { useKeychainDialogStore } from '@renderer/stores/keychain'
import {
  copySavedPassword,
  useSecurityDialogStore,
  useVaultStore,
  type SecurityDialog,
} from '@renderer/stores/security'
import { useSettingsStore } from '@renderer/stores/settings'
import { activePaneId, HOME_TAB, useTabsStore, type Pane } from '@renderer/stores/tabs'
import { useTerminalUiStore } from '@renderer/stores/terminal-ui'
import { useUiStore } from '@renderer/stores/ui'
import { COMMAND_KEYS, findByKey, type CommandId, type KeyCombo } from './key-combos'

export { comboAria, comboLabel, type CommandId } from './key-combos'

export type CommandSection = 'general' | 'hosts' | 'keychain' | 'security' | 'tabs' | 'terminal'

/**
 * Every app action in one list. The keyboard handler, the command palette
 * and the shortcut cheat sheet all read it, so an action added here gets
 * all three. The shortcuts themselves are in key-combos.ts.
 */
export interface AppCommand {
  id: CommandId
  section: CommandSection
  combos: readonly KeyCombo[]
  /** False when the action makes no sense at the moment (Close tab on Home). */
  available: () => boolean
  run: () => void
}

const onTerminalTab = (): boolean => useTabsStore.getState().activeId !== HOME_TAB
const always = (): boolean => true

function activePane(): Pane | undefined {
  const id = activePaneId()
  return id === undefined ? undefined : useTabsStore.getState().panes[id]
}

/** Pane focus and resize keys (Alt+Arrow) only act while the tab is split. */
function isSplit(): boolean {
  const { tabs, activeId } = useTabsStore.getState()
  const tab = tabs.find((item) => item.id === activeId)
  return tab !== undefined && paneIds(tab.layout).length > 1
}

function hasLiveSession(): boolean {
  const pane = activePane()
  return pane !== undefined && pane.state !== 'closed' && pane.state !== 'error'
}

function command(
  id: CommandId,
  section: CommandSection,
  run: () => void,
  available: () => boolean = always,
): AppCommand {
  return { id, section, combos: COMMAND_KEYS[id], available, run }
}

const tabs = () => useTabsStore.getState()

const hasMasterPassword = (): boolean => {
  const { status } = useVaultStore.getState()
  return status.state === 'unlocked' && status.masterPassword
}

/**
 * The host "Copy password" acts on: the focused host in the list, else the
 * host of the active terminal. Only hosts that sign in with a saved password.
 */
function passwordHostId(): string | undefined {
  const focused = document.activeElement?.closest<HTMLElement>('[data-host-item]')
  const pane = activePane()
  const id =
    focused?.dataset['hostId'] ?? (pane?.source.kind === 'host' ? pane.source.hostId : undefined)
  const host = useHostsStore.getState().hosts.find((item) => item.id === id)
  return host?.signIn.method === 'password' ? host.id : undefined
}

function securityDialog(dialog: SecurityDialog): () => void {
  return () => {
    useUiStore.getState().showSection('settings')
    useSecurityDialogStore.getState().show(dialog)
  }
}

export const COMMANDS: readonly AppCommand[] = [
  command('palette', 'general', () => {
    useUiStore.getState().setPaletteOpen(true)
  }),
  command('shortcuts', 'general', () => {
    useUiStore.getState().setShortcutsOpen(true)
  }),
  command('hosts', 'general', () => {
    useUiStore.getState().showSection('hosts')
  }),
  command('keychain', 'general', () => {
    useUiStore.getState().showSection('keychain')
  }),
  command('settings', 'general', () => {
    useUiStore.getState().showSection('settings')
  }),
  command('newHost', 'hosts', () => {
    useUiStore.getState().showSection('hosts')
    useHostFormStore.getState().openNew()
  }),
  command('newGroup', 'hosts', () => {
    useUiStore.getState().showSection('hosts')
    useGroupFormStore.getState().openNew()
  }),
  command('importHosts', 'hosts', () => {
    useUiStore.getState().showSection('hosts')
    useImportStore.getState().open({ kind: 'preview' })
  }),
  command('smartPaste', 'hosts', () => {
    useUiStore.getState().showSection('hosts')
    useImportStore.getState().open({ kind: 'smartPaste' })
  }),
  command('searchHosts', 'hosts', () => {
    useUiStore.getState().focusHostSearch()
  }),
  command('toggleHostsView', 'hosts', () => {
    const settings = useSettingsStore.getState()
    useUiStore.getState().showSection('hosts')
    void settings.update({ hostsView: settings.settings.hostsView === 'cards' ? 'list' : 'cards' })
  }),
  command('newIdentity', 'keychain', () => {
    useUiStore.getState().showSection('keychain')
    useKeychainDialogStore.getState().open({ kind: 'identity' })
  }),
  command('generateKey', 'keychain', () => {
    useUiStore.getState().showSection('keychain')
    useKeychainDialogStore.getState().open({ kind: 'generateKey' })
  }),
  command('importKey', 'keychain', () => {
    useUiStore.getState().showSection('keychain')
    useKeychainDialogStore.getState().open({ kind: 'importKey' })
  }),
  command(
    'lockNow',
    'security',
    () => {
      void useVaultStore.getState().lock()
    },
    hasMasterPassword,
  ),
  command(
    'copyPassword',
    'security',
    () => {
      const id = passwordHostId()
      if (id !== undefined) void copySavedPassword('host', id)
    },
    () => passwordHostId() !== undefined,
  ),
  command('masterPassword', 'security', securityDialog('masterPassword')),
  command('exportData', 'security', securityDialog('export')),
  command('importData', 'security', securityDialog('import')),
  command('restoreBackup', 'security', securityDialog('restore')),
  command('newTab', 'tabs', () => {
    useUiStore.getState().focusQuickConnect()
  }),
  command(
    'duplicateTab',
    'tabs',
    () => {
      void tabs().duplicate(tabs().activeId)
    },
    hasLiveSession,
  ),
  command(
    'closeTab',
    'tabs',
    () => {
      tabs().close(tabs().activeId)
    },
    onTerminalTab,
  ),
  command('nextTab', 'tabs', () => {
    tabs().activateNext(1)
  }),
  command('previousTab', 'tabs', () => {
    tabs().activateNext(-1)
  }),
  command(
    'renameTab',
    'tabs',
    () => {
      tabs().startRename()
    },
    onTerminalTab,
  ),
  command(
    'splitRight',
    'terminal',
    () => {
      void tabs().split('beside')
    },
    onTerminalTab,
  ),
  command(
    'splitDown',
    'terminal',
    () => {
      void tabs().split('below')
    },
    onTerminalTab,
  ),
  command(
    'closePane',
    'terminal',
    () => {
      const id = activePaneId()
      if (id !== undefined) tabs().closePane(id)
    },
    onTerminalTab,
  ),
  command(
    'focusLeft',
    'terminal',
    () => {
      tabs().moveFocus(FOCUS.left)
    },
    isSplit,
  ),
  command(
    'focusRight',
    'terminal',
    () => {
      tabs().moveFocus(FOCUS.right)
    },
    isSplit,
  ),
  command(
    'focusUp',
    'terminal',
    () => {
      tabs().moveFocus(FOCUS.up)
    },
    isSplit,
  ),
  command(
    'focusDown',
    'terminal',
    () => {
      tabs().moveFocus(FOCUS.down)
    },
    isSplit,
  ),
  command(
    'resizeLeft',
    'terminal',
    () => {
      tabs().resizeFocused(FOCUS.left)
    },
    isSplit,
  ),
  command(
    'resizeRight',
    'terminal',
    () => {
      tabs().resizeFocused(FOCUS.right)
    },
    isSplit,
  ),
  command(
    'resizeUp',
    'terminal',
    () => {
      tabs().resizeFocused(FOCUS.up)
    },
    isSplit,
  ),
  command(
    'resizeDown',
    'terminal',
    () => {
      tabs().resizeFocused(FOCUS.down)
    },
    isSplit,
  ),
  command(
    'paste',
    'terminal',
    () => {
      const id = activePaneId()
      if (id !== undefined) terminalActions(id)?.paste()
    },
    onTerminalTab,
  ),
  command(
    'searchTerminal',
    'terminal',
    () => {
      const id = activePaneId()
      if (id !== undefined) terminalActions(id)?.openSearch()
    },
    onTerminalTab,
  ),
  command('zoomIn', 'terminal', () => {
    useTerminalUiStore.getState().zoomBy(1)
  }),
  command('zoomOut', 'terminal', () => {
    useTerminalUiStore.getState().zoomBy(-1)
  }),
  command('zoomReset', 'terminal', () => {
    useTerminalUiStore.getState().resetZoom()
  }),
  command(
    'fillSudo',
    'terminal',
    () => {
      const pane = activePane()
      if (pane !== undefined) void api.invoke('session:fillSudo', { sessionId: pane.sessionId })
    },
    () => activePane()?.sudo?.canFill === true,
  ),
]

export function commandById(id: CommandId): AppCommand {
  const found = COMMANDS.find((item) => item.id === id)
  if (found === undefined) throw new Error(`Unknown command ${id}`)
  return found
}

/** The command a key press runs, or null for keys the app leaves alone. */
export function commandForKey(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey' | 'code'>,
  inTerminal: boolean,
  commands: readonly AppCommand[] = COMMANDS,
): AppCommand | null {
  return findByKey(event, inTerminal, commands)
}
