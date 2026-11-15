import { useEffect } from 'react'
import { useUiStore } from '@renderer/stores/ui'

/** Keyboard shortcuts for every action the shell has so far. */
export const SHORTCUTS = {
  hosts: { label: 'Ctrl+1', aria: 'Control+1' },
  settings: { label: 'Ctrl+,', aria: 'Control+,' },
  newTab: { label: 'Ctrl+T', aria: 'Control+T' },
} as const

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
      const { showSection, focusQuickConnect } = useUiStore.getState()
      switch (event.key.toLowerCase()) {
        case '1':
          showSection('hosts')
          break
        case ',':
          showSection('settings')
          break
        case 't':
          focusQuickConnect()
          break
        default:
          return
      }
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}
