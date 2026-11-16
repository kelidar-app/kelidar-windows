import { describe, expect, it } from 'vitest'
import { COMMAND_KEYS, comboAria, comboLabel, findByKey } from '../../src/renderer/app/key-combos'
import {
  buildTree,
  favoriteHosts,
  flattenGroups,
  recentHosts,
  searchHosts,
} from '../../src/renderer/features/hosts/host-search'
import { foldText, fuzzyScore, scoreKeywords } from '../../src/renderer/lib/fuzzy'
import type { GroupView } from '../../src/shared/groups'
import type { HostView } from '../../src/shared/hosts'

const NOW = '2026-11-16T10:00:00.000Z'
let next = 0
const uuid = (): string => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`

function host(fields: Partial<HostView> & { name: string }): HostView {
  return {
    id: uuid(),
    address: `${fields.name.toLowerCase().replace(/\s+/g, '-')}.example.com`,
    port: 22,
    username: 'root',
    tags: [],
    favorite: false,
    agentForward: false,
    signIn: { method: 'ask' },
    createdAt: NOW,
    updatedAt: NOW,
    ...fields,
  }
}

function group(fields: Partial<GroupView> & { name: string }): GroupView {
  return { id: uuid(), defaults: {}, createdAt: NOW, updatedAt: NOW, ...fields }
}

describe('fuzzyScore', () => {
  it('matches characters in order and refuses the rest', () => {
    expect(fuzzyScore('wbsrv', 'web-server')).not.toBeNull()
    expect(fuzzyScore('vrsw', 'web-server')).toBeNull()
    expect(fuzzyScore('', 'anything')).toBe(0)
    expect(fuzzyScore('longer than text', 'short')).toBeNull()
  })

  it('ranks prefixes over word starts over scattered matches', () => {
    const prefix = fuzzyScore('db', 'db-primary') ?? 0
    const wordStart = fuzzyScore('db', 'eu-db-1') ?? 0
    const inside = fuzzyScore('db', 'redbox') ?? 0
    const scattered = fuzzyScore('db', 'd-x-b') ?? 0
    expect(prefix).toBeGreaterThan(wordStart)
    expect(wordStart).toBeGreaterThan(inside)
    expect(inside).toBeGreaterThan(scattered)
  })

  it('ignores case and the Arabic forms of Persian letters', () => {
    expect(fuzzyScore('WEB', 'web')).not.toBeNull()
    expect(foldText('سرويس كار')).toBe('سرویس کار')
    expect(fuzzyScore('سرویس', 'سرويس اصلی')).not.toBeNull()
  })
})

describe('searchHosts', () => {
  const clients = group({ name: 'Clients' })
  const acme = group({ name: 'Acme', parentId: clients.id })
  const groups = [clients, acme]
  const web = host({ name: 'Web 1', tags: ['web', 'eu'], groupId: acme.id })
  const db = host({ name: 'Database', address: '10.0.0.5', tags: ['db', 'eu'] })
  const mail = host({ name: 'Mail', username: 'postmaster', tags: ['web'] })
  const hosts = [web, db, mail]
  const names = (query: string): string[] => searchHosts(hosts, groups, query).map((h) => h.name)

  it('returns every host for an empty query', () => {
    expect(names('  ')).toHaveLength(3)
  })

  it('matches name, address, user name and group names', () => {
    expect(names('datab')).toEqual(['Database'])
    expect(names('10.0.0')).toEqual(['Database'])
    expect(names('postm')).toEqual(['Mail'])
    expect(names('acme')).toEqual(['Web 1'])
    expect(names('clients')).toEqual(['Web 1'])
  })

  it('needs every word to match', () => {
    expect(names('web eu')).toEqual(['Web 1'])
    expect(names('web nothing-like-this')).toEqual([])
  })

  it('treats #words as tag filters (prefix, any case)', () => {
    expect(names('#eu')).toEqual(['Database', 'Web 1'])
    expect(names('#W')).toEqual(['Mail', 'Web 1'])
    expect(names('#web mail')).toEqual(['Mail'])
    expect(names('#nope')).toEqual([])
  })

  it('puts the best match first', () => {
    const extra = [...hosts, host({ name: 'Webmail' })]
    expect(searchHosts(extra, groups, 'web')[0]?.name).toBe('Web 1')
  })
})

describe('buildTree', () => {
  it('nests groups and hosts and counts hosts in subgroups', () => {
    const top = group({ name: 'Top' })
    const sub = group({ name: 'Sub', parentId: top.id })
    const other = group({ name: 'Another' })
    const tree = buildTree(
      [
        host({ name: 'b', groupId: sub.id }),
        host({ name: 'a', groupId: sub.id }),
        host({ name: 'loose' }),
        host({ name: 'in top', groupId: top.id }),
      ],
      [top, sub, other],
    )
    expect(tree.groups.map((n) => n.group.name)).toEqual(['Another', 'Top'])
    const topNode = tree.groups[1]
    expect(topNode?.total).toBe(3)
    expect(topNode?.hosts.map((h) => h.name)).toEqual(['in top'])
    expect(topNode?.groups[0]?.hosts.map((h) => h.name)).toEqual(['a', 'b'])
    expect(tree.hosts.map((h) => h.name)).toEqual(['loose'])
  })

  it('never loses a host or group whose parent is missing or in a loop', () => {
    const a = group({ name: 'A' })
    const b = group({ name: 'B', parentId: a.id })
    a.parentId = b.id
    const orphan = group({ name: 'Orphan', parentId: uuid() })
    const tree = buildTree([host({ name: 'lost', groupId: uuid() })], [a, b, orphan])
    expect(tree.hosts.map((h) => h.name)).toEqual(['lost'])
    const all = flattenGroups([a, b, orphan]).map((item) => item.group.name)
    expect(all.sort()).toEqual(['A', 'B', 'Orphan'])
  })

  it('flattens groups in tree order with depth', () => {
    const top = group({ name: 'Top' })
    const sub = group({ name: 'Sub', parentId: top.id })
    expect(flattenGroups([sub, top]).map((i) => [i.group.name, i.depth])).toEqual([
      ['Top', 0],
      ['Sub', 1],
    ])
  })
})

describe('favorites and recent', () => {
  it('lists favorites by name and recent hosts newest first', () => {
    const hosts = [
      host({ name: 'zeta', favorite: true, lastConnectedAt: '2026-11-15T00:00:00.000Z' }),
      host({ name: 'alpha', favorite: true }),
      host({ name: 'mid', lastConnectedAt: '2026-11-16T00:00:00.000Z' }),
    ]
    expect(favoriteHosts(hosts).map((h) => h.name)).toEqual(['alpha', 'zeta'])
    expect(recentHosts(hosts).map((h) => h.name)).toEqual(['mid', 'zeta'])
    expect(recentHosts(hosts, 1).map((h) => h.name)).toEqual(['mid'])
  })
})

describe('command palette ranking', () => {
  it('scores between 0 and 1 and hides items that do not match', () => {
    const score = scoreKeywords('new ho', ['New host', 'newHost'])
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
    expect(scoreKeywords('xyz', ['New host'])).toBe(0)
    expect(scoreKeywords('new host', ['New host'])).toBeGreaterThan(
      scoreKeywords('new host', ['Never mind the host']),
    )
  })
})

describe('keyboard shortcuts', () => {
  const press = (code: string, options: { shift?: boolean; alt?: boolean } = {}) => ({
    code,
    ctrlKey: true,
    shiftKey: options.shift === true,
    altKey: options.alt === true,
    metaKey: false,
  })
  const items = Object.entries(COMMAND_KEYS).map(([id, combos]) => ({
    id,
    combos,
    available: () => true,
  }))
  const idFor = (event: ReturnType<typeof press>, inTerminal = false) =>
    findByKey(event, inTerminal, items)?.id ?? null

  it('gives no two commands the same key', () => {
    const seen = new Map<string, string>()
    for (const [id, combos] of Object.entries(COMMAND_KEYS)) {
      for (const combo of combos) {
        const key = comboLabel(combo)
        expect(seen.get(key), `${key} is used by ${seen.get(key) ?? ''} and ${id}`).toBeUndefined()
        seen.set(key, id)
      }
    }
  })

  it('matches by physical key, so Persian keyboard layouts work', () => {
    expect(idFor(press('KeyK'))).toBe('palette')
    expect(idFor(press('KeyP', { shift: true }))).toBe('palette')
    expect(idFor(press('KeyN', { shift: true }))).toBe('newGroup')
    expect(idFor(press('Tab', { shift: true }))).toBe('previousTab')
    expect(idFor(press('KeyK', { alt: true }))).toBeNull()
    expect(idFor({ ...press('KeyK'), ctrlKey: false })).toBeNull()
  })

  it('leaves Ctrl+K, Ctrl+N, Ctrl+F and Ctrl+/ to the shell inside a terminal', () => {
    for (const code of ['KeyK', 'KeyN', 'KeyF', 'Slash'])
      expect(idFor(press(code), true)).toBeNull()
    expect(idFor(press('KeyP', { shift: true }), true)).toBe('palette')
    expect(idFor(press('Slash', { shift: true }), true)).toBe('shortcuts')
    expect(idFor(press('KeyT'), true)).toBe('newTab')
  })

  it('skips commands that are not available', () => {
    const closed = [{ id: 'closeTab', combos: COMMAND_KEYS.closeTab, available: () => false }]
    expect(findByKey(press('KeyW'), false, closed)).toBeNull()
  })

  it('labels shortcuts for people and for screen readers', () => {
    expect(comboLabel({ code: 'KeyK' })).toBe('Ctrl+K')
    expect(comboLabel({ code: 'Slash', shift: true })).toBe('Ctrl+Shift+/')
    expect(comboAria({ code: 'Digit1' })).toBe('Control+1')
    expect(comboAria({ code: 'Comma' })).toBe('Control+,')
  })
})
