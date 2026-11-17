import { defineConfig } from '@playwright/test'

/** `npm run screenshots`: writes the README images to docs/screenshots (build first). */
export default defineConfig({
  testDir: 'tests/screenshots',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
})
