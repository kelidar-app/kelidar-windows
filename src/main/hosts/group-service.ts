import { randomUUID } from 'node:crypto'
import { checkParent, type GroupView, type ParsedGroupSaveRequest } from '@shared/groups'
import type { GroupRecord, Id } from '@shared/records'
import { AppError } from '../ipc/app-error'
import type { VaultService } from '../vault/service'
import type { VaultData } from '../vault/vault'
import { live } from './host-service'

export function toGroupView(group: GroupRecord, liveGroups: readonly GroupRecord[]): GroupView {
  const parentId = liveGroups.some((item) => item.id === group.parentId)
    ? group.parentId
    : undefined
  return {
    id: group.id,
    name: group.name,
    ...(parentId === undefined ? {} : { parentId }),
    ...(group.color === undefined ? {} : { color: group.color }),
    defaults: { ...group.defaults },
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  }
}

function liveGroups(data: VaultData): GroupRecord[] {
  return data.groups.filter(live)
}

/** Nested host groups. Groups hold no secrets, so views carry every field. */
export class GroupService {
  constructor(
    private readonly vaults: VaultService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<GroupView[]> {
    const groups = liveGroups((await this.vaults.get()).read())
    return groups
      .map((group) => toGroupView(group, groups))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }

  async save(request: ParsedGroupSaveRequest): Promise<GroupView> {
    const vault = await this.vaults.get()
    return vault.update((data) => {
      const groups = liveGroups(data)
      const current =
        request.id === undefined ? undefined : groups.find((group) => group.id === request.id)
      if (request.id !== undefined && current === undefined) throw new AppError('GROUP_NOT_FOUND')

      const identityId = request.defaults?.identityId
      if (
        identityId !== undefined &&
        !data.identities.some((item) => item.id === identityId && live(item))
      ) {
        throw new AppError('IDENTITY_NOT_FOUND')
      }
      const jumpHostId = request.defaults?.jumpHostId
      if (
        jumpHostId !== undefined &&
        !data.hosts.some((item) => item.id === jumpHostId && live(item))
      ) {
        throw new AppError('JUMP_HOST_NOT_FOUND')
      }
      const problem = checkParent(request.id, request.parentId, groups)
      if (problem === 'not-found') throw new AppError('GROUP_NOT_FOUND')
      if (problem === 'cycle') throw new AppError('GROUP_PARENT_INVALID')
      if (problem === 'too-deep') throw new AppError('GROUP_TOO_DEEP')

      const now = this.now().toISOString()
      const group: GroupRecord = current ?? {
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        name: request.name,
      }
      group.name = request.name
      group.updatedAt = now
      if (request.parentId === undefined) delete group.parentId
      else group.parentId = request.parentId
      if (request.color === undefined) delete group.color
      else group.color = request.color
      const defaults = {
        ...(request.defaults?.port === undefined ? {} : { port: request.defaults.port }),
        ...(request.defaults?.environment === undefined
          ? {}
          : { environment: request.defaults.environment }),
        ...(identityId === undefined ? {} : { identityId }),
        ...(jumpHostId === undefined ? {} : { jumpHostId }),
      }
      if (Object.keys(defaults).length === 0) delete group.defaults
      else group.defaults = defaults
      if (current === undefined) data.groups.push(group)
      return toGroupView(group, liveGroups(data))
    })
  }

  /**
   * Deletes one group. Its hosts and subgroups move up to its parent (or to
   * the top level), so deleting a group never deletes a host.
   */
  async delete(id: Id): Promise<void> {
    const vault = await this.vaults.get()
    await vault.update((data) => {
      const group = data.groups.find((item) => item.id === id && live(item))
      if (group === undefined) throw new AppError('GROUP_NOT_FOUND')
      const now = this.now().toISOString()
      for (const host of data.hosts) {
        if (host.groupId !== id || !live(host)) continue
        if (group.parentId === undefined) delete host.groupId
        else host.groupId = group.parentId
        host.updatedAt = now
      }
      for (const child of data.groups) {
        if (child.parentId !== id || !live(child)) continue
        if (group.parentId === undefined) delete child.parentId
        else child.parentId = group.parentId
        child.updatedAt = now
      }
      group.deletedAt = now
      group.updatedAt = now
    })
  }
}
