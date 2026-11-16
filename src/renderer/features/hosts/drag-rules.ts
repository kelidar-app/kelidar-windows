import { checkParent, type GroupView } from '@shared/groups'

/** What is being dragged in the host list. */
export type DragItem =
  | { kind: 'host'; id: string; name: string; groupId: string | undefined }
  | { kind: 'group'; id: string; name: string; parentId: string | undefined }

/** The drag data type; the item itself is kept in the store (dragover cannot read data). */
export const DRAG_TYPE = 'application/x-kelidar-item'

/**
 * Where an item may be dropped: `undefined` is the top level (no group).
 * A host may go into any other group; a group may not go into itself or one
 * of its subgroups, nor nest deeper than the limit.
 */
export function canDrop(
  item: DragItem | null,
  target: string | undefined,
  groups: readonly GroupView[],
): boolean {
  if (item === null) return false
  if (item.kind === 'host') return item.groupId !== target
  if (item.parentId === target) return false
  return checkParent(item.id, target, groups) === null
}
