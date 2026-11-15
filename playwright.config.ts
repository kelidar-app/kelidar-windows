import { defineConfig } from '@playwright/test'

/** Electron smoke tests. Run `npm run build` first: they start the built app from out/. */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
})
