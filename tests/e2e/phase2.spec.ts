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
 * and the shortcut cheat sheet. Step 2.2 (Credentials): the Keychain (key
 * generation, copying the public key, identities) and Upgrade to key login.
 * Step 2.3 (Reach): a jump host chosen in the form, the sticky session
 * command shown before it runs, and a new tab on the same connection.
 * Later steps add to this file.
 */
test('Phase 2 smoke: organize hosts, search, palette and shortcuts', async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'kelidar-e2e-p2-'))
  let server: TestServer | undefined
  let keyServer: TestServer | undefined
  let behindServer: TestServer | undefined
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

    // Keychain: generate a key and copy its public key.
    await page.keyboard.press('Control+2')
    await expect(page.getByRole('heading', { name: 'Keychain', exact: true })).toBeVisible()
    await page.keyboard.press('Control+Shift+G')
    dialog = page.getByRole('dialog', { name: 'Generate a key' })
    await page.keyboard.type('e2e key')
    await dialog.getByRole('button', { name: 'Generate', exact: true }).click()
    await expect(dialog).toBeHidden()
    const keyRow = page.locator('[data-key-id]', { hasText: 'e2e key' })
    await expect(keyRow.locator('[data-fingerprint]')).toHaveText(/^SHA256:[\w+/]{43}$/)
    await keyRow.getByRole('button', { name: 'Copy the public key of e2e key' }).click()
    const publicKey = await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toMatch(/^ssh-ed25519 AAAA\S+ e2e key$/)
      .then(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    keyServer = await startTestServer({ authorizedKey: publicKey })

    // An identity that signs in with that key, used by a new host.
    await page.keyboard.press('Control+Shift+I')
    dialog = page.getByRole('dialog', { name: 'New identity' })
    await page.keyboard.type('Tester')
    await dialog.getByLabel('User name').fill('tester')
    await dialog.getByText('Private key', { exact: true }).click()
    await dialog.getByLabel('Key', { exact: true }).selectOption({ label: 'e2e key (ed25519)' })
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('[data-identity-id]', { hasText: 'Tester' })).toContainText(
      'key e2e key',
    )

    await page.keyboard.press('Control+n')
    dialog = page.getByRole('dialog', { name: 'New host' })
    await dialog.getByLabel('Name', { exact: true }).fill('Keyed')
    await dialog.getByLabel('Address').fill('127.0.0.1')
    await dialog.getByText('Identity', { exact: true }).click()
    await expect(dialog.getByLabel('User name')).toBeHidden()
    await dialog.getByLabel('Identity to use').selectOption({ label: 'Tester (tester)' })
    await dialog.getByRole('button', { name: 'More options' }).click()
    await dialog.getByLabel('Port').fill(String(keyServer.port))
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    await page
      .locator('[data-host-item]', { hasText: 'Keyed' })
      .getByRole('button', { name: 'Connect to Keyed' })
      .click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Trust and connect' }).click()
    await expect(page.locator('[data-tab-state="ready"]')).toHaveCount(2)
    expect(keyServer.authAttempts.map((a) => a.method)).not.toContain('password')

    // Upgrade Box from its password to a new key; the command is shown before it runs.
    await page.keyboard.press('Control+1')
    await page.getByRole('button', { name: 'Edit Box' }).first().click()
    dialog = page.getByRole('dialog', { name: 'Edit host' })
    await dialog.getByRole('button', { name: 'Upgrade to key login…' }).click()
    dialog = page.getByRole('dialog', { name: 'Upgrade Box to key login' })
    await dialog.getByRole('button', { name: 'Show the command' }).click()
    const command = dialog.locator('[data-upgrade-command]')
    await expect(command).toContainText('~/.ssh/authorized_keys')
    expect(server.execs).toEqual([])
    const shown = await command.textContent()
    await dialog.getByRole('button', { name: /^Run on / }).click()
    await expect(dialog.getByRole('status')).toContainText('now signs in with a key')
    // Exactly the command that was shown ran on the server.
    expect(server.execs[0]).toBe(shown)
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(
      page
        .locator('[data-host-item]', { hasText: 'Box' })
        .first()
        .getByLabel('Signs in with a private key'),
    ).toBeVisible()

    // A host behind a jump host (Box), set in the form.
    behindServer = await startTestServer({ password: PASSWORD })
    await page.keyboard.press('Control+n')
    dialog = page.getByRole('dialog', { name: 'New host' })
    await dialog.getByLabel('Name', { exact: true }).fill('Behind')
    await dialog.getByLabel('Address').fill('127.0.0.1')
    await dialog.getByLabel('User name').fill('tester')
    await dialog.getByRole('textbox', { name: 'Password' }).fill(PASSWORD)
    await dialog.getByRole('button', { name: 'More options' }).click()
    await dialog.getByLabel('Port').fill(String(behindServer.port))
    await dialog.getByLabel('Jump host').selectOption({ label: 'Box' })
    // The sticky session option shows the exact command before anything runs.
    await expect(
      dialog.locator('code', { hasText: 'tmux new-session -A -s kelidar-' }),
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    const behind = page.locator('[data-host-item]', { hasText: 'Behind' })
    await expect(behind).toContainText('via Box')
    await behind.getByRole('button', { name: 'Connect to Behind' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Trust and connect' }).click()
    await expect(page.locator('[data-tab-state="ready"]')).toHaveCount(3)
    expect(server.forwards).toEqual([{ host: '127.0.0.1', port: behindServer.port }])

    // Ctrl+Shift+T: a second tab on the same connection, no new sign-in.
    const signIns = behindServer.authAttempts.length
    await page.keyboard.press('Control+Shift+T')
    await expect(page.locator('[data-tab-state="ready"]')).toHaveCount(4)
    await expect.poll(() => behindServer?.openShells()).toBe(2)
    expect(behindServer.connections).toHaveLength(1)
    expect(behindServer.authAttempts).toHaveLength(signIns)
    await page.keyboard.press('Control+1')

    // Drag and drop: "Other" into the Lab group, then back out to the top level.
    const labHeader = lab.locator('[data-group-header]')
    await page.locator('[data-host-item]', { hasText: 'Other' }).first().dragTo(labHeader)
    await expect(lab.locator('[data-host-item]', { hasText: 'Other' })).toBeVisible()
    const other = lab.locator('[data-host-item]', { hasText: 'Other' })
    const from = await other.boundingBox()
    if (from === null) throw new Error('Other is not visible')
    await page.mouse.move(from.x + 20, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 40, from.y + from.height / 2 + 10, { steps: 5 })
    const zone = page.locator('[data-top-level-drop]')
    await expect(zone).toContainText('take the host out of its group')
    const to = await zone.boundingBox()
    if (to === null) throw new Error('no drop zone')
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 })
    await page.mouse.up()
    await expect(lab.locator('[data-host-item]', { hasText: 'Other' })).toHaveCount(0)
    await expect(page.locator('[data-top-level-drop]')).toHaveCount(0)

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
    await keyServer?.close()
    await behindServer?.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
