import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
  },
  preload: {
    // The sandboxed preload cannot require node_modules, so bundle everything.
    resolve: { alias: shared },
    build: { externalizeDeps: false },
  },
  renderer: {
    resolve: { alias: { ...shared, '@renderer': resolve('src/renderer') } },
    plugins: [react(), tailwindcss()],
    build: {
      minify: true,
      // Keep every asset as a file: the CSP has no data: sources.
      assetsInlineLimit: 0,
    },
  },
})
