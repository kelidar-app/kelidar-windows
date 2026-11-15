import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { APP } from '../../src/shared/app'

/** Same name as USER_DATA_OVERRIDE_ENV in src/main/app-paths.ts (that module needs Electron). */
export const USER_DATA_ENV = `${APP.name.toUpperCase()}_USER_DATA_DIR`

export interface Launched {
  app: ElectronApplication
  page: Page
  consoleErrors: string[]
}

/** Every app started by a test file, so a failed assertion still closes it. */
export const launched: ElectronApplication[] = []

export function testEnv(userData: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  env[USER_DATA_ENV] = userData
  return env
}

/** Starts the built app (out/) with its own user data folder. */
export async function launch(userData: string): Promise<Launched> {
  const app = await electron.launch({ args: ['.'], env: testEnv(userData) })
  launched.push(app)
  const page = await app.firstWindow()
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.getByRole('navigation').waitFor()
  return { app, page, consoleErrors }
}

export async function closeAll(): Promise<void> {
  await Promise.all(launched.splice(0).map((app) => app.close().catch(() => undefined)))
}
