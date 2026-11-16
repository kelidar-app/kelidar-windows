/**
 * Keyboard shortcuts as data: Ctrl plus a physical key. No store imports, so
 * the matching can be tested on its own.
 */

/** Ctrl plus a physical key (KeyboardEvent.code), so shortcuts work on any keyboard layout. */
export interface KeyCombo {
  code: string
  shift?: boolean
  /** The shell uses this key (Ctrl+K, Ctrl+N, Ctrl+F…), so it only works outside a terminal. */
  outsideTerminal?: boolean
}

const KEY_NAMES: Record<string, string> = { Comma: ',', Slash: '/', Tab: 'Tab' }

function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return KEY_NAMES[code] ?? code
}

/** "Ctrl+Shift+K": the label shown in tooltips, menus and the cheat sheet. */
export function comboLabel(combo: KeyCombo): string {
  return ['Ctrl', ...(combo.shift === true ? ['Shift'] : []), keyName(combo.code)].join('+')
}

/** "Control+Shift+K": the aria-keyshortcuts value. */
export function comboAria(combo: KeyCombo): string {
  return ['Control', ...(combo.shift === true ? ['Shift'] : []), keyName(combo.code)].join('+')
}

/** The first item whose shortcut matches the key press and that is available. */
export function findByKey<T extends { combos: readonly KeyCombo[]; available: () => boolean }>(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey' | 'code'>,
  inTerminal: boolean,
  items: readonly T[],
): T | null {
  if (!event.ctrlKey || event.altKey || event.metaKey) return null
  for (const item of items) {
    const matches = item.combos.some(
      (combo) =>
        combo.code === event.code &&
        (combo.shift === true) === event.shiftKey &&
        !(inTerminal && combo.outsideTerminal === true),
    )
    if (matches && item.available()) return item
  }
  return null
}

export const COMMAND_IDS = [
  'palette',
  'shortcuts',
  'hosts',
  'keychain',
  'settings',
  'newTab',
  'newHost',
  'newGroup',
  'searchHosts',
  'toggleHostsView',
  'closeTab',
  'nextTab',
  'previousTab',
  'renameTab',
  'paste',
  'duplicateTab',
  'newIdentity',
  'generateKey',
  'importKey',
] as const
export type CommandId = (typeof COMMAND_IDS)[number]

/**
 * Every command's shortcuts; the first one is shown in tooltips. Plain Ctrl
 * keys the shell needs (Ctrl+K, Ctrl+N, Ctrl+F, Ctrl+/) are marked
 * outsideTerminal; Ctrl+Shift keys work everywhere.
 */
export const COMMAND_KEYS: Record<CommandId, readonly KeyCombo[]> = {
  palette: [
    { code: 'KeyK', outsideTerminal: true },
    { code: 'KeyP', shift: true },
  ],
  shortcuts: [
    { code: 'Slash', outsideTerminal: true },
    { code: 'Slash', shift: true },
  ],
  hosts: [{ code: 'Digit1' }],
  keychain: [{ code: 'Digit2' }],
  newIdentity: [{ code: 'KeyI', shift: true }],
  generateKey: [{ code: 'KeyG', shift: true }],
  importKey: [{ code: 'KeyO', shift: true }],
  settings: [{ code: 'Comma' }],
  newTab: [{ code: 'KeyT' }],
  newHost: [{ code: 'KeyN', outsideTerminal: true }],
  newGroup: [{ code: 'KeyN', shift: true }],
  searchHosts: [{ code: 'KeyF', outsideTerminal: true }],
  toggleHostsView: [{ code: 'KeyL', shift: true }],
  closeTab: [{ code: 'KeyW' }],
  nextTab: [{ code: 'Tab' }],
  previousTab: [{ code: 'Tab', shift: true }],
  renameTab: [{ code: 'KeyR', shift: true }],
  paste: [{ code: 'KeyV', shift: true }],
  duplicateTab: [{ code: 'KeyT', shift: true }],
}
