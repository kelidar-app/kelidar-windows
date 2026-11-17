import { groupPath } from '@shared/groups'
import type { GroupView } from '@shared/groups'
import type { HostView } from '@shared/hosts'
import { bestScore, foldText, queryTerms } from '@renderer/lib/fuzzy'

/** How many hosts the Recent section shows. */
export const RECENT_COUNT = 5

/**
 * Filters and ranks hosts. Every word of the query must match: a word that
 * starts with # matches tags that start with it; any other word is matched
 * fuzzily against the name, address, user name, tags and group names.
 */
export function searchHosts(
  hosts: readonly HostView[],
  groups: readonly GroupView[],
  query: string,
): HostView[] {
  const terms = queryTerms(query)
  if (terms.length === 0) return [...hosts]
  const tagTerms = terms
    .filter((term) => term.startsWith('#') && term.length > 1)
    .map((term) => foldText(term.slice(1)))
  const textTerms = terms.filter((term) => !term.startsWith('#'))

  const ranked: { host: HostView; score: number }[] = []
  for (const host of hosts) {
    const tags = host.tags.map(foldText)
    if (!tagTerms.every((term) => tags.some((tag) => tag.startsWith(term)))) continue
    const path = groupPath(host.groupId, groups).join(' ')
    const fields = [
      [host.name, 1],
      [host.address, 0.9],
      [host.username, 0.6],
      [path, 0.6],
      ...host.tags.map((tag) => [tag, 0.7] as const),
      [host.notes ?? '', 0.3],
    ] as const
    let score = tagTerms.length * 50
    let matched = true
    for (const term of textTerms) {
      const termScore = bestScore(term, fields)
      if (termScore === null) {
        matched = false
        break
      }
      score += termScore
    }
    if (matched) ranked.push({ host, score })
  }
  return ranked
    .sort((a, b) => b.score - a.score || compareNames(a.host.name, b.host.name))
    .map((item) => item.host)
}

export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
}

export function favoriteHosts(hosts: readonly HostView[]): HostView[] {
  return hosts.filter((host) => host.favorite).sort((a, b) => compareNames(a.name, b.name))
}

/** The hosts connected to most recently, newest first. */
export function recentHosts(hosts: readonly HostView[], count = RECENT_COUNT): HostView[] {
  return hosts
    .filter((host) => host.lastConnectedAt !== undefined)
    .sort((a, b) => (b.lastConnectedAt ?? '').localeCompare(a.lastConnectedAt ?? ''))
    .slice(0, count)
}

export interface GroupNode {
  group: GroupView
  groups: GroupNode[]
  hosts: HostView[]
  /** Hosts in this group and every group below it. */
  total: number
}

export interface HostTree {
  groups: GroupNode[]
  /** Hosts outside any group. */
  hosts: HostView[]
}

/**
 * Nests groups and hosts. A host or group whose group is missing sits at the
 * top level, so nothing ever disappears from the list.
 */
export function buildTree(hosts: readonly HostView[], groups: readonly GroupView[]): HostTree {
  const ids = new Set(groups.map((group) => group.id))
  const childGroups = new Map<string | undefined, GroupView[]>()
  for (const group of groups) {
    const parent =
      group.parentId !== undefined && ids.has(group.parentId) ? group.parentId : undefined
    childGroups.set(parent, [...(childGroups.get(parent) ?? []), group])
  }
  const hostsIn = new Map<string | undefined, HostView[]>()
  for (const host of hosts) {
    const groupId = host.groupId !== undefined && ids.has(host.groupId) ? host.groupId : undefined
    hostsIn.set(groupId, [...(hostsIn.get(groupId) ?? []), host])
  }

  const visited = new Set<string>()
  const build = (group: GroupView): GroupNode => {
    visited.add(group.id)
    const children = (childGroups.get(group.id) ?? [])
      .filter((child) => !visited.has(child.id))
      .sort((a, b) => compareNames(a.name, b.name))
      .map(build)
    const own = [...(hostsIn.get(group.id) ?? [])].sort((a, b) => compareNames(a.name, b.name))
    return {
      group,
      groups: children,
      hosts: own,
      total: own.length + children.reduce((sum, child) => sum + child.total, 0),
    }
  }

  const roots = [...(childGroups.get(undefined) ?? [])].sort((a, b) => compareNames(a.name, b.name))
  const tree: HostTree = {
    groups: roots.map(build),
    hosts: [...(hostsIn.get(undefined) ?? [])].sort((a, b) => compareNames(a.name, b.name)),
  }
  // Groups caught in a loop (never made by this app, but possible after a merge).
  for (const group of groups) if (!visited.has(group.id)) tree.groups.push(build(group))
  return tree
}

/** Groups in tree order with their depth, for a group picker. */
export function flattenGroups(groups: readonly GroupView[]): { group: GroupView; depth: number }[] {
  const out: { group: GroupView; depth: number }[] = []
  const walk = (nodes: GroupNode[], depth: number): void => {
    for (const node of nodes) {
      out.push({ group: node.group, depth })
      walk(node.groups, depth + 1)
    }
  }
  walk(buildTree([], groups).groups, 0)
  return out
}
