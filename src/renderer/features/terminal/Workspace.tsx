import { useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/cn'
import { tabTitle, useTabsStore, type TerminalTab } from '@renderer/stores/tabs'
import {
  dropPreview,
  dropSide,
  MAX_PANES,
  paneIds,
  paneRects,
  RESIZE_STEP,
  splitRects,
  type DropSide,
  type Rect,
  type SplitInfo,
} from './layout'
import { useTabDragStore } from './tab-drag'
import { TerminalPane } from './TerminalPane'

const percent = (value: number): string => `${String(value * 100)}%`

/** Places a box from the layout's 1×1 square (physical: the container is dir="ltr"). */
function placement(rect: Rect) {
  return {
    insetInlineStart: percent(rect.x),
    top: percent(rect.y),
    width: percent(rect.width),
    height: percent(rect.height),
  }
}

/**
 * Every pane of every tab, drawn as one flat list in a stable order and
 * placed by its own tab's layout. Only the active tab's panes show; the
 * others stay mounted so their scrollback survives. Splitting, closing, or
 * moving a pane into another tab never re-creates another pane's terminal.
 */
export function Workspace() {
  const { i18n } = useTranslation()
  const tabs = useTabsStore((state) => state.tabs)
  const panes = useTabsStore((state) => state.panes)
  const activeId = useTabsStore((state) => state.activeId)
  const containerRef = useRef<HTMLDivElement>(null)
  const active = tabs.find((tab) => tab.id === activeId)
  if (tabs.length === 0) return null

  // Where each pane sits: its tab, its place, and whether that tab is split.
  const placed = new Map<string, { tab: TerminalTab; rect: Rect; split: boolean }>()
  for (const tab of tabs) {
    const ids = paneIds(tab.layout)
    for (const [id, rect] of paneRects(tab.layout)) {
      placed.set(id, { tab, rect, split: ids.length > 1 })
    }
  }

  return (
    <section
      aria-label={active === undefined ? undefined : tabTitle(active, panes)}
      data-tab-view={active?.id}
      className={cn('min-h-0 flex-1', active === undefined ? 'hidden' : 'flex')}
    >
      <div ref={containerRef} dir="ltr" className="relative min-h-0 min-w-0 flex-1">
        {Object.keys(panes).map((id) => {
          const pane = panes[id]
          const where = placed.get(id)
          if (pane === undefined || where === undefined) return null
          const visible = where.tab.id === activeId
          return (
            <div
              key={id}
              dir={i18n.dir()}
              data-tab-id={where.tab.id}
              className={cn('absolute min-h-0 min-w-0', visible ? 'flex' : 'hidden')}
              style={placement(where.rect)}
            >
              <TerminalPane
                pane={pane}
                visible={visible}
                focused={where.tab.focusedPaneId === id}
                split={where.split}
              />
            </div>
          )
        })}
        {active !== undefined &&
          splitRects(active.layout).map((info) => (
            <Divider
              key={`${active.id}:${info.path.join('.')}`}
              tabId={active.id}
              info={info}
              container={containerRef}
            />
          ))}
        {active !== undefined && <TabDropTarget tab={active} />}
      </div>
    </section>
  )
}

/**
 * While a tab is dragged from the title bar over another tab: shows which
 * half of the pane under the pointer the dragged tab would take, and moves
 * it there on drop.
 */
function TabDropTarget({ tab }: { tab: TerminalTab }) {
  const { t } = useTranslation()
  const sourceTabId = useTabDragStore((state) => state.sourceTabId)
  const tabs = useTabsStore((state) => state.tabs)
  const panes = useTabsStore((state) => state.panes)
  const mergeTab = useTabsStore((state) => state.mergeTab)
  const [preview, setPreview] = useState<{ paneId: string; side: DropSide } | null>(null)
  const source = tabs.find((item) => item.id === sourceTabId)
  if (source === undefined || source.id === tab.id) return null

  const full = paneIds(source.layout).length + paneIds(tab.layout).length > MAX_PANES
  const rects = paneRects(tab.layout)
  const sourceTitle = tabTitle(source, panes)

  /** The pane under the pointer and the side of it nearest to the pointer. */
  const locate = (event: DragEvent<HTMLDivElement>): { paneId: string; side: DropSide } | null => {
    const box = event.currentTarget.getBoundingClientRect()
    const fx = (event.clientX - box.left) / box.width
    const fy = (event.clientY - box.top) / box.height
    for (const [paneId, rect] of rects) {
      if (fx < rect.x || fx > rect.x + rect.width || fy < rect.y || fy > rect.y + rect.height) {
        continue
      }
      const side = dropSide((fx - rect.x) / rect.width, (fy - rect.y) / rect.height)
      return { paneId, side }
    }
    return null
  }

  const previewRect =
    preview === null
      ? undefined
      : (() => {
          const rect = rects.get(preview.paneId)
          return rect === undefined ? undefined : dropPreview(rect, preview.side)
        })()

  return (
    <div
      data-tab-drop-target=""
      className="absolute inset-0 z-30"
      onDragOver={(event) => {
        if (full) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const next = locate(event)
        if (next?.paneId !== preview?.paneId || next?.side !== preview?.side) setPreview(next)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPreview(null)
      }}
      onDrop={(event) => {
        event.preventDefault()
        const target = locate(event)
        setPreview(null)
        useTabDragStore.getState().end()
        if (target !== null) mergeTab(source.id, target.paneId, target.side)
      }}
    >
      {full ? (
        <div
          role="status"
          className="absolute inset-0 flex items-center justify-center bg-destructive/10 text-sm font-medium text-destructive"
        >
          <span dir="auto" className="rounded-md bg-card px-3 py-2 shadow">
            {t('terminal.dropFull', { max: MAX_PANES })}
          </span>
        </div>
      ) : (
        previewRect !== undefined &&
        preview !== null && (
          <div
            data-drop-preview={preview.side}
            className="pointer-events-none absolute flex items-center justify-center border-2 border-primary bg-primary/20 transition-all"
            style={placement(previewRect)}
          >
            <span dir="auto" className="rounded-md bg-card px-3 py-1.5 text-sm font-medium shadow">
              {t('terminal.dropHere', { title: sourceTitle })}
            </span>
          </div>
        )
      )}
    </div>
  )
}

/** Drag, or focus and use the arrow keys, to resize the two parts of a split. */
function Divider({
  tabId,
  info,
  container,
}: {
  tabId: string
  info: SplitInfo
  container: React.RefObject<HTMLDivElement | null>
}) {
  const { t } = useTranslation()
  const setRatio = useTabsStore((state) => state.setSplitRatio)
  const { area, ratio, path } = info
  const beside = info.direction === 'beside'
  // A thin bar centered on the line where the two parts meet; its thickness comes from w-1 / h-1.
  const style = beside
    ? {
        insetInlineStart: percent(area.x + area.width * ratio),
        top: percent(area.y),
        height: percent(area.height),
      }
    : {
        insetInlineStart: percent(area.x),
        top: percent(area.y + area.height * ratio),
        width: percent(area.width),
      }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    const box = container.current?.getBoundingClientRect()
    if (box === undefined) return
    event.preventDefault()
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const move = (moveEvent: globalThis.PointerEvent): void => {
      const next = beside
        ? ((moveEvent.clientX - box.left) / box.width - area.x) / area.width
        : ((moveEvent.clientY - box.top) / box.height - area.y) / area.height
      setRatio(tabId, path, next)
    }
    const up = (): void => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const back = beside ? 'ArrowLeft' : 'ArrowUp'
    const forward = beside ? 'ArrowRight' : 'ArrowDown'
    if (event.key !== back && event.key !== forward) return
    event.preventDefault()
    setRatio(tabId, path, ratio + (event.key === forward ? RESIZE_STEP : -RESIZE_STEP))
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={beside ? 'vertical' : 'horizontal'}
      aria-valuemin={15}
      aria-valuemax={85}
      aria-valuenow={Math.round(ratio * 100)}
      aria-label={t('terminal.splitDivider')}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      style={style}
      className={cn(
        'absolute z-10 bg-border transition-colors hover:bg-primary focus-visible:bg-primary',
        beside ? '-ms-0.5 w-1 cursor-col-resize' : '-mt-0.5 h-1 cursor-row-resize',
      )}
    />
  )
}
