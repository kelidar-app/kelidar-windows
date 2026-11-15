import { useEffect } from 'react'
import { api } from '@renderer/lib/api'

/**
 * Keeps the native window buttons (drawn by Windows over our title bar) in
 * the colors of the current theme. The colors come from tokens.css.
 */
export function useTitleBarOverlaySync(): void {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = (): void => {
      const styles = getComputedStyle(document.documentElement)
      const color = styles.getPropertyValue('--titlebar').trim()
      const symbolColor = styles.getPropertyValue('--titlebar-foreground').trim()
      void api.invoke('window:setTitleBarOverlay', { color, symbolColor })
    }
    sync()
    media.addEventListener('change', sync)
    return () => {
      media.removeEventListener('change', sync)
    }
  }, [])
}
