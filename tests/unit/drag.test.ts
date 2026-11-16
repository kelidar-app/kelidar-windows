import { describe, expect, it } from 'vitest'
import { canDrop, type DragItem } from '../../src/renderer/features/hosts/drag-rules'
import type { GroupView } from '../../src/shared/groups'
import { MAX_GROUP_DEPTH } from '../../src/shared/records'

const NOW = '2026-11-16T10:00:00.000Z'
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const group = (n: number, parent?: number): GroupView => ({
  id: id(n),
  name: `g${String(n)}`,
  ...(parent === undefined ? {} : { parentId: id(parent) }),
  defaults: {},
  createdAt: NOW,
  updatedAt: NOW,
})

describe('drop targets', () => {
  // g1 > g2 > g3, and g4 on its own.
  const groups = [group(1), group(2, 1), group(3, 2), group(4)]
  const host = (groupId?: string): DragItem => ({ kind: 'host', id: id(9), name: 'h', groupId })
  const dragGroup = (n: number, parent?: number): DragItem => ({
    kind: 'group',
    id: id(n),
    name: `g${String(n)}`,
    parentId: parent === undefined ? undefined : id(parent),
  })

  it('lets a host go into any other group or out of its group', () => {
    expect(canDrop(host(id(1)), id(4), groups)).toBe(true)
    expect(canDrop(host(id(1)), undefined, groups)).toBe(true)
    expect(canDrop(host(id(1)), id(1), groups)).toBe(false)
    expect(canDrop(host(undefined), undefined, groups)).toBe(false)
  })

  it('never lets a group go into itself or one of its subgroups', () => {
    expect(canDrop(dragGroup(1), id(1), groups)).toBe(false)
    expect(canDrop(dragGroup(1), id(3), groups)).toBe(false)
    expect(canDrop(dragGroup(4), id(3), groups)).toBe(true)
    expect(canDrop(dragGroup(2, 1), undefined, groups)).toBe(true)
    // Already there: nothing to do.
    expect(canDrop(dragGroup(2, 1), id(1), groups)).toBe(false)
    expect(canDrop(dragGroup(4), undefined, groups)).toBe(false)
  })

  it(`refuses nesting deeper than ${String(MAX_GROUP_DEPTH)} levels`, () => {
    const chain = Array.from({ length: MAX_GROUP_DEPTH }, (_, i) =>
      group(i + 10, i === 0 ? undefined : i + 9),
    )
    const deepest = id(MAX_GROUP_DEPTH + 9)
    expect(canDrop(dragGroup(4), deepest, [...chain, group(4)])).toBe(false)
    expect(canDrop(null, deepest, chain)).toBe(false)
  })
})
