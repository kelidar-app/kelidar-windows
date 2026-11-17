/**
 * Keyboard shortcuts as data: modifiers plus a physical key. No store
 * imports, so the matching can be tested on its own.
 */

/**
 * Modifiers plus a physical key (KeyboardEvent.code), so shortcuts work on any
 * keyboard layout. Ctrl is on unless `ctrl: false`.
 */
export interface KeyCombo {
  code: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  /** The shell uses this key (Ctrl+K, Ctrl+N, Ctrl+F…), so it only works outside a terminal. */
  outsideTerminal?: boolean
}

const KEY_NAMES: Record<string, string> = {
  Comma: ',',
  Slash: '/',
  Tab: 'Tab',
  Equal: '=',
  Minus: '-',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
}

function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return KEY_NAMES[code] ?? code
}

/** "Ctrl+Shift+K": the label shown in tooltips, menus and the cheat sheet. */
function modifiers(combo: KeyCombo, ctrl: string): string[] {
  return [
    ...(combo.ctrl === false ? [] : [ctrl]),
    ...(combo.alt === true ? ['Alt'] : []),
    ...(combo.shift === true ? ['Shift'] : []),
  ]
}

export function comboLabel(combo: KeyCombo): string {
  return [...modifiers(combo, 'Ctrl'), keyName(combo.code)].join('+')
}

/** "Control+Shift+K": the aria-keyshortcuts value. */
const ARIA_KEYS: Record<string, string> = {
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
}

export function comboAria(combo: KeyCombo): string {
  return [...modifiers(combo, 'Control'), ARIA_KEYS[combo.code] ?? keyName(combo.code)].join('+')
}

/** The first item whose shortcut matches the key press and that is available. */
export function findByKey<T extends { combos: readonly KeyCombo[]; available: () => boolean }>(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey' | 'code'>,
  inTerminal: boolean,
  items: readonly T[],
): T | null {
  if (event.metaKey) return null
  for (const item of items) {
    const matches = item.combos.some(
      (combo) =>
        combo.code === event.code &&
        (combo.ctrl !== false) === event.ctrlKey &&
        (combo.alt === true) === event.altKey &&
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
  'splitRight',
  'splitDown',
  'closePane',
  'focusLeft',
  'focusRight',
  'focusUp',
  'focusDown',
  'resizeLeft',
  'resizeRight',
  'resizeUp',
  'resizeDown',
  'searchTerminal',
  'zoomIn',
  'zoomOut',
  'zoomReset',
  'fillSudo',
  'newIdentity',
  'generateKey',
  'importKey',
  'lockNow',
  'copyPassword',
  'masterPassword',
  'exportData',
  'importData',
  'restoreBackup',
  'importHosts',
  'smartPaste',
  'checkUpdates',
  'installUpdate',
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
  splitRight: [{ code: 'KeyD', shift: true }],
  splitDown: [{ code: 'KeyE', shift: true }],
  closePane: [{ code: 'KeyW', shift: true }],
  // Alt+Arrow and Alt+Shift+Arrow, as in Windows Terminal; only while a tab is split.
  focusLeft: [{ code: 'ArrowLeft', ctrl: false, alt: true }],
  focusRight: [{ code: 'ArrowRight', ctrl: false, alt: true }],
  focusUp: [{ code: 'ArrowUp', ctrl: false, alt: true }],
  focusDown: [{ code: 'ArrowDown', ctrl: false, alt: true }],
  resizeLeft: [{ code: 'ArrowLeft', ctrl: false, alt: true, shift: true }],
  resizeRight: [{ code: 'ArrowRight', ctrl: false, alt: true, shift: true }],
  resizeUp: [{ code: 'ArrowUp', ctrl: false, alt: true, shift: true }],
  resizeDown: [{ code: 'ArrowDown', ctrl: false, alt: true, shift: true }],
  searchTerminal: [{ code: 'KeyF', shift: true }],
  zoomIn: [{ code: 'Equal' }],
  zoomOut: [{ code: 'Minus' }],
  zoomReset: [{ code: 'Digit0' }],
  fillSudo: [{ code: 'KeyS', shift: true }],
  lockNow: [{ code: 'KeyK', shift: true }],
  copyPassword: [{ code: 'KeyA', shift: true }],
  masterPassword: [{ code: 'KeyM', shift: true }],
  exportData: [{ code: 'KeyX', shift: true }],
  importData: [{ code: 'KeyJ', shift: true }],
  restoreBackup: [{ code: 'KeyH', shift: true }],
  importHosts: [{ code: 'KeyU', shift: true }],
  smartPaste: [{ code: 'KeyB', shift: true }],
  checkUpdates: [{ code: 'KeyY', shift: true }],
  installUpdate: [{ code: 'KeyQ', shift: true }],
}
