import { Command } from 'cmdk'
import {
  ArrowLeft,
  Folder,
  Languages,
  Monitor,
  Moon,
  Server,
  Star,
  Sun,
  SquareTerminal,
  Zap,
} from 'lucide-react'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { formatTarget } from '@shared/address'
import { groupPath } from '@shared/groups'
import type { GroupView } from '@shared/groups'
import type { HostView } from '@shared/hosts'
import { LANGUAGES, THEMES, type Theme } from '@shared/settings'
import { Dialog } from '@renderer/components/ui/dialog'
import { scoreKeywords } from '@renderer/lib/fuzzy'
import { canUpgradeToKey, HOST_KEYS } from '@renderer/features/hosts/host-keys'
import { useGroupFormStore, useHostFormStore, useHostsStore } from '@renderer/stores/hosts'
import { useKeychainDialogStore } from '@renderer/stores/keychain'
import { useSettingsStore } from '@renderer/stores/settings'
import { tabTitle, useTabsStore } from '@renderer/stores/tabs'
import { useUiStore } from '@renderer/stores/ui'
import { COMMANDS, comboLabel } from './commands'

type Page =
  { kind: 'root' } | { kind: 'host'; host: HostView } | { kind: 'group'; group: GroupView }

const ITEM =
  'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground'
const GROUP =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground'

function Shortcut({ children }: { children: ReactNode }) {
  return (
    <kbd dir="ltr" className="ms-auto shrink-0 font-sans text-xs text-muted-foreground">
      {children}
    </kbd>
  )
}

export function CommandPalette() {
  const { t } = useTranslation()
  const open = useUiStore((state) => state.paletteOpen)
  const setOpen = useUiStore((state) => state.setPaletteOpen)
  return (
    <Dialog
      open={open}
      onClose={() => {
        setOpen(false)
      }}
      title={t('palette.title')}
      hideTitle
      className="mt-[12vh] mb-auto w-[min(38rem,calc(100vw-2rem))]"
    >
      {open && (
        <Palette
          onDone={() => {
            setOpen(false)
          }}
        />
      )}
    </Dialog>
  )
}

