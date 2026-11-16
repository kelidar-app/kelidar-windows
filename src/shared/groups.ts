import { z } from 'zod'
import {
  colorSchema,
  DEFAULT_SSH_PORT,
  environmentSchema,
  groupDefaultsSchema,
  idSchema,
  MAX_GROUP_DEPTH,
  portSchema,
  timestampSchema,
  type Environment,
  type GroupDefaults,
  type Id,
} from './records'

/** What the renderer knows about a group. Groups hold no secrets. */
export const groupViewSchema = z.object({
  id: idSchema,
  name: z.string(),
  parentId: idSchema.optional(),
  color: colorSchema.optional(),
  defaults: groupDefaultsSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})
export type GroupView = z.infer<typeof groupViewSchema>

/** groups:save. `id` present = edit. Fields left out are cleared. */
export const groupSaveRequestSchema = z.strictObject({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(200),
  parentId: idSchema.optional(),
  color: colorSchema.optional(),
  defaults: z
    .strictObject({
      port: portSchema.optional(),
      environment: environmentSchema.optional(),
      identityId: idSchema.optional(),
      jumpHostId: idSchema.optional(),
    })
    .optional(),
})
export type GroupSaveRequest = z.input<typeof groupSaveRequestSchema>
export type ParsedGroupSaveRequest = z.output<typeof groupSaveRequestSchema>

/** The part of a group the helpers below need. */
export interface GroupLike {
  id: Id
  name: string
  parentId?: Id | undefined
  defaults?: GroupDefaults | undefined
}

/**
 * The group and its ancestors, nearest first. Stops at a missing parent, a
 * loop (data from a future merge could hold one) or MAX_GROUP_DEPTH.
 */
export function groupChain<G extends GroupLike>(
  groupId: Id | undefined,
  groups: readonly G[],
): G[] {
  const byId = new Map(groups.map((group) => [group.id, group]))
  const chain: G[] = []
  const seen = new Set<Id>()
  let current = groupId === undefined ? undefined : byId.get(groupId)
  while (current !== undefined && !seen.has(current.id) && chain.length < MAX_GROUP_DEPTH) {
    chain.push(current)
    seen.add(current.id)
    current = current.parentId === undefined ? undefined : byId.get(current.parentId)
  }
  return chain
}

/** Group names from the top down, like ["Clients", "Acme"]. */
export function groupPath(groupId: Id | undefined, groups: readonly GroupLike[]): string[] {
  return groupChain(groupId, groups)
    .map((group) => group.name)
    .reverse()
}

/** Where an effective value comes from. */
export type ValueSource = { from: 'host' } | { from: 'group'; groupId: Id } | { from: 'default' }

export interface Inherited<T> {
  value: T
  source: ValueSource
}

/** What a group passes down to a host placed in it (the nearest group that sets each value wins). */
export function groupDefaultsFor(
  groupId: Id | undefined,
  groups: readonly GroupLike[],
): {
  port: Inherited<number>
  environment: Inherited<Environment | undefined>
  identityId: Inherited<Id | undefined>
  jumpHostId: Inherited<Id | undefined>
} {
  let identityId: Inherited<Id | undefined> = { value: undefined, source: { from: 'default' } }
  let identityFound = false
  let jumpHostId: Inherited<Id | undefined> = { value: undefined, source: { from: 'default' } }
  let jumpFound = false
  let port: Inherited<number> = { value: DEFAULT_SSH_PORT, source: { from: 'default' } }
  let environment: Inherited<Environment | undefined> = {
    value: undefined,
    source: { from: 'default' },
  }
  let portFound = false
  let environmentFound = false
  for (const group of groupChain(groupId, groups)) {
    const defaults = group.defaults
    if (!portFound && defaults?.port !== undefined) {
      port = { value: defaults.port, source: { from: 'group', groupId: group.id } }
      portFound = true
    }
    if (!environmentFound && defaults?.environment !== undefined) {
      environment = { value: defaults.environment, source: { from: 'group', groupId: group.id } }
      environmentFound = true
    }
    if (!identityFound && defaults?.identityId !== undefined) {
      identityId = { value: defaults.identityId, source: { from: 'group', groupId: group.id } }
      identityFound = true
    }
    if (!jumpFound && defaults?.jumpHostId !== undefined) {
      jumpHostId = { value: defaults.jumpHostId, source: { from: 'group', groupId: group.id } }
      jumpFound = true
    }
  }
  return { port, environment, identityId, jumpHostId }
}

/** A host's own value wins over its groups, and the groups over the built-in default. */
export function resolveHostSettings(
  host: {
    port?: number | undefined
    environment?: Environment | undefined
    groupId?: Id | undefined
  },
  groups: readonly GroupLike[],
): { port: Inherited<number>; environment: Inherited<Environment | undefined> } {
  const inherited = groupDefaultsFor(host.groupId, groups)
  return {
    port: host.port === undefined ? inherited.port : { value: host.port, source: { from: 'host' } },
    environment:
      host.environment === undefined
        ? inherited.environment
        : { value: host.environment, source: { from: 'host' } },
  }
}

/** The group and every group below it. */
export function subtreeIds(groupId: Id, groups: readonly GroupLike[]): Set<Id> {
  const ids = new Set<Id>([groupId])
  let grew = true
  while (grew) {
    grew = false
    for (const group of groups) {
      if (group.parentId !== undefined && ids.has(group.parentId) && !ids.has(group.id)) {
        ids.add(group.id)
        grew = true
      }
    }
  }
  return ids
}

/** How many levels the subtree under (and including) the group has. */
export function subtreeHeight(groupId: Id, groups: readonly GroupLike[]): number {
  const children = groups.filter((group) => group.parentId === groupId && group.id !== groupId)
  let height = 1
  const visited = new Set<Id>([groupId])
  const walk = (ids: GroupLike[], depth: number): void => {
    for (const child of ids) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      height = Math.max(height, depth)
      walk(
        groups.filter((group) => group.parentId === child.id),
        depth + 1,
      )
    }
  }
  walk(children, 2)
  return height
}

export type ParentProblem = 'not-found' | 'cycle' | 'too-deep'

/**
 * Checks that `groupId` (undefined for a new group) may sit under `parentId`:
 * the parent exists, is not the group or one of its subgroups, and the
 * result is at most MAX_GROUP_DEPTH levels deep.
 */
export function checkParent(
  groupId: Id | undefined,
  parentId: Id | undefined,
  groups: readonly GroupLike[],
): ParentProblem | null {
  if (parentId === undefined) {
    return groupId !== undefined && subtreeHeight(groupId, groups) > MAX_GROUP_DEPTH
      ? 'too-deep'
      : null
  }
  if (!groups.some((group) => group.id === parentId)) return 'not-found'
  if (groupId !== undefined && subtreeIds(groupId, groups).has(parentId)) return 'cycle'
  const parentDepth = groupChain(parentId, groups).length
  const height = groupId === undefined ? 1 : subtreeHeight(groupId, groups)
  return parentDepth + height > MAX_GROUP_DEPTH ? 'too-deep' : null
}
