import { create } from 'zustand'
import type { ErrorCode } from '@shared/errors'
import type { GroupView } from '@shared/groups'
import type { HostView } from '@shared/hosts'
import { api } from '@renderer/lib/api'
import { useHostsStore } from '@renderer/stores/hosts'
import { canDrop, type DragItem } from './drag-rules'

export { canDrop, DRAG_TYPE, type DragItem } from './drag-rules'

interface DragState {
  item: DragItem | null
  /** The last move's error, shown above the list. */
  error: ErrorCode | null
  start: (item: DragItem) => void
  end: () => void
  clearError: () => void
  /** Moves the dragged item into `target` (undefined: top level). */
  drop: (target: string | undefined) => Promise<void>
}

export const useDragStore = create<DragState>()((set, get) => ({
  item: null,
  error: null,
  start: (item) => {
    set({ item, error: null })
  },
  end: () => {
    set({ item: null })
  },
  clearError: () => {
    set({ error: null })
  },
  drop: async (target) => {
    const item = get().item
    set({ item: null })
    if (item === null || !canDrop(item, target, useHostsStore.getState().groups)) return
    const result =
      item.kind === 'host'
        ? await api.invoke('hosts:move', {
            id: item.id,
            ...(target === undefined ? {} : { groupId: target }),
          })
        : await api.invoke('groups:move', {
            id: item.id,
            ...(target === undefined ? {} : { parentId: target }),
          })
    if (!result.ok) set({ error: result.error.code })
    await useHostsStore.getState().load()
  },
}))

export function hostDragItem(host: HostView): DragItem {
  return { kind: 'host', id: host.id, name: host.name, groupId: host.groupId }
}

export function groupDragItem(group: GroupView): DragItem {
  return { kind: 'group', id: group.id, name: group.name, parentId: group.parentId }
}
