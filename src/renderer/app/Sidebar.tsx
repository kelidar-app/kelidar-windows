import { Cable, FolderOpen, Server, Settings, SquareCode, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/cn'
import { HOME_TAB, useTabsStore } from '@renderer/stores/tabs'
import { useUiStore, type SectionId } from '@renderer/stores/ui'
import { SHORTCUTS } from './shortcuts'

type NavKey = 'hosts' | 'files' | 'tunnels' | 'snippets' | 'settings'

interface NavItem {
  key: NavKey
  icon: LucideIcon
  /** Only enabled items have a section and a shortcut. */
  section?: SectionId
  shortcut?: { label: string; aria: string }
}

const MAIN_ITEMS: readonly NavItem[] = [
  { key: 'hosts', icon: Server, section: 'hosts', shortcut: SHORTCUTS.hosts },
  { key: 'files', icon: FolderOpen },
  { key: 'tunnels', icon: Cable },
  { key: 'snippets', icon: SquareCode },
]

const SETTINGS_ITEM: NavItem = {
  key: 'settings',
  icon: Settings,
  section: 'settings',
  shortcut: SHORTCUTS.settings,
}

function NavButton({ item }: { item: NavItem }) {
  const { t } = useTranslation()
  const current = useUiStore((state) => state.section)
  const homeActive = useTabsStore((state) => state.activeId === HOME_TAB)
  const showSection = useUiStore((state) => state.showSection)
  const label = t(`nav.${item.key}`)
  const Icon = item.icon
  const section = item.section
  const enabled = section !== undefined
  const active = enabled && homeActive && current === section
  const tooltip = enabled
    ? item.shortcut === undefined
      ? label
      : t('nav.withShortcut', { label, shortcut: item.shortcut.label })
    : t('nav.comingSoon', { label })

  return (
    <button
      type="button"
      title={tooltip}
      aria-current={active ? 'page' : undefined}
      aria-disabled={enabled ? undefined : true}
      aria-keyshortcuts={item.shortcut?.aria}
      data-nav={item.key}
      onClick={() => {
        if (section !== undefined) showSection(section)
      }}
      className={cn(
        'flex h-9 w-full items-center gap-3 rounded-md px-3 text-start text-sm',
        active && 'bg-accent font-medium text-accent-foreground',
        enabled && !active && 'hover:bg-muted',
        !enabled && 'cursor-default opacity-45',
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

export function Sidebar() {
  const { t } = useTranslation()
  return (
    <nav
      aria-label={t('nav.label')}
      className="flex w-52 shrink-0 flex-col justify-between border-e border-border bg-sidebar p-2 text-sidebar-foreground"
    >
      <ul className="flex flex-col gap-0.5">
        {MAIN_ITEMS.map((item) => (
          <li key={item.key}>
            <NavButton item={item} />
          </li>
        ))}
      </ul>
      <NavButton item={SETTINGS_ITEM} />
    </nav>
  )
}
