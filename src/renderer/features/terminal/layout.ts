// rtl-exempt-file: pane geometry is physical (left/right) in every language,
// as in any terminal; the split container is dir="ltr" for the same reason.

/**
 * The panes of a tab as a binary tree: a pane, or a split into two parts.
 * `beside` puts the second part to the right of the first, `below` under it. `ratio` is
 * the first part's share. Geometry is physical (left/right), as in any
 * terminal, also when the app is in Persian.
 */
export type Layout =
  | { kind: 'pane'; paneId: string }
  | { kind: 'split'; direction: SplitDirection; ratio: number; first: Layout; second: Layout }

export type SplitDirection = 'beside' | 'below'
export type FocusDirection = 'left' | 'right' | 'up' | 'down'
/** Named directions, so callers do not spell them out. */
export const FOCUS = { left: 'left', right: 'right', up: 'up', down: 'down' } as const
export type LayoutPath = readonly ('first' | 'second')[]

export const MIN_RATIO = 0.15
export const MAX_RATIO = 0.85
export const RESIZE_STEP = 0.05

export function clampRatio(ratio: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
}

export function paneLeaf(paneId: string): Layout {
  return { kind: 'pane', paneId }
}

/** Pane ids in reading order. */
export function paneIds(layout: Layout): string[] {
  return layout.kind === 'pane'
    ? [layout.paneId]
    : [...paneIds(layout.first), ...paneIds(layout.second)]
}

/** Replaces the pane with a split: the old pane first, the new one beside or below it. */
export function splitPane(
  layout: Layout,
  paneId: string,
  newPaneId: string,
  direction: SplitDirection,
): Layout {
  if (layout.kind === 'pane') {
    return layout.paneId === paneId
      ? { kind: 'split', direction, ratio: 0.5, first: layout, second: paneLeaf(newPaneId) }
      : layout
  }
  return {
    ...layout,
    first: splitPane(layout.first, paneId, newPaneId, direction),
    second: splitPane(layout.second, paneId, newPaneId, direction),
  }
}

/** Removes a pane; its sibling takes the split's place. Null when nothing is left. */
export function removePane(layout: Layout, paneId: string): Layout | null {
  if (layout.kind === 'pane') return layout.paneId === paneId ? null : layout
  const first = removePane(layout.first, paneId)
  const second = removePane(layout.second, paneId)
  if (first === null) return second
  if (second === null) return first
  return { ...layout, first, second }
}

export function setRatio(layout: Layout, path: LayoutPath, ratio: number): Layout {
  if (layout.kind === 'pane') return layout
  const [step, ...rest] = path
  if (step === undefined) return { ...layout, ratio: clampRatio(ratio) }
  return { ...layout, [step]: setRatio(layout[step], rest, ratio) }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Each pane's place in a 1×1 square. */
export function paneRects(layout: Layout, rect: Rect = { x: 0, y: 0, width: 1, height: 1 }) {
  const rects = new Map<string, Rect>()
  const walk = (node: Layout, area: Rect): void => {
    if (node.kind === 'pane') {
      rects.set(node.paneId, area)
      return
    }
    if (node.direction === 'beside') {
      const width = area.width * node.ratio
      walk(node.first, { ...area, width })
      walk(node.second, { ...area, x: area.x + width, width: area.width - width })
    } else {
      const height = area.height * node.ratio
      walk(node.first, { ...area, height })
      walk(node.second, { ...area, y: area.y + height, height: area.height - height })
    }
  }
  walk(layout, rect)
  return rects
}

const EPSILON = 1e-9

/** The pane next to `paneId` in a direction (the one that overlaps it most), if any. */
export function neighbour(
  layout: Layout,
  paneId: string,
  direction: FocusDirection,
): string | undefined {
  const rects = paneRects(layout)
  const from = rects.get(paneId)
  if (from === undefined) return undefined
  const overlap = (a0: number, a1: number, b0: number, b1: number): number =>
    Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
  let best: { id: string; distance: number; overlap: number } | undefined
  for (const [id, rect] of rects) {
    if (id === paneId) continue
    let distance: number
    let shared: number
    if (direction === 'left' || direction === 'right') {
      distance =
        direction === 'right' ? rect.x - (from.x + from.width) : from.x - (rect.x + rect.width)
      shared = overlap(from.y, from.y + from.height, rect.y, rect.y + rect.height)
    } else {
      distance =
        direction === 'down' ? rect.y - (from.y + from.height) : from.y - (rect.y + rect.height)
      shared = overlap(from.x, from.x + from.width, rect.x, rect.x + rect.width)
    }
    if (distance < -EPSILON || shared <= EPSILON) continue
    if (
      best === undefined ||
      distance < best.distance - EPSILON ||
      (Math.abs(distance - best.distance) <= EPSILON && shared > best.overlap)
    ) {
      best = { id, distance, overlap: shared }
    }
  }
  return best?.id
}

/**
 * Moves the nearest divider on the pane's side in a direction: right and
 * down move it right or down, left and up move it back.
 */
export function resizePane(
  layout: Layout,
  paneId: string,
  direction: FocusDirection,
  step = RESIZE_STEP,
): Layout {
  const axis: SplitDirection = direction === 'left' || direction === 'right' ? 'beside' : 'below'
  const delta = direction === 'right' || direction === 'down' ? step : -step
  // The innermost split along the axis that contains the pane.
  const path = (node: Layout, trail: LayoutPath): LayoutPath | null => {
    if (node.kind === 'pane') return null
    const inner = path(node.first, [...trail, 'first']) ?? path(node.second, [...trail, 'second'])
    if (inner !== null) return inner
    return node.direction === axis && paneIds(node).includes(paneId) ? trail : null
  }
  const found = path(layout, [])
  if (found === null) return layout
  let node: Layout = layout
  for (const step of found) if (node.kind === 'split') node = node[step]
  return node.kind === 'split' ? setRatio(layout, found, node.ratio + delta) : layout
}

/** A split's divider: where its two parts meet, and the area the split covers. */
export interface SplitInfo {
  path: LayoutPath
  direction: SplitDirection
  ratio: number
  area: Rect
}

/** Every split with its area in a 1×1 square, for drawing and dragging dividers. */
export function splitRects(layout: Layout): SplitInfo[] {
  const splits: SplitInfo[] = []
  const walk = (node: Layout, area: Rect, path: LayoutPath): void => {
    if (node.kind === 'pane') return
    splits.push({ path, direction: node.direction, ratio: node.ratio, area })
    if (node.direction === 'beside') {
      const width = area.width * node.ratio
      walk(node.first, { ...area, width }, [...path, 'first'])
      walk(node.second, { ...area, x: area.x + width, width: area.width - width }, [
        ...path,
        'second',
      ])
    } else {
      const height = area.height * node.ratio
      walk(node.first, { ...area, height }, [...path, 'first'])
      walk(node.second, { ...area, y: area.y + height, height: area.height - height }, [
        ...path,
        'second',
      ])
    }
  }
  walk(layout, { x: 0, y: 0, width: 1, height: 1 }, [])
  return splits
}
