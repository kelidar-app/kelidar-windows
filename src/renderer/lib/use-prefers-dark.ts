import { useSyncExternalStore } from 'react'

const query = '(prefers-color-scheme: dark)'

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(query)
  media.addEventListener('change', onChange)
  return () => {
    media.removeEventListener('change', onChange)
  }
}

/** True while the app is dark: Windows' choice, or the user's choice in Settings. */
export function usePrefersDark(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}
