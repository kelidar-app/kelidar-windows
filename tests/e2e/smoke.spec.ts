import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { APP, APP_ORIGIN } from '../../src/shared/app'
import type { RendererApi } from '../../src/shared/ipc'

/** Same name as USER_DATA_OVERRIDE_ENV in src/main/app-paths.ts (that module needs Electron). */
const USER_DATA_ENV = `${APP.name.toUpperCase()}_USER_DATA_DIR`

interface Launched {
  app: ElectronApplication
  page: Page
  consoleErrors: string[]
}

/** Every app started by this file, so a failed assertion still closes it. */
const launched: ElectronApplication[] = []

async function launch(userData: string): Promise<Launched> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  env[USER_DATA_ENV] = userData
  const app = await electron.launch({ args: ['.'], env })
  launched.push(app)
  const page = await app.firstWindow()
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.getByRole('navigation').waitFor()
  return { app, page, consoleErrors }
}

function api(page: Page) {
  return {
    invoke: (channel: string, payload?: unknown) =>
      page.evaluate(
        ([c, p]) =>
          (
            window as unknown as { api: { invoke: (c: unknown, p?: unknown) => unknown } }
          ).api.invoke(c, p),
        [channel, payload] as const,
      ),
  }
}

test('Phase 0 smoke: secure shell, typed IPC, and Persian mirrors the layout', async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'kelidar-e2e-'))
  const settingsFile = path.join(userData, 'settings.json')
  await writeFile(settingsFile, JSON.stringify({ version: 1, language: 'en', theme: 'system' }))
  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }

  try {
    let { app, page, consoleErrors } = await launch(userData)

    // Served from the custom protocol, with the product name as title.
    expect(page.url()).toBe(`${APP_ORIGIN}/index.html`)
    await expect(page).toHaveTitle(APP.name)
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')

    // The renderer has no Node access and only the one bridge object.
    expect(await page.evaluate(() => 'require' in window || 'process' in window)).toBe(false)
    expect(
      await page.evaluate(() => Object.keys((window as unknown as { api: RendererApi }).api)),
    ).toEqual(['invoke'])

    // Typed IPC round trip, and the preload/main refusals.
    expect(await api(page).invoke('app:getVersion')).toEqual({
      ok: true,
      data: { version: pkg.version },
    })
    expect(await api(page).invoke('app:quit')).toEqual({
      ok: false,
      error: { code: 'IPC_FORBIDDEN' },
    })
    expect(await api(page).invoke('settings:update', { language: 'de' })).toEqual({
      ok: false,
      error: { code: 'IPC_INVALID_PAYLOAD' },
    })

    // Shell: sidebar with only Hosts and Settings enabled, empty state with Quick Connect.
    const nav = page.getByRole('navigation')
    for (const key of ['files', 'tunnels', 'snippets']) {
      await expect(page.locator(`[data-nav="${key}"]`)).toHaveAttribute('aria-disabled', 'true')
    }
    await expect(page.getByRole('heading', { name: 'No hosts yet' })).toBeVisible()
    await expect(page.getByLabel('Quick Connect')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true')

    const width = await page.evaluate(() => window.innerWidth)
    const ltrBox = await nav.boundingBox()
    expect(ltrBox).not.toBeNull()
    expect(ltrBox?.x ?? Infinity).toBeLessThan(width / 2)

    // New windows and navigation are denied. (Uses hosts that never resolve,
    // so a failure could not open a real site.)
    await page.evaluate(() => {
      window.open('about:blank')
    })
    await page.evaluate(() => {
      window.location.href = 'https://example.invalid/'
    })
    await page.waitForTimeout(500)
    expect(app.windows()).toHaveLength(1)
    expect(page.url()).toBe(`${APP_ORIGIN}/index.html`)
    // about:blank commits without will-navigate; main loads the app again.
    await page
      .evaluate(() => {
        window.location.href = 'about:blank'
      })
      .catch(() => undefined)
    await expect(page).toHaveURL(`${APP_ORIGIN}/index.html`)
    await nav.waitFor()
    expect(app.windows()).toHaveLength(1)

    // Settings by shortcut, then switch to Persian.
    await page.keyboard.press('Control+,')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await page.getByText('فارسی', { exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa')
    await expect(page.getByRole('heading', { name: 'تنظیمات' })).toBeVisible()

    // The sidebar moved to the right edge.
    const rtlBox = await nav.boundingBox()
    expect(rtlBox?.x ?? 0).toBeGreaterThan(width / 2)

    // The choice is saved in settings.json.
    const saved = JSON.parse(await readFile(settingsFile, 'utf8')) as { language: string }
    expect(saved.language).toBe('fa')

    expect(consoleErrors).toEqual([])
    await app.close()

    // Restart: Persian and right-to-left come back.
    ;({ app, page, consoleErrors } = await launch(userData))
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('heading', { name: 'هنوز هاستی ندارید' })).toBeVisible()
    expect(consoleErrors).toEqual([])
    await app.close()
  } finally {
    await Promise.all(launched.map((app) => app.close().catch(() => undefined)))
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
