import { terminalActions } from '@renderer/features/terminal/terminal-registry'
import { useGroupFormStore, useHostFormStore } from '@renderer/stores/hosts'
import { useSettingsStore } from '@renderer/stores/settings'
import { HOME_TAB, useTabsStore } from '@renderer/stores/tabs'
import { useUiStore } from '@renderer/stores/ui'
import { COMMAND_KEYS, findByKey, type CommandId, type KeyCombo } from './key-combos'

export { comboAria, comboLabel, type CommandId } from './key-combos'

export type CommandSection = 'general' | 'hosts' | 'tabs'

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

function command(
  id: CommandId,
  section: CommandSection,
  run: () => void,
  available: () => boolean = always,
): AppCommand {
  return { id, section, combos: COMMAND_KEYS[id], available, run }
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
  command('settings', 'general', () => {
    useUiStore.getState().showSection('settings')
  }),
  command('newTab', 'tabs', () => {
    useUiStore.getState().focusQuickConnect()
  }),
  command('newHost', 'hosts', () => {
    useUiStore.getState().showSection('hosts')
    useHostFormStore.getState().openNew()
  }),
  command('newGroup', 'hosts', () => {
    useUiStore.getState().showSection('hosts')
    useGroupFormStore.getState().openNew()
  }),
  command('searchHosts', 'hosts', () => {
    useUiStore.getState().focusHostSearch()
  }),
  command('toggleHostsView', 'hosts', () => {
    const settings = useSettingsStore.getState()
    useUiStore.getState().showSection('hosts')
    void settings.update({ hostsView: settings.settings.hostsView === 'cards' ? 'list' : 'cards' })
  }),
  command(
    'closeTab',
    'tabs',
    () => {
      const tabs = useTabsStore.getState()
      tabs.close(tabs.activeId)
    },
    onTerminalTab,
  ),
  command('nextTab', 'tabs', () => {
    useTabsStore.getState().activateNext(1)
  }),
  command('previousTab', 'tabs', () => {
    useTabsStore.getState().activateNext(-1)
  }),
  command(
    'renameTab',
    'tabs',
    () => {
      useTabsStore.getState().startRename()
    },
    onTerminalTab,
  ),
  command(
    'paste',
    'tabs',
    () => {
      terminalActions(useTabsStore.getState().activeId)?.paste()
    },
    onTerminalTab,
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
