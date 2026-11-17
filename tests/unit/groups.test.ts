import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GroupService } from '../../src/main/hosts/group-service'
import { HostService } from '../../src/main/hosts/host-service'
import { KeyFileImports } from '../../src/main/hosts/key-files'
import { seal } from '../../src/main/vault/crypto'
import { migrateVaultData } from '../../src/main/vault/migrations'
import { VaultService } from '../../src/main/vault/service'
import { Vault, VAULT_FILE_NAME } from '../../src/main/vault/vault'
import {
  checkParent,
  groupChain,
  groupPath,
  groupSaveRequestSchema,
  resolveHostSettings,
  type GroupLike,
  type GroupSaveRequest,
} from '../../src/shared/groups'
import {
  hostSaveRequestSchema,
  splitTags,
  tagListSchema,
  type HostSaveRequest,
} from '../../src/shared/hosts'
import { ipcContract } from '../../src/shared/ipc'
import { MAX_GROUP_DEPTH } from '../../src/shared/records'
import { fakeWrapper } from './helpers/fake-wrapper'

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('group helpers', () => {
  const groups: GroupLike[] = [
    { id: id(1), name: 'Clients', defaults: { port: 2200, environment: 'production' } },
    { id: id(2), name: 'Acme', parentId: id(1), defaults: { port: 2222 } },
    { id: id(3), name: 'Staging', parentId: id(2), defaults: { environment: 'staging' } },
    { id: id(4), name: 'Loose' },
  ]

  it('walks up the chain, nearest first', () => {
    expect(groupChain(id(3), groups).map((g) => g.name)).toEqual(['Staging', 'Acme', 'Clients'])
    expect(groupPath(id(3), groups)).toEqual(['Clients', 'Acme', 'Staging'])
    expect(groupChain(undefined, groups)).toEqual([])
    expect(groupChain(id(99), groups)).toEqual([])
  })

  it('stops at a loop instead of hanging', () => {
    const loop: GroupLike[] = [
      { id: id(1), name: 'A', parentId: id(2) },
      { id: id(2), name: 'B', parentId: id(1) },
    ]
    expect(groupChain(id(1), loop).map((g) => g.name)).toEqual(['A', 'B'])
  })

  it('takes each value from the nearest group that sets it', () => {
    const inStaging = resolveHostSettings({ groupId: id(3) }, groups)
    expect(inStaging.port).toEqual({ value: 2222, source: { from: 'group', groupId: id(2) } })
    expect(inStaging.environment).toEqual({
      value: 'staging',
      source: { from: 'group', groupId: id(3) },
    })
    const inAcme = resolveHostSettings({ groupId: id(2) }, groups)
    expect(inAcme.environment.value).toBe('production')
  })

  it("lets the host's own values win, and falls back to port 22", () => {
    const own = resolveHostSettings(
      { groupId: id(3), port: 2022, environment: 'development' },
      groups,
    )
    expect(own.port).toEqual({ value: 2022, source: { from: 'host' } })
    expect(own.environment).toEqual({ value: 'development', source: { from: 'host' } })
    const none = resolveHostSettings({ groupId: id(4) }, groups)
    expect(none.port).toEqual({ value: 22, source: { from: 'default' } })
    expect(none.environment.value).toBeUndefined()
  })

  it('refuses a parent that is missing, the group itself or one of its subgroups', () => {
    expect(checkParent(undefined, id(3), groups)).toBeNull()
    expect(checkParent(id(4), id(3), groups)).toBeNull()
    expect(checkParent(id(4), id(99), groups)).toBe('not-found')
    expect(checkParent(id(1), id(1), groups)).toBe('cycle')
    expect(checkParent(id(1), id(3), groups)).toBe('cycle')
    expect(checkParent(id(2), undefined, groups)).toBeNull()
  })

  it(`limits nesting to ${String(MAX_GROUP_DEPTH)} levels`, () => {
    const deep: GroupLike[] = Array.from({ length: MAX_GROUP_DEPTH }, (_, i) => ({
      id: id(i + 1),
      name: `L${String(i + 1)}`,
      ...(i === 0 ? {} : { parentId: id(i) }),
    }))
    // A new group under the deepest one would be level 9.
    expect(checkParent(undefined, id(MAX_GROUP_DEPTH), deep)).toBe('too-deep')
    expect(checkParent(undefined, id(MAX_GROUP_DEPTH - 1), deep)).toBeNull()
    // Moving a two-level subtree under level 7 would reach level 9.
    const extra: GroupLike[] = [
      ...deep,
      { id: id(50), name: 'X' },
      { id: id(51), name: 'Y', parentId: id(50) },
    ]
    expect(checkParent(id(50), id(7), extra)).toBe('too-deep')
    expect(checkParent(id(50), id(6), extra)).toBeNull()
  })
})

