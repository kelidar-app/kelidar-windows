import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { startTestServer, type TestServer } from '../integration/helpers/ssh-server'
import { readableKeyPair } from '../unit/helpers/keys'
import { closeAll, importDirOf, launch } from './launch'

const PASSWORD = 'e2e-Pass-Osprey-6620'

/**
 * Phase 2 smoke test. Step 2.1 (Organize): groups with inherited defaults,
 * tags, favorites, recent, card and list views, search, the command palette
 * and the shortcut cheat sheet. Step 2.2 (Credentials): the Keychain (key
 * generation, copying the public key, identities) and Upgrade to key login.
 * Step 2.3 (Reach): a jump host chosen in the form, the sticky session
 * command shown before it runs, and a new tab on the same connection.
 * Step 2.4 (Terminal comfort): split panes and pane focus, search, zoom, the
 * production colors and paste guard, the sudo password hotkey, and dragging
 * a tab into another tab's panes.
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
    // Only the read-only system check (named in Settings) ran so far.
    const upgradeExecs = () => server?.execs.filter((run) => run !== 'cat /etc/os-release') ?? []
    expect(upgradeExecs()).toEqual([])
    const shown = await command.textContent()
    await dialog.getByRole('button', { name: /^Run on / }).click()
    await expect(dialog.getByRole('status')).toContainText('now signs in with a key')
    // Exactly the command that was shown ran on the server.
    expect(upgradeExecs()[0]).toBe(shown)
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

    // Tag "Behind" as production: its tabs and panes turn red.
    await page.getByRole('button', { name: 'Edit Behind' }).first().click()
    dialog = page.getByRole('dialog', { name: 'Edit host' })
    await dialog.getByLabel('Environment').selectOption('production')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    await page
      .getByRole('tab', { name: /^Behind/ })
      .first()
      .click()
    await expect(page.locator('[data-tab-state][data-environment="production"]')).toHaveCount(2)
    const view = page.locator('[data-tab-view]:not([hidden])')
    await expect(view.locator('[data-pane-id][data-environment="production"]:visible')).toHaveCount(
      1,
    )

    // Split right: a second pane on the same connection, then move focus with Alt+Arrow.
    await page.keyboard.press('Control+Shift+D')
    await expect(view.locator('[data-pane-state="ready"]:visible')).toHaveCount(2)
    await expect.poll(() => behindServer?.openShells()).toBe(3)
    expect(behindServer.connections).toHaveLength(1)
    const panes = view.locator('[data-pane-id]:visible')
    await expect(panes.nth(1)).toHaveAttribute('data-focused', '')
    await page.keyboard.press('Alt+ArrowLeft')
    await expect(panes.nth(0)).toHaveAttribute('data-focused', '')

    // Search the scrollback of the focused pane.
    await page.keyboard.press('Control+Shift+F')
    const termSearch = view.getByRole('search')
    await termSearch.getByRole('textbox', { name: 'Search' }).fill('welcome')
    await expect(termSearch.getByRole('status')).toHaveText(/1 of \d+/)
    await page.keyboard.press('Escape')
    await expect(termSearch).toBeHidden()

    // Zoom: bigger letters, fewer columns, and the server hears the new size.
    const columnsBefore = behindServer.resizes.at(-1)?.cols ?? 0
    await page.keyboard.press('Control+Equal')
    await page.keyboard.press('Control+Equal')
    await expect.poll(() => behindServer?.resizes.at(-1)?.cols ?? 0).toBeLessThan(columnsBefore)
    await page.keyboard.press('Control+Digit0')

    // Pasting two lines on production: preview, and a box to tick first.
    await app.evaluate(({ clipboard }) => clipboard.writeText('echo one\necho two\n'))
    await page.keyboard.press('Control+Shift+V')
    const guard = page.getByRole('alertdialog', { name: 'Paste 2 lines?' })
    await expect(guard.locator('[data-paste-preview]')).toHaveText('echo one\necho two')
    const pasteButton = guard.getByRole('button', { name: 'Paste 2 lines' })
    await expect(pasteButton).toBeDisabled()
    await guard.getByRole('checkbox').check()
    await pasteButton.click()
    await expect.poll(() => behindServer?.received.join('')).toContain('echo two')

    // sudo asks: the bar offers the hotkey, which types the saved password.
    await page.keyboard.type('sudo whoami')
    await page.keyboard.press('Enter')
    await expect(view.locator('[data-sudo-bar]:visible')).toBeVisible()
    expect(behindServer.sudoAnswers).toEqual([])
    await page.keyboard.press('Control+Shift+S')
    await expect
      .poll(() => behindServer?.sudoAnswers)
      .toEqual([{ password: PASSWORD, right: true }])
    await expect(view.locator('[data-sudo-bar]:visible')).toHaveCount(0)

    // Close the pane: the other one stays.
    await page.keyboard.press('Control+Shift+W')
    await expect(view.locator('[data-pane-id]:visible')).toHaveCount(1)

    // Drag the second "Behind" tab into this one: a preview shows the half it
    // will take, and on release both share the tab, still connected.
    const tabCount = await page.locator('[data-tab-state]').count()
    const shells = behindServer.openShells()
    const source = page.locator('[data-tab-state]', { hasText: 'Behind' }).nth(1)
    const tabBox = await source.boundingBox()
    const area = await view.locator('[data-pane-id]:visible').boundingBox()
    if (tabBox === null || area === null) throw new Error('tab or pane not visible')
    await page.mouse.move(tabBox.x + 20, tabBox.y + tabBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(tabBox.x + 40, tabBox.y + tabBox.height / 2 + 20, { steps: 5 })
    await page.mouse.move(area.x + area.width * 0.9, area.y + area.height / 2, { steps: 8 })
    await page.mouse.move(area.x + area.width * 0.92, area.y + area.height / 2, { steps: 2 })
    await expect(page.locator('[data-drop-preview="right"]')).toContainText('Put Behind here')
    await page.mouse.up()
    await expect(page.locator('[data-tab-state]')).toHaveCount(tabCount - 1)
    await expect(view.locator('[data-pane-state="ready"]:visible')).toHaveCount(2)
    expect(behindServer.openShells()).toBe(shells)
    await page.keyboard.press('Control+1')

    // Palette preferences: switch to Persian, and the layout mirrors.
    await page.keyboard.press('Control+k')
    await page.keyboard.type('فارسی')
    await page.keyboard.press('Enter')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('heading', { name: 'هاست‌ها', exact: true })).toBeVisible()

    // In Persian a split tab keeps its geometry: the tab dropped on the right
    // half earlier (now the focused pane) is still on the right, not mirrored.
    await page.locator('[data-tab-state]', { hasText: 'Behind' }).first().click()
    const visiblePanes = page.locator('[data-tab-view] [data-pane-id]:visible')
    await expect(visiblePanes).toHaveCount(2)
    const [droppedBox, otherBox] = await Promise.all([
      page.locator('[data-tab-view] [data-pane-id][data-focused]:visible').boundingBox(),
      page.locator('[data-tab-view] [data-pane-id]:not([data-focused]):visible').boundingBox(),
    ])
    if (droppedBox === null || otherBox === null) throw new Error('panes not visible')
    expect(droppedBox.x).toBeGreaterThan(otherBox.x)
    expect(otherBox.x + otherBox.width).toBeLessThanOrEqual(droppedBox.x + 1)

    // Shortcuts inside Persian sentences keep their own order ("Ctrl+=", not "=+Ctrl").
    await page.keyboard.press('Control+,')
    const zoomHint = page.locator('p', { hasText: 'Ctrl+=' })
    const shortcutOrder = await zoomHint.evaluate((element) => {
      const node = element.firstChild
      const text = node?.textContent ?? ''
      const x = (index: number): number => {
        const range = document.createRange()
        range.setStart(node as Node, index)
        range.setEnd(node as Node, index + 1)
        return range.getBoundingClientRect().x
      }
      return ['Ctrl+=', 'Ctrl+-', 'Ctrl+0'].map((key) => {
        const at = text.indexOf(key)
        return x(at) < x(at + key.length - 1)
      })
    })
    expect(shortcutOrder).toEqual([true, true, true])
    await page.keyboard.press('Control+1')

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

/**
 * Step 2.5 (Security): copy a saved password (cleared on lock), set a master
 * password, lock and unlock (a locked vault shows nothing sensitive), the
 * automatic backups, export and import, and a restart that opens locked.
 */
