import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/cn'
import { tabTitle, useTabsStore, type TerminalTab } from '@renderer/stores/tabs'
import { paneIds, paneRects, RESIZE_STEP, splitRects, type Rect, type SplitInfo } from './layout'
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
 * A tab's panes. They are one flat list, each placed by the layout, so
 * splitting or closing a pane never re-creates another pane's terminal (its
 * scrollback stays). Hidden but mounted while another tab is shown.
 */
export function TabView({ tab, active }: { tab: TerminalTab; active: boolean }) {
  const { i18n } = useTranslation()
  const panes = useTabsStore((state) => state.panes)
  const containerRef = useRef<HTMLDivElement>(null)
  const rects = paneRects(tab.layout)
  const split = paneIds(tab.layout).length > 1
  return (
    <section
      hidden={!active}
      aria-label={tabTitle(tab, panes)}
      data-tab-view={tab.id}
      className={cn('min-h-0 flex-1', active ? 'flex' : 'hidden')}
    >
      <div ref={containerRef} dir="ltr" className="relative min-h-0 min-w-0 flex-1">
        {paneIds(tab.layout).map((id) => {
          const pane = panes[id]
          const rect = rects.get(id)
          if (pane === undefined || rect === undefined) return null
          return (
            <div
              key={id}
              dir={i18n.dir()}
              className="absolute flex min-h-0 min-w-0"
              style={placement(rect)}
            >
              <TerminalPane
                pane={pane}
                visible={active}
                focused={tab.focusedPaneId === id}
                split={split}
              />
            </div>
          )
        })}
        {splitRects(tab.layout).map((info) => (
          <Divider
            key={info.path.join('.') || 'root'}
            tabId={tab.id}
            info={info}
            container={containerRef}
          />
        ))}
      </div>
    </section>
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
