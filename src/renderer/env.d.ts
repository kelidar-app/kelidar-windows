import type { RendererApi } from '@shared/ipc'

declare global {
  interface Window {
    /** The only bridge to main, exposed by src/preload/index.ts. */
    readonly api: RendererApi
  }
}

export {}