describe('schemas', () => {
  it('groups:save accepts a valid request and refuses unknown or bad fields', () => {
    const valid: GroupSaveRequest = {
      name: ' Web ',
      parentId: id(1),
      color: 'blue',
      defaults: { port: 2222, environment: 'staging' },
    }
    expect(groupSaveRequestSchema.parse(valid).name).toBe('Web')
    for (const bad of [
      { ...valid, name: '  ' },
      { ...valid, parentId: 'nope' },
      { ...valid, color: '#ff0000' },
      { ...valid, defaults: { port: 0 } },
      { ...valid, defaults: { environment: 'prod' } },
      { ...valid, defaults: { identityId: 'not-a-uuid' } },
      { ...valid, extra: true },
    ]) {
      expect(groupSaveRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it('cleans tags: trims, drops #, removes duplicates ignoring case', () => {
    expect(tagListSchema.parse([' web ', '#db', 'WEB', '', 'eu'])).toEqual(['web', 'db', 'eu'])
    expect(splitTags('web, db  eu،fa')).toEqual(['web', 'db', 'eu', 'fa'])
    expect(tagListSchema.safeParse(['two words']).success).toBe(false)
    expect(tagListSchema.safeParse(['a#b']).success).toBe(false)
    expect(tagListSchema.safeParse(['x'.repeat(51)]).success).toBe(false)
    expect(
      tagListSchema.safeParse(Array.from({ length: 31 }, (_, i) => `t${String(i)}`)).success,
    ).toBe(false)
  })

  it('hosts:setFavorite and groups:delete take only what they need', () => {
    const favorite = ipcContract['hosts:setFavorite'].request
    expect(favorite.safeParse({ id: id(1), favorite: true }).success).toBe(true)
    expect(favorite.safeParse({ id: id(1), favorite: 'yes' }).success).toBe(false)
    expect(favorite.safeParse({ id: id(1), favorite: true, name: 'x' }).success).toBe(false)
    const remove = ipcContract['groups:delete'].request
    expect(remove.safeParse({ id: id(1) }).success).toBe(true)
    expect(remove.safeParse({ id: '../x' }).success).toBe(false)
  })
})

describe('GroupService and HostService together', () => {
  let dir: string
  let vaults: VaultService
  let hosts: HostService
  let groups: GroupService

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'kelidar-groups-'))
    vaults = new VaultService({ directory: dir, wrapper: fakeWrapper() })
    hosts = new HostService(vaults, new KeyFileImports())
    groups = new GroupService(vaults)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const saveGroup = (request: GroupSaveRequest) =>
    groups.save(groupSaveRequestSchema.parse(request))
  const saveHost = (request: Partial<HostSaveRequest> = {}) =>
    hosts.save(
      hostSaveRequestSchema.parse({
        name: 'web',
        address: 'web.example.com',
        username: 'deploy',
        auth: { type: 'password', password: 'pw' },
        ...request,
      }),
    )

  it('nests groups and lists them by name', async () => {
    const clients = await saveGroup({ name: 'Clients', color: 'violet' })
    const acme = await saveGroup({ name: 'acme', parentId: clients.id, defaults: { port: 2222 } })
    expect(acme).toMatchObject({ name: 'acme', parentId: clients.id, defaults: { port: 2222 } })
    expect((await groups.list()).map((g) => g.name)).toEqual(['acme', 'Clients'])
    const record = (await vaults.get()).read().groups.find((g) => g.id === acme.id)
    expect(typeof record?.createdAt).toBe('string')
    expect(record?.updatedAt).toBe(record?.createdAt)
  })

  it('edits a group and clears fields left out', async () => {
    const group = await saveGroup({ name: 'A', color: 'red', defaults: { port: 2200 } })
    const edited = await saveGroup({ id: group.id, name: 'B' })
    expect(edited).toEqual({ ...edited, name: 'B', defaults: {} })
    expect(edited.color).toBeUndefined()
  })

  it('refuses a loop, a missing parent and a missing group with typed codes', async () => {
    const a = await saveGroup({ name: 'A' })
    const b = await saveGroup({ name: 'B', parentId: a.id })
    await expect(saveGroup({ id: a.id, name: 'A', parentId: b.id })).rejects.toMatchObject({
      code: 'GROUP_PARENT_INVALID',
    })
    await expect(saveGroup({ name: 'C', parentId: id(77) })).rejects.toMatchObject({
      code: 'GROUP_NOT_FOUND',
    })
    await expect(saveGroup({ id: id(78), name: 'D' })).rejects.toMatchObject({
      code: 'GROUP_NOT_FOUND',
    })
    await expect(groups.delete(id(78))).rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' })
  })

  it('refuses to nest deeper than the limit', async () => {
    let parentId: string | undefined
    for (let level = 1; level <= MAX_GROUP_DEPTH; level++) {
      parentId = (await saveGroup({ name: `L${String(level)}`, ...(parentId ? { parentId } : {}) }))
        .id
    }
    await expect(saveGroup({ name: 'too deep', parentId })).rejects.toMatchObject({
      code: 'GROUP_TOO_DEEP',
    })
  })

  it('hosts inherit port and environment from their groups, for display and for connecting', async () => {
    const top = await saveGroup({
      name: 'Prod',
      defaults: { environment: 'production', port: 2200 },
    })
    const sub = await saveGroup({ name: 'EU', parentId: top.id, defaults: { port: 2222 } })
    const host = await saveHost({ groupId: sub.id })
    expect(host).toMatchObject({ port: 2222, environment: 'production', groupId: sub.id })
    expect(host.ownPort).toBeUndefined()
    expect(host.ownEnvironment).toBeUndefined()
    expect((await hosts.connectTarget(host.id)).port).toBe(2222)

    const own = await saveHost({ id: host.id, groupId: sub.id, port: 22, environment: 'staging' })
    expect(own).toMatchObject({
      port: 22,
      ownPort: 22,
      environment: 'staging',
      ownEnvironment: 'staging',
    })
    expect((await hosts.connectTarget(host.id)).port).toBe(22)
  })

  it('saves tags and color, and keeps favorite across edits', async () => {
    const host = await saveHost({ tags: ['web', '#EU', 'web'], color: 'teal' })
    expect(host).toMatchObject({ tags: ['web', 'EU'], color: 'teal', favorite: false })
    expect((await hosts.setFavorite(host.id, true)).favorite).toBe(true)
    const edited = await saveHost({ id: host.id, name: 'renamed', auth: { type: 'password' } })
    expect(edited).toMatchObject({ name: 'renamed', favorite: true, tags: [] })
    expect(edited.color).toBeUndefined()
    expect((await hosts.setFavorite(host.id, false)).favorite).toBe(false)
    await expect(hosts.setFavorite(id(5), true)).rejects.toMatchObject({ code: 'HOST_NOT_FOUND' })
  })

  it('refuses a host in a group that does not exist', async () => {
    await expect(saveHost({ groupId: id(9) })).rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' })
  })

  it('records the last connection without changing updatedAt', async () => {
    const host = await saveHost()
    await hosts.markConnected(host.id)
    const [listed] = await hosts.list()
    expect(listed?.lastConnectedAt).toEqual(expect.any(String))
    expect(listed?.updatedAt).toBe(host.updatedAt)
    await expect(hosts.markConnected(id(6))).resolves.toBeUndefined()
  })

  it('deleting a group moves its hosts and subgroups up and deletes no host', async () => {
    const top = await saveGroup({ name: 'Top' })
    const middle = await saveGroup({ name: 'Middle', parentId: top.id, defaults: { port: 2222 } })
    const bottom = await saveGroup({ name: 'Bottom', parentId: middle.id })
    const inMiddle = await saveHost({ name: 'in middle', groupId: middle.id })
    await saveHost({ name: 'in bottom', groupId: bottom.id })

    await groups.delete(middle.id)

    const listed = await hosts.list()
    expect(listed).toHaveLength(2)
    expect(listed.find((h) => h.id === inMiddle.id)).toMatchObject({ groupId: top.id, port: 22 })
    expect((await groups.list()).find((g) => g.id === bottom.id)?.parentId).toBe(top.id)
    // The deleted group stays as a tombstone for merging later.
    const tombstone = (await vaults.get()).read().groups.find((g) => g.id === middle.id)
    expect(tombstone?.deletedAt).toEqual(expect.any(String))

    await groups.delete(top.id)
    const after = await hosts.list()
    expect(after.find((h) => h.id === inMiddle.id)?.groupId).toBeUndefined()
    expect(after.find((h) => h.name === 'in bottom')?.groupId).toBe(bottom.id)
    expect((await groups.list()).map((g) => g.name)).toEqual(['Bottom'])
    expect((await groups.list())[0]?.parentId).toBeUndefined()
  })
})

describe('vault data migration', () => {
  it('turns version 1 data into the current version with empty group and identity lists', () => {
    const v1 = { version: 1, hosts: [], secrets: [], keys: [], knownHosts: [] }
    expect(migrateVaultData(v1)).toEqual({
      status: 'ok',
      data: { ...v1, version: 4, groups: [], identities: [] },
    })
    expect(migrateVaultData({ version: 5 })).toEqual({ status: 'future' })
    expect(migrateVaultData({ version: 'x' })).toEqual({ status: 'invalid' })
    expect(migrateVaultData([])).toEqual({ status: 'invalid' })
  })

  it('opens a vault written by version 0.1 and saves it in the new shape', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'kelidar-migrate-'))
    try {
      // Write a vault the way 0.1 did: data version 1, no groups.
      const wrapper = fakeWrapper()
      const key = Buffer.alloc(32, 7)
      const header = {
        format: 'vault',
        version: 1,
        keyWrap: { type: 'safeStorage' as const, wrappedKey: await wrapper.wrap(key) },
        cipher: 'aes-256-gcm',
      }
      const aad = Buffer.from(
        JSON.stringify([
          header.format,
          header.version,
          header.keyWrap.type,
          header.keyWrap.wrappedKey,
          header.cipher,
        ]),
      )
      const now = new Date().toISOString()
      const v1 = {
        version: 1,
        hosts: [
          {
            id: id(1),
            createdAt: now,
            updatedAt: now,
            name: 'old',
            address: 'old.example.com',
            tags: [],
          },
        ],
        secrets: [],
        keys: [],
        knownHosts: [],
      }
      const box = seal(key, Buffer.from(JSON.stringify(v1)), aad)
      await writeFile(
        path.join(dir, VAULT_FILE_NAME),
        JSON.stringify({
          ...header,
          nonce: box.nonce.toString('base64'),
          tag: box.tag.toString('base64'),
          data: box.ciphertext.toString('base64'),
        }),
      )

      const vault = await Vault.open({ directory: dir, wrapper })
      expect(vault.read()).toMatchObject({
        version: 4,
        groups: [],
        identities: [],
        hosts: [{ name: 'old' }],
      })
      await vault.update((data) => {
        data.groups.push({ id: id(2), createdAt: now, updatedAt: now, name: 'new group' })
      })
      const reopened = await Vault.open({ directory: dir, wrapper })
      expect(reopened.read().groups.map((g) => g.name)).toEqual(['new group'])
      expect(await readFile(path.join(dir, VAULT_FILE_NAME), 'utf8')).not.toContain('new group')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
