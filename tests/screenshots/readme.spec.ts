import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { RendererApi } from '../../src/shared/ipc'
import {
  DEFAULT_UI_SETTINGS,
  SETTINGS_VERSION,
  type Language,
  type Theme,
} from '../../src/shared/settings'
import { startTestServer } from '../integration/helpers/ssh-server'
import { closeAll, importDirOf, launch } from '../e2e/launch'

/**
 * Makes the README screenshots in docs/screenshots from sample data (no real
 * servers or secrets). Run with `npm run screenshots` after `npm run build`.
 */

const OUT = path.resolve('docs/screenshots')

declare global {
  interface Window {
    api: RendererApi
  }
}

async function seed(page: Page, port: number): Promise<void> {
  await page.evaluate(async (serverPort) => {
    // Loosely typed on purpose: this only seeds sample data.
    type Loose = (
      channel: string,
      payload: unknown,
    ) => Promise<{ ok: true; data: { id: string } } | { ok: false; error: { code: string } }>
    const call = async (channel: string, payload: unknown) => {
      const result = await (window.api.invoke.bind(window.api) as Loose)(channel, payload)
      if (!result.ok) throw new Error(`${channel}: ${result.error.code}`)
      return result.data
    }
    const production = await call('groups:save', {
      name: 'Production',
      color: 'red',
      defaults: { environment: 'production' },
    })
    const staging = await call('groups:save', {
      name: 'Staging',
      color: 'amber',
      defaults: { environment: 'staging' },
    })
    const host = (fields: Record<string, unknown>) =>
      call('hosts:save', { username: 'deploy', auth: { type: 'agent' }, ...fields })
    const bastion = await host({ name: 'Bastion', address: 'bastion.example.com', tags: ['jump'] })
    await call('hosts:setFavorite', { id: bastion.id, favorite: true })
    await host({
      name: 'Web 1',
      address: 'web1.example.com',
      groupId: production.id,
      tags: ['web', 'eu'],
      jump: { type: 'host', hostId: bastion.id },
    })
    await host({
      name: 'Web 2',
      address: 'web2.example.com',
      groupId: production.id,
      tags: ['web', 'eu'],
      jump: { type: 'host', hostId: bastion.id },
    })
    await host({
      name: 'Database',
      address: '10.0.4.12',
      groupId: production.id,
      tags: ['db'],
      username: 'postgres',
      notes: 'Primary. Backups run at 02:00.',
    })
    await host({
      name: 'API',
      address: 'api.staging.example.com',
      groupId: staging.id,
      tags: ['api'],
    })
    // One host that really connects, so it shows its system badge.
    await host({
      name: 'Home lab',
      address: '127.0.0.1',
      port: serverPort,
      username: 'tester',
      auth: { type: 'password', password: 'screenshot-only' },
      tags: ['lab'],
    })
  }, port)
}

/** Current settings, with the first-run import offer already made. */
function writeSettings(userData: string, language: Language, theme: Theme): Promise<void> {
  return writeFile(
    path.join(userData, 'settings.json'),
    JSON.stringify({
      version: SETTINGS_VERSION,
      ...DEFAULT_UI_SETTINGS,
      language,
      theme,
      importOffered: true,
    }),
  )
}

test('README screenshots', async () => {
  test.setTimeout(120_000)
  const userData = await mkdtemp(path.join(os.tmpdir(), 'kelidar-shots-'))
  const server = await startTestServer({
    password: 'screenshot-only',
    osRelease: 'ID=ubuntu\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n',
  })
  try {
    await mkdir(OUT, { recursive: true })
    // Something for the import preview, and no first-run offer over the screenshots.
    const importHome = importDirOf(userData)
    await mkdir(path.join(importHome, '.ssh'), { recursive: true })
    await writeFile(
      path.join(importHome, '.ssh', 'config'),
      [
        'Host gitlab-runner',
        '  HostName runner.example.org',
        '  User ci',
        'Host backup',
        '  HostName backup.example.org',
        '  User root',
        '  ProxyJump gitlab-runner',
      ].join('\n'),
    )
    await writeSettings(userData, 'en', 'light')

    let { app, page } = await launch(userData)
    await page.setViewportSize({ width: 1280, height: 800 })
    await seed(page, server.port)
    await page.keyboard.press('Control+2')
    await page.keyboard.press('Control+1')

    // Connect once to the lab host: its badge appears.
    await page.locator('[data-host-item]', { hasText: 'Home lab' }).first().focus()
    await page.keyboard.press('Enter')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Trust and connect' }).click()
    await expect(page.locator('[data-tab-state="ready"]')).toHaveCount(1)
    await page.keyboard.press('Control+1')
    await expect(page.locator('[data-os="ubuntu"]').first()).toBeVisible()
    await page.mouse.move(0, 400)
    await page.screenshot({ path: path.join(OUT, 'hosts.png') })

    await page.keyboard.press('Control+k')
    await page.keyboard.type('web')
    await page.waitForTimeout(200)
    await page.screenshot({ path: path.join(OUT, 'command-palette.png') })
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+Shift+U')
    await expect(page.locator('[data-import-row="backup"]')).toBeVisible()
    await page.screenshot({ path: path.join(OUT, 'import.png') })
    await page.keyboard.press('Escape')
    await app.close()

    // Persian, dark: the whole layout mirrors.
    await writeSettings(userData, 'fa', 'dark')
    ;({ app, page } = await launch(userData))
    await page.setViewportSize({ width: 1280, height: 800 })
    // Playwright pins the light scheme unless told otherwise.
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('[data-host-item]').first()).toBeVisible()
    await page.mouse.move(0, 400)
    await page.screenshot({ path: path.join(OUT, 'hosts-persian.png') })
    await app.close()
  } finally {
    await closeAll()
    await server.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