function Palette({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const hosts = useHostsStore((state) => state.hosts)
  const groups = useHostsStore((state) => state.groups)
  const tabs = useTabsStore((state) => state.tabs)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState('')
  const [page, setPage] = useState<Page>({ kind: 'root' })

  /** Closes the palette first, so a dialog the action opens is not stacked on it. */
  const run = (action: () => void): void => {
    onDone()
    action()
  }
  const go = (next: Page): void => {
    setPage(next)
    setSearch('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' && event.shiftKey && selected.startsWith('host:')) {
      const host = hosts.find((item) => `host:${item.id}` === selected)
      if (host !== undefined) {
        event.preventDefault()
        go({ kind: 'host', host })
      }
    } else if (event.key === 'Backspace' && search === '' && page.kind !== 'root') {
      event.preventDefault()
      go({ kind: 'root' })
    }
  }

  const placeholder =
    page.kind === 'host'
      ? t('palette.hostPlaceholder', { name: page.host.name })
      : page.kind === 'group'
        ? t('palette.groupPlaceholder', { name: page.group.name })
        : t('palette.placeholder')

  return (
    <Command
      label={t('palette.title')}
      filter={(_value, search, keywords) => scoreKeywords(search, keywords ?? [])}
      loop
      value={selected}
      onValueChange={setSelected}
      onKeyDown={onKeyDown}
      className="flex max-h-[min(32rem,70vh)] flex-col"
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        {page.kind !== 'root' && (
          <button
            type="button"
            aria-label={t('palette.back')}
            title={t('palette.back')}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            onClick={() => {
              go({ kind: 'root' })
            }}
          >
            <ArrowLeft aria-hidden className="size-4 rtl:rotate-180" />
          </button>
        )}
        <Command.Input
          autoFocus
          data-autofocus
          value={search}
          onValueChange={setSearch}
          placeholder={placeholder}
          className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <Command.List className="min-h-0 overflow-y-auto p-1.5">
        <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
          {t('palette.empty')}
        </Command.Empty>
        {page.kind === 'root' && (
          <RootPage hosts={hosts} groups={groups} tabs={tabs} run={run} go={go} />
        )}
        {page.kind === 'host' && <HostPage host={page.host} run={run} />}
        {page.kind === 'group' && <GroupPage group={page.group} run={run} />}
      </Command.List>
      <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
        {page.kind === 'root' ? t('palette.footer') : t('palette.footerPage')}
      </p>
    </Command>
  )
}

function RootPage({
  hosts,
  groups,
  tabs,
  run,
  go,
}: {
  hosts: readonly HostView[]
  groups: readonly GroupView[]
  tabs: ReturnType<typeof useTabsStore.getState>['tabs']
  run: (action: () => void) => void
  go: (page: Page) => void
}) {
  const { t } = useTranslation()
  const openHost = useTabsStore((state) => state.openHost)
  const activate = useTabsStore((state) => state.activate)
  const update = useSettingsStore((state) => state.update)
  const settings = useSettingsStore((state) => state.settings)
  const themeIcon: Record<Theme, ReactNode> = {
    system: <Monitor aria-hidden className="size-4" />,
    light: <Sun aria-hidden className="size-4" />,
    dark: <Moon aria-hidden className="size-4" />,
  }
  const themeLabel: Record<Theme, string> = {
    system: t('settings.themeSystem'),
    light: t('settings.themeLight'),
    dark: t('settings.themeDark'),
  }

  return (
    <>
      {hosts.length > 0 && (
        <Command.Group heading={t('palette.hosts')} className={GROUP}>
          {hosts.map((host) => {
            const path = groupPath(host.groupId, groups).join(' / ')
            return (
              <Command.Item
                key={host.id}
                value={`host:${host.id}`}
                keywords={[host.name, host.address, host.username, path, ...host.tags]}
                className={ITEM}
                onSelect={() => {
                  run(() => void openHost(host.id))
                }}
              >
                <Server aria-hidden className="size-4 shrink-0 text-primary" />
                <span className="truncate">{host.name}</span>
                <span dir="ltr" className="truncate font-mono text-xs text-muted-foreground">
                  {formatTarget(host)}
                </span>
                {host.favorite && (
                  <Star aria-hidden className="size-3.5 shrink-0 fill-amber-400 text-amber-500" />
                )}
                {path !== '' && (
                  <span className="ms-auto shrink-0 truncate text-xs text-muted-foreground">
                    {path}
                  </span>
                )}
              </Command.Item>
            )
          })}
        </Command.Group>
      )}

      {tabs.length > 0 && (
        <Command.Group heading={t('palette.tabs')} className={GROUP}>
          {tabs.map((tab) => (
            <Command.Item
              key={tab.id}
              value={`tab:${tab.id}`}
              keywords={[tabTitle(tab), t('palette.switchTab', { title: tabTitle(tab) })]}
              className={ITEM}
              onSelect={() => {
                run(() => {
                  activate(tab.id)
                })
              }}
            >
              <SquareTerminal aria-hidden className="size-4 shrink-0" />
              <span className="truncate">{t('palette.switchTab', { title: tabTitle(tab) })}</span>
            </Command.Item>
          ))}
        </Command.Group>
      )}

      <Command.Group heading={t('palette.actions')} className={GROUP}>
        {COMMANDS.filter((command) => command.id !== 'palette' && command.available()).map(
          (command) => {
            const label = t(`commands.${command.id}`)
            const combo = command.combos[0]
            return (
              <Command.Item
                key={command.id}
                value={`command:${command.id}`}
                keywords={[label, command.id]}
                className={ITEM}
                onSelect={() => {
                  run(command.run)
                }}
              >
                <Zap aria-hidden className="size-4 shrink-0" />
                <span className="truncate">{label}</span>
                {combo !== undefined && <Shortcut>{comboLabel(combo)}</Shortcut>}
              </Command.Item>
            )
          },
        )}
      </Command.Group>

      {groups.length > 0 && (
        <Command.Group heading={t('palette.groups')} className={GROUP}>
          {groups.map((group) => {
            const path = groupPath(group.id, groups).join(' / ')
            return (
              <Command.Item
                key={group.id}
                value={`group:${group.id}`}
                keywords={[path, t('palette.groupKeyword')]}
                className={ITEM}
                onSelect={() => {
                  go({ kind: 'group', group })
                }}
              >
                <Folder aria-hidden className="size-4 shrink-0" />
                <span className="truncate">{path}</span>
              </Command.Item>
            )
          })}
        </Command.Group>
      )}

      <Command.Group heading={t('palette.preferences')} className={GROUP}>
        {THEMES.filter((theme) => theme !== settings.theme).map((theme) => {
          const label = t('palette.theme', { theme: themeLabel[theme] })
          return (
            <Command.Item
              key={theme}
              value={`theme:${theme}`}
              keywords={[label, t('settings.theme')]}
              className={ITEM}
              onSelect={() => {
                run(() => void update({ theme }))
              }}
            >
              {themeIcon[theme]}
              <span className="truncate">{label}</span>
            </Command.Item>
          )
        })}
        {LANGUAGES.filter((language) => language !== settings.language).map((language) => {
          const label = t('palette.language', { language: t(`languages.${language}`) })
          return (
            <Command.Item
              key={language}
              value={`language:${language}`}
              keywords={[label, t('settings.language'), t(`languages.${language}`)]}
              className={ITEM}
              onSelect={() => {
                run(() => void update({ language }))
              }}
            >
              <Languages aria-hidden className="size-4 shrink-0" />
              <span className="truncate">{label}</span>
            </Command.Item>
          )
        })}
      </Command.Group>
    </>
  )
}

function HostPage({ host, run }: { host: HostView; run: (action: () => void) => void }) {
  const { t } = useTranslation()
  const openHost = useTabsStore((state) => state.openHost)
  const openEdit = useHostFormStore((state) => state.openEdit)
  const setFavorite = useHostsStore((state) => state.setFavorite)
  const askDeleteHost = useGroupFormStore((state) => state.askDeleteHost)
  const showSection = useUiStore((state) => state.showSection)
  const openKeychainDialog = useKeychainDialogStore((state) => state.open)
  const upgrade = canUpgradeToKey(host)
    ? [
        {
          id: 'upgrade',
          label: t('upgrade.open'),
          shortcut: HOST_KEYS.upgrade,
          action: () => {
            openKeychainDialog({ kind: 'upgrade', host })
          },
        },
      ]
    : []
  const items: { id: string; label: string; shortcut: string; action: () => void }[] = [
    {
      id: 'connect',
      label: t('hosts.connectShort'),
      shortcut: 'Enter',
      action: () => void openHost(host.id),
    },
    {
      id: 'edit',
      label: t('common.edit'),
      shortcut: 'Ctrl+E',
      action: () => {
        showSection('hosts')
        openEdit(host)
      },
    },
    {
      id: 'favorite',
      label: host.favorite ? t('hosts.unfavoriteShort') : t('hosts.favoriteShort'),
      shortcut: 'Ctrl+D',
      action: () => void setFavorite(host.id, !host.favorite),
    },
    {
      id: 'delete',
      label: t('common.delete'),
      shortcut: 'Delete',
      action: () => {
        showSection('hosts')
        askDeleteHost(host)
      },
    },
    ...upgrade,
  ]
  return (
    <Command.Group heading={host.name} className={GROUP}>
      {items.map((item) => (
        <Command.Item
          key={item.id}
          value={`host-action:${item.id}`}
          keywords={[item.label]}
          className={ITEM}
          onSelect={() => {
            run(item.action)
          }}
        >
          <span className="truncate">{item.label}</span>
          <Shortcut>{item.shortcut}</Shortcut>
        </Command.Item>
      ))}
    </Command.Group>
  )
}

function GroupPage({ group, run }: { group: GroupView; run: (action: () => void) => void }) {
  const { t } = useTranslation()
  const openNewHost = useHostFormStore((state) => state.openNew)
  const { openNew, openEdit, askDelete } = useGroupFormStore()
  const showSection = useUiStore((state) => state.showSection)
  const items: { id: string; label: string; action: () => void }[] = [
    {
      id: 'add-host',
      label: t('groups.addHostShort'),
      action: () => {
        openNewHost({ groupId: group.id })
      },
    },
    {
      id: 'add-group',
      label: t('groups.addSubgroupShort'),
      action: () => {
        openNew(group.id)
      },
    },
    {
      id: 'edit',
      label: t('common.edit'),
      action: () => {
        openEdit(group)
      },
    },
    {
      id: 'delete',
      label: t('common.delete'),
      action: () => {
        askDelete(group)
      },
    },
  ]
  return (
    <Command.Group heading={group.name} className={GROUP}>
      {items.map((item) => (
        <Command.Item
          key={item.id}
          value={`group-action:${item.id}`}
          keywords={[item.label]}
          className={ITEM}
          onSelect={() => {
            run(() => {
              showSection('hosts')
              item.action()
            })
          }}
        >
          <span className="truncate">{item.label}</span>
        </Command.Item>
      ))}
    </Command.Group>
  )
}