test('Phase 2 security: master password, lock screen, backups, export and import', async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'kelidar-e2e-p2s-'))
  const master = 'e2e-Master-Kestrel-3307'
  const exportFile = path.join(userData, 'backup.kelidar')
  try {
    let { app, page, consoleErrors } = await launch(userData)

    await page.keyboard.press('Control+n')
    const form = page.getByRole('dialog', { name: 'New host' })
    await form.getByLabel('Name', { exact: true }).fill('Vault Box')
    await form.getByLabel('Address').fill('vault-box.example.test')
    await form.getByLabel('User name').fill('tester')
    await form.getByRole('textbox', { name: 'Password' }).fill(PASSWORD)
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(form).toBeHidden()

    // Copy password: main writes the clipboard; the page never holds the value.
    const item = page.locator('[data-host-item]', { hasText: 'Vault Box' }).first()
    await item.focus()
    await page.keyboard.press('Control+Shift+A')
    await expect(page.locator('[data-notice]')).toContainText('Password copied')
    const clipboardText = () => app.evaluate(({ clipboard }) => clipboard.readText())
    expect(await clipboardText()).toBe(PASSWORD)

    // Set a master password from Settings.
    await page.keyboard.press('Control+,')
    await page.getByRole('button', { name: 'Set a master password' }).click()
    let dialog = page.getByRole('dialog', { name: 'Set a master password' })
    await dialog.getByLabel('New master password').fill('short')
    await dialog.getByLabel('Type it again').fill('short')
    await dialog.getByRole('button', { name: 'Set password' }).click()
    await expect(dialog).toContainText('Use at least 8 characters.')
    await dialog.getByLabel('New master password').fill(master)
    await dialog.getByLabel('Type it again').fill(master)
    await dialog.getByRole('button', { name: 'Set password' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByLabel('Lock after no activity')).toBeEnabled()

    // Lock: only the lock screen remains; no host, no clipboard password.
    await page.keyboard.press('Control+Shift+K')
    const lockScreen = page.locator('[data-lock-screen]')
    await expect(lockScreen.getByRole('heading', { name: 'Kelidar is locked' })).toBeVisible()
    await expect(page.locator('[data-app-shell]')).toBeHidden()
    const lockedHtml = await page.evaluate(() => document.documentElement.outerHTML)
    expect(lockedHtml).not.toContain('Vault Box')
    expect(lockedHtml).not.toContain('vault-box.example.test')
    await expect.poll(clipboardText).toBe('')

    await lockScreen.getByLabel('Master password').fill('not the password')
    await lockScreen.getByRole('button', { name: 'Unlock' }).click()
    await expect(lockScreen).toContainText('That is not the master password.')
    await lockScreen.getByLabel('Master password').fill(master)
    await lockScreen.getByRole('button', { name: 'Unlock' }).click()
    await expect(lockScreen).toBeHidden()
    await page.keyboard.press('Control+1')
    await expect(page.locator('[data-host-item]', { hasText: 'Vault Box' }).first()).toBeVisible()

    // The automatic backups, newest first, protected by the master password
    // (a change makes one: the copy before it is kept).
    await page.locator('[data-host-item]', { hasText: 'Vault Box' }).first().focus()
    await page.keyboard.press('Control+d')
    await expect(
      page.getByRole('button', { name: 'Remove Vault Box from favorites' }).first(),
    ).toBeVisible()
    await page.keyboard.press('Control+Shift+H')
    dialog = page.getByRole('dialog', { name: 'Restore a backup' })
    await expect(dialog.locator('[data-backup]').first()).toContainText('master password')
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()

    // Export to a file (the save dialog is answered in main), then import it again.
    await app.evaluate(({ dialog: native }, file) => {
      native.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: file })
      native.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] })
    }, exportFile)
    await page.keyboard.press('Control+Shift+X')
    dialog = page.getByRole('dialog', { name: 'Export a backup file' })
    await dialog.getByLabel('Password for the file').fill('file-password-77')
    await dialog.getByLabel('Type it again').fill('file-password-77')
    await dialog.getByRole('button', { name: 'Choose where to save' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('[data-notice]')).toContainText('backup.kelidar')
    const exported = await readFile(exportFile, 'utf8')
    expect(exported).not.toContain('Vault Box')
    expect(exported).not.toContain(PASSWORD)

    await page.keyboard.press('Control+Shift+J')
    dialog = page.getByRole('dialog', { name: 'Import a backup file' })
    await dialog.getByRole('button', { name: 'Choose file…' }).first().click()
    await dialog.getByLabel('Password for the file').fill('file-password-77')
    await dialog.getByRole('button', { name: 'Import' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('[data-notice]')).toContainText('0 new, 0 updated, 1 already')

    expect(consoleErrors).toEqual([])
    expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain(PASSWORD)
    await app.close()

    // Restart: the lock screen comes first.
    ;({ app, page, consoleErrors } = await launch(userData, 'lock'))
    await expect(page.getByRole('navigation')).toBeHidden()
    await page.locator('[data-lock-screen]').getByLabel('Master password').fill(master)
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-host-item]', { hasText: 'Vault Box' }).first()).toBeVisible()
    expect(consoleErrors).toEqual([])
    await app.close()
  } finally {
    await closeAll()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

/**
 * Step 2.6 (Getting data in): the first-run offer finds an ssh config and a
 * PuTTY session and imports them; the imported key signs in and the host
 * gets its system badge; Smart Paste fills the host form; notes and links.
 */
test('Phase 2 data in: first-run import, system badge, Smart Paste, notes and links', async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'kelidar-e2e-p2d-'))
  const key = readableKeyPair('ed25519')
  const server = await startTestServer({
    authorizedKey: key.public,
    osRelease: 'ID=debian\nPRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\n',
  })
  try {
    const importHome = importDirOf(userData)
    await mkdir(path.join(importHome, '.ssh'), { recursive: true })
    await writeFile(path.join(importHome, '.ssh', 'lab_key'), key.private)
    await writeFile(
      path.join(importHome, '.ssh', 'config'),
      `Host lab\n  HostName 127.0.0.1\n  Port ${String(server.port)}\n  User tester\n  IdentityFile ~/.ssh/lab_key\n`,
    )
    await writeFile(
      path.join(importHome, 'putty.reg'),
      [
        'Windows Registry Editor Version 5.00',
        '',
        '[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Old%20Box]',
        '"HostName"="192.0.2.10"',
        '"UserName"="admin"',
        '"Protocol"="ssh"',
      ].join('\r\n'),
    )

    let { app, page, consoleErrors } = await launch(userData)

    // First run with an empty vault: the offer, then the preview.
    let dialog = page.getByRole('dialog', { name: 'Bring your servers with you' })
    await expect(dialog).toContainText('1 host in your ssh config file')
    await expect(dialog).toContainText('1 saved PuTTY session')
    await dialog.getByRole('button', { name: 'Review and import' }).click()
    dialog = page.getByRole('dialog', { name: 'Import hosts' })
    await expect(dialog.locator('[data-import-row="lab"]')).toContainText('Key lab_key')
    await expect(dialog.locator('[data-import-row="Old Box"]')).toContainText('admin@192.0.2.10')
    await dialog.getByRole('button', { name: 'Import 2 hosts' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('[data-notice]')).toContainText('Imported 2 hosts')

    // The imported key signs in; after the first connection the host shows its system.
    const lab = page.locator('[data-host-item]', { hasText: 'lab' }).first()
    await lab.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Trust and connect' }).click()
    await expect(page.locator('[data-tab-state="ready"]')).toHaveCount(1)
    await page.keyboard.press('Control+1')
    await expect(lab.locator('[data-os="debian"]')).toHaveAttribute(
      'title',
      'Debian GNU/Linux 12 (bookworm)',
    )

    // Smart Paste: the preview, then the host form filled in for checking.
    await page.keyboard.press('Control+Shift+B')
    dialog = page.getByRole('dialog', { name: 'Smart Paste' })
    await dialog
      .getByLabel('Text')
      .fill(
        'Your server is ready!\nIP: 203.0.113.44\nSSH port: 2200\nUsername: deploy\nPassword: Tr1cky-Pass',
      )
    // The preview masks the password it found.
    const preview = dialog.locator('dl')
    await expect(preview).toContainText('203.0.113.44')
    await expect(preview).not.toContainText('Tr1cky-Pass')
    await dialog.getByRole('button', { name: 'Fill the host form' }).click()
    const form = page.getByRole('dialog', { name: 'New host' })
    await expect(form.getByLabel('Address')).toHaveValue('203.0.113.44')
    await expect(form.getByLabel('User name')).toHaveValue('deploy')
    await expect(form.getByRole('textbox', { name: 'Password' })).toHaveValue('Tr1cky-Pass')
    await expect(form.getByLabel('Port')).toHaveValue('2200')
    await form.getByLabel('Name', { exact: true }).fill('Pasted')
    await form.getByLabel('Notes').fill('Backups run at 02:00.')
    await form.getByRole('button', { name: 'Add a link' }).click()
    await form.getByLabel('Title of link 1').fill('Panel')
    await form.getByLabel('Address of link 1').fill('file:///C:/Windows')
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(form).toContainText('Use a web address')
    await form.getByLabel('Address of link 1').fill('https://panel.example.test')
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(form).toBeHidden()

    const pasted = page.locator('[data-host-item]', { hasText: 'Pasted' }).first()
    await pasted.getByRole('button', { name: 'Notes and links of Pasted' }).click()
    dialog = page.getByRole('dialog', { name: 'Notes and links: Pasted' })
    await expect(dialog.locator('[data-host-notes]')).toHaveText('Backups run at 02:00.')
    await expect(dialog.getByRole('button', { name: 'Panel' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Close' }).click()

    // Search finds a host by its notes.
    await page.keyboard.press('Control+f')
    await page.keyboard.type('backups')
    await expect(page.locator('[data-host-item]:visible')).toHaveCount(1)

    expect(consoleErrors).toEqual([])
    await app.close()

    // The offer is made once.
    ;({ app, page, consoleErrors } = await launch(userData))
    await expect(page.locator('[data-host-item]', { hasText: 'Old Box' }).first()).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Bring your servers with you' })).toBeHidden()
    expect(consoleErrors).toEqual([])
    await app.close()
  } finally {
    await closeAll()
    await server.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
