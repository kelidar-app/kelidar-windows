import { useEffect } from 'react'
import { terminalActions } from '@renderer/features/terminal/terminal-registry'
import { useHostFormStore } from '@renderer/stores/hosts'
import { HOME_TAB, useTabsStore } from '@renderer/stores/tabs'
import { useUiStore } from '@renderer/stores/ui'

/** Keyboard shortcuts for every action the app has so far. */
export const SHORTCUTS = {
  hosts: { label: 'Ctrl+1', aria: 'Control+1' },
  settings: { label: 'Ctrl+,', aria: 'Control+,' },
  newTab: { label: 'Ctrl+T', aria: 'Control+T' },
  closeTab: { label: 'Ctrl+W', aria: 'Control+W' },
  nextTab: { label: 'Ctrl+Tab', aria: 'Control+Tab' },
  previousTab: { label: 'Ctrl+Shift+Tab', aria: 'Control+Shift+Tab' },
  renameTab: { label: 'Ctrl+Shift+R', aria: 'Control+Shift+R' },
  paste: { label: 'Ctrl+Shift+V', aria: 'Control+Shift+V' },
  newHost: { label: 'Ctrl+N', aria: 'Control+N' },
} as const

/** Decides what a key press does. Returns null for keys the app does not use. */
function actionFor(event: KeyboardEvent): (() => void) | null {
  if (!event.ctrlKey || event.altKey || event.metaKey) return null
  const tabs = useTabsStore.getState()
  const ui = useUiStore.getState()
  const key = event.key.toLowerCase()
  const inTerminal = event.target instanceof Element && event.target.closest('.xterm') !== null

  if (key === 'tab')
    return () => {
      tabs.activateNext(event.shiftKey ? -1 : 1)
    }

  if (event.shiftKey) {
    if (key === 'v' && tabs.activeId !== HOME_TAB) {
      return () => {
        terminalActions(tabs.activeId)?.paste()
      }
    }
    if (key === 'r' && tabs.activeId !== HOME_TAB)
      return () => {
        tabs.startRename()
      }
    return null
  }

  switch (key) {
    case 't':
      return () => {
        ui.focusQuickConnect()
      }
    case 'w':
      if (tabs.activeId === HOME_TAB) return null
      return () => {
        tabs.close(tabs.activeId)
      }
    case '1':
      return () => {
        ui.showSection('hosts')
      }
    case ',':
      return () => {
        ui.showSection('settings')
      }
    case 'n':
      // Ctrl+N belongs to the shell (next history line) inside a terminal.
      if (inTerminal) return null
      return () => {
        ui.showSection('hosts')
        useHostFormStore.getState().openNew()
      }
    default:
      return null
  }
}

/**
 * App shortcuts run in the capture phase, before xterm.js sees the key, so
 * Ctrl+T, Ctrl+W and Ctrl+Tab work while a terminal has focus. They are off
 * while a dialog is open.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (document.querySelector('dialog[open]') !== null) return
      const action = actionFor(event)
      if (action === null) return
      event.preventDefault()
      event.stopPropagation()
      action()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [])
}
