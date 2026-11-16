import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import electronPath from 'electron'
import { startTestServer, type TestServer } from '../integration/helpers/ssh-server'
import { closeAll, launch, testEnv } from './launch'

const PASSWORD = 'e2e-Pass-Heron-5521'

async function readAllFiles(dir: string): Promise<string> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  let text = ''
  for (const entry of entries) {
    if (entry.isFile()) {
      text += await readFile(path.join(entry.parentPath, entry.name), 'latin1').catch(() => '')
    }
  }
  return text
}

/** Double-clicks the first word on the terminal's top line (copy on select puts it on the clipboard). */
async function selectFirstWord(page: Page): Promise<void> {
  const screen = page.locator('section:not([hidden]) [data-terminal] .xterm-screen')
  const box = await screen.boundingBox()
  if (box === null) throw new Error('terminal not visible')
  await page.mouse.dblclick(box.x + 12, box.y + 8)
}

test('Phase 1 smoke: vault self-test, save a host, connect, three sessions, no secrets', async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'kelidar-e2e-p1-'))
  let server: TestServer | undefined
  try {
    // The vault works against the real safeStorage (DPAPI) inside Electron.
    const selfTest = spawnSync(electronPath as unknown as string, ['.', '--vault-self-test'], {
      env: testEnv(userData),
      encoding: 'utf8',
      timeout: 60_000,
    })
    expect(selfTest.status).toBe(0)
    expect(selfTest.stdout).toContain('"ok":true')

    server = await startTestServer({ password: PASSWORD })
    const { app, page, consoleErrors } = await launch(userData)

    // Save a host with the four fields; the port sits under "More options".
    await page.keyboard.press('Control+n')
    const form = page.getByRole('dialog')
    await form.getByLabel('Name', { exact: true }).fill('Test server')
    await form.getByLabel('Address').fill('127.0.0.1')
    await form.getByLabel('User name').fill('tester')
    await form.getByRole('textbox', { name: 'Password' }).fill(PASSWORD)
    await expect(form.getByLabel('Port')).toBeHidden()
    await form.getByRole('button', { name: 'More options' }).click()
    await form.getByLabel('Port').fill(String(server.port))
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(form).toBeHidden()

    // Connect; trust the server key shown by its SHA-256 fingerprint.
    await page.getByRole('button', { name: 'Connect to Test server' }).click()
    const trust = page.getByRole('alertdialog')
    await expect(trust.locator('[data-fingerprint]')).toHaveText(/^SHA256:[\w+/]{43}$/)
    await trust.getByRole('button', { name: 'Trust and connect' }).click()
    await expect(page.locator('[data-tab-state="ready"]')).toHaveCount(1)

    // Output reached the terminal: copy on select picks up the server's banner.
    await selectFirstWord(page)
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('welcome')

    // Typing and pasting reach the server.
    await page.keyboard.type('whoami')
    await app.evaluate(({ clipboard }) => clipboard.writeText(' --pasted'))
    await page.keyboard.press('Control+Shift+V')
    await expect.poll(() => server?.received.join('')).toContain('whoami --pasted')

    // Three sessions at once.
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press('Control+1')
      // The host now also shows under Recent; either button connects.
      await page.getByRole('button', { name: 'Connect to Test server' }).first().click()
    }
    await expect(page.locator('[data-tab-state="ready"]')).toHaveCount(3)
    await expect.poll(() => server?.openShells()).toBe(3)

    // Rename, switch and close tabs from the keyboard.
    await page.keyboard.press('Control+Shift+R')
    await page.getByLabel('Tab name').fill('third')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('tab', { name: 'third' })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Control+Tab')
    await expect(page.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Control+Shift+Tab')
    await page.keyboard.press('Control+w')
    await expect(page.locator('[data-tab-state="ready"]')).toHaveCount(2)
    await expect.poll(() => server?.openShells()).toBe(2)

    // The server goes away: every tab shows it.
    for (const connection of server.connections) connection.end()
    await expect(page.locator('[data-tab-state="error"]')).toHaveCount(2)
    await expect(page.locator('section:not([hidden]) [data-session-banner="error"]')).toContainText(
      'The connection was lost',
    )

    // No secret in the page or its storage, none on disk in plain text.
    const pageText = await page.evaluate(
      () =>
        document.documentElement.outerHTML +
        JSON.stringify(Object.entries(localStorage)) +
        JSON.stringify(Object.entries(sessionStorage)),
    )
    expect(pageText).not.toContain(PASSWORD)
    await app.close()
    const onDisk = await readAllFiles(userData)
    expect(onDisk).toContain('aes-256-gcm')
    expect(onDisk).not.toContain(PASSWORD)
    expect(onDisk).not.toContain(Buffer.from(PASSWORD).toString('base64'))

    // No CSP violations or other renderer errors.
    expect(consoleErrors).toEqual([])
  } finally {
    await closeAll()
    await server?.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
