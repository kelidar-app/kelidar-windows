import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { startTestServer, type TestServer } from '../integration/helpers/ssh-server'
import { closeAll, launch } from './launch'

const PASSWORD = 'e2e-Pass-Osprey-6620'

/**
 * Phase 2 smoke test. Step 2.1 (Organize): groups with inherited defaults,
 * tags, favorites, recent, card and list views, search, the command palette
 * and the shortcut cheat sheet. Later steps add to this file.
 */
test('Phase 2 smoke: organize hosts, search, palette and shortcuts', async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'kelidar-e2e-p2-'))
  let server: TestServer | undefined
  try {
    server = await startTestServer({ password: PASSWORD })
    let { app, page, consoleErrors } = await launch(userData)

    // A group whose hosts inherit its port and environment.
    await page.keyboard.press('Control+Shift+N')
    let dialog = page.getByRole('dialog', { name: 'New group' })
    await dialog.getByLabel('Name', { exact: true }).fill('Lab')
    await dialog.getByRole('button', { name: 'Defaults for hosts in this group' }).click()
    await dialog.getByLabel('Port').fill(String(server.port))
    await dialog.getByLabel('Environment').selectOption('staging')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    const lab = page.locator('section[aria-label="Lab"]')
    await expect(lab.getByRole('heading', { name: 'Lab' })).toBeVisible()

    // A host added from the group header lands in the group and shows the group's port.
    await lab.getByRole('button', { name: 'Add a host to Lab' }).click()
    dialog = page.getByRole('dialog', { name: 'New host' })
    // Address has focus when the form opens.
    await expect(dialog.getByLabel('Address')).toBeFocused()
    await dialog.getByLabel('Name', { exact: true }).fill('Box')
    await dialog.getByLabel('Address').fill('127.0.0.1')
    await dialog.getByLabel('User name').fill('tester')
    await dialog.getByRole('textbox', { name: 'Password' }).fill(PASSWORD)
    await expect(dialog.getByLabel('Group')).toBeVisible()
    await expect(dialog.getByLabel('Port')).toHaveAttribute('placeholder', String(server.port))
    await expect(dialog.getByLabel('Environment')).toContainText('From the group: Staging')
    await dialog.getByLabel('Tags').fill('web, eu')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()

    // A second host outside any group.
    await page.keyboard.press('Control+n')
    dialog = page.getByRole('dialog', { name: 'New host' })
    await dialog.getByLabel('Name', { exact: true }).fill('Other')
    await dialog.getByLabel('Address').fill('other.example.invalid')
    await dialog.getByLabel('User name').fill('root')
    await dialog.getByRole('button', { name: 'More options' }).click()
    await dialog.getByLabel('Tags').fill('db')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()

    const box = lab.locator('[data-host-item]', { hasText: 'Box' })
    await expect(box).toContainText(`127.0.0.1:${String(server.port)}`)
    await expect(box.locator('[data-environment="staging"]')).toBeVisible()
    await expect(box).toContainText('#web')

    // Search: Ctrl+F focuses it; #tag filters by tag; Esc clears.
    await page.keyboard.press('Control+f')
    const search = page.getByRole('searchbox', { name: 'Search hosts' })
    await expect(search).toBeFocused()
    await search.fill('#db')
    const results = page.getByRole('list', { name: 'Search results' })
    await expect(results.locator('[data-host-item]')).toHaveCount(1)
    await expect(results).toContainText('Other')
    await search.fill('lab bx')
    await expect(results.locator('[data-host-item]')).toHaveCount(1)
    await expect(results).toContainText('Box')
    await search.press('Escape')
    await expect(search).toHaveValue('')

    // Favorites.
    await box.getByRole('button', { name: 'Add Box to favorites' }).click()
    const favorites = page.getByRole('list', { name: 'Favorites' })
    await expect(favorites).toContainText('Box')

    // Card view by default; Ctrl+Shift+L switches to the compact list and is saved.
    await expect(page.getByRole('button', { name: 'Cards' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.keyboard.press('Control+Shift+L')
    await expect(page.getByRole('button', { name: 'Compact list' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect
      .poll(async () => {
        const raw = await readFile(path.join(userData, 'settings.json'), 'utf8')
        return (JSON.parse(raw) as { hostsView?: string }).hostsView
      })
      .toBe('list')

    // The palette connects to a host; the group's port is used.
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await expect(palette).toBeVisible()
    await page.keyboard.type('box')
    await expect(palette.getByRole('option').first()).toContainText('Box')
    await page.keyboard.press('Enter')
    await expect(palette).toBeHidden()
    const trust = page.getByRole('alertdialog')
    await trust.getByRole('button', { name: 'Trust and connect' }).click()
    await expect(page.locator('[data-tab-state="ready"]')).toHaveCount(1)

    // Inside the terminal Ctrl+K belongs to the shell; Ctrl+Shift+P opens the palette.
    await page.keyboard.press('Control+k')
    await expect(palette).toBeHidden()
    await page.keyboard.press('Control+Shift+P')
    await expect(palette).toBeVisible()
    await page.keyboard.type('go to hosts')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true')

    // The host is now under Recent.
    await expect(page.getByRole('list', { name: 'Recent' })).toContainText('Box')

    // The cheat sheet lists the shortcuts from the same table the keyboard uses.
    await page.keyboard.press('Control+/')
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(sheet).toContainText('Open the command palette')
    await expect(sheet).toContainText('Ctrl+Shift+P')
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()

    // Palette preferences: switch to Persian, and the layout mirrors.
    await page.keyboard.press('Control+k')
    await page.keyboard.type('فارسی')
    await page.keyboard.press('Enter')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('heading', { name: 'هاست‌ها', exact: true })).toBeVisible()

    expect(consoleErrors).toEqual([])
    const pageText = await page.evaluate(() => document.documentElement.outerHTML)
    expect(pageText).not.toContain(PASSWORD)
    await app.close()

    // Restart: groups, favorites and the list view come back.
    ;({ app, page, consoleErrors } = await launch(userData))
    await expect(page.locator('section[aria-label="Lab"]')).toBeVisible()
    await expect(page.locator('[data-host-item]', { hasText: 'Box' }).first()).toBeVisible()
    await expect(page.getByRole('list', { name: 'علاقه‌مندی‌ها' })).toContainText('Box')
    await expect(page.getByRole('button', { name: 'فهرست فشرده' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(consoleErrors).toEqual([])
    await app.close()
  } finally {
    await closeAll()
    await server?.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
