import { House, KeyRound, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@renderer/stores/ui'
import { SHORTCUTS } from './shortcuts'

/**
 * Custom title bar: app mark, tab strip and a new-tab button. The empty
 * parts drag the window; Windows draws minimize, maximize and close.
 */
export function TitleBar() {
  const { t } = useTranslation()
  const focusQuickConnect = useUiStore((state) => state.focusQuickConnect)
  const showSection = useUiStore((state) => state.showSection)
  const newTabLabel = t('nav.withShortcut', {
    label: t('titleBar.newTab'),
    shortcut: SHORTCUTS.newTab.label,
  })

  return (
    <header className="app-drag relative h-(--titlebar-height) shrink-0 border-b border-border bg-titlebar text-titlebar-foreground">
      <div className="titlebar-area flex items-end gap-1 ps-3">
        <KeyRound aria-hidden className="mb-2.5 size-4 shrink-0 text-primary" />
        <div
          role="tablist"
          aria-label={t('titleBar.tabs')}
          className="app-no-drag ms-2 flex h-full items-end"
        >
          <button
            type="button"
            role="tab"
            aria-selected="true"
            onClick={() => {
              showSection('hosts')
            }}
            className="flex h-8 items-center gap-2 rounded-t-md border border-b-0 border-border bg-background px-3 text-sm"
          >
            <House aria-hidden className="size-3.5" />
            {t('titleBar.homeTab')}
          </button>
        </div>
        <button
          type="button"
          aria-label={newTabLabel}
          title={newTabLabel}
          aria-keyshortcuts={SHORTCUTS.newTab.aria}
          onClick={focusQuickConnect}
          className="app-no-drag mb-1 flex size-7 items-center justify-center rounded-md hover:bg-muted"
        >
          <Plus aria-hidden className="size-4" />
        </button>
      </div>
    </header>
  )
}
