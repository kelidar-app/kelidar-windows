import { useEffect } from 'react'
import { comboAria, comboLabel, commandById, commandForKey, type CommandId } from './commands'

export interface ShortcutLabel {
  label: string
  aria: string
}

/** The main shortcut of a command, for tooltips and aria-keyshortcuts. */
export function shortcutOf(id: CommandId): ShortcutLabel {
  const combo = commandById(id).combos[0]
  if (combo === undefined) throw new Error(`Command ${id} has no shortcut`)
  return { label: comboLabel(combo), aria: comboAria(combo) }
}

/** Kept for the components that name a shortcut in a tooltip. */
export const SHORTCUTS = {
  hosts: shortcutOf('hosts'),
  keychain: shortcutOf('keychain'),
  newIdentity: shortcutOf('newIdentity'),
  generateKey: shortcutOf('generateKey'),
  importKey: shortcutOf('importKey'),
  settings: shortcutOf('settings'),
  newTab: shortcutOf('newTab'),
  closeTab: shortcutOf('closeTab'),
  nextTab: shortcutOf('nextTab'),
  previousTab: shortcutOf('previousTab'),
  renameTab: shortcutOf('renameTab'),
  paste: shortcutOf('paste'),
  newHost: shortcutOf('newHost'),
  newGroup: shortcutOf('newGroup'),
  palette: shortcutOf('palette'),
  searchHosts: shortcutOf('searchHosts'),
  toggleHostsView: shortcutOf('toggleHostsView'),
  fillSudo: shortcutOf('fillSudo'),
  zoomIn: shortcutOf('zoomIn'),
  zoomOut: shortcutOf('zoomOut'),
  zoomReset: shortcutOf('zoomReset'),
} as const

/**
 * App shortcuts run in the capture phase, before xterm.js sees the key, so
 * Ctrl+T, Ctrl+W and Ctrl+Tab work while a terminal has focus. They are off
 * while a dialog is open.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (document.querySelector('dialog[open]') !== null) return
      const inTerminal = event.target instanceof Element && event.target.closest('.xterm') !== null
      const command = commandForKey(event, inTerminal)
      if (command === null) return
      event.preventDefault()
      event.stopPropagation()
      command.run()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [])
}
