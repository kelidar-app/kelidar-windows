import {
  ChevronDown,
  FolderPlus,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Search,
  Server,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ErrorCode } from '@shared/errors'
import { groupPath, type GroupView } from '@shared/groups'
import type { HostView } from '@shared/hosts'
import { SHORTCUTS } from '@renderer/app/shortcuts'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/cn'
import { useGroupFormStore, useHostFormStore, useHostsStore } from '@renderer/stores/hosts'
import { useSettingsStore } from '@renderer/stores/settings'
import { useTabsStore } from '@renderer/stores/tabs'
import { useUiStore } from '@renderer/stores/ui'
import { COLOR_DOT } from './colors'
import { EnvironmentBadge, HostItem, type HostLayout } from './HostItem'
import { buildTree, favoriteHosts, recentHosts, searchHosts, type GroupNode } from './host-search'
import { QuickConnect } from './QuickConnect'

export function HostsView() {
  const { t } = useTranslation()
  const hosts = useHostsStore((state) => state.hosts)
  const groups = useHostsStore((state) => state.groups)
  const loaded = useHostsStore((state) => state.loaded)
  const error = useHostsStore((state) => state.error)
  const load = useHostsStore((state) => state.load)
  const openNew = useHostFormStore((state) => state.openNew)
  const openNewGroup = useGroupFormStore((state) => state.openNew)
  const openError = useTabsStore((state) => state.openError)
  const query = useUiStore((state) => state.hostQuery)
  const layout = useSettingsStore((state) => state.settings.hostsView)

  useEffect(() => {
    void load()
  }, [load])

  const searching = query.trim() !== ''
  const results = useMemo(
    () => (searching ? searchHosts(hosts, groups, query) : []),
    [searching, hosts, groups, query],
  )
  const tree = useMemo(() => buildTree(hosts, groups), [hosts, groups])
  const favorites = useMemo(() => favoriteHosts(hosts), [hosts])
  const recent = useMemo(() => recentHosts(hosts), [hosts])
  const empty = loaded && error === null && hosts.length === 0 && groups.length === 0

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-4 border-b border-border px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="text-xl font-semibold">{t('hosts.title')}</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              title={t('nav.withShortcut', {
                label: t('groups.newGroup'),
                shortcut: SHORTCUTS.newGroup.label,
              })}
              aria-keyshortcuts={SHORTCUTS.newGroup.aria}
              onClick={() => {
                openNewGroup()
              }}
            >
              <FolderPlus aria-hidden />
              {t('groups.newGroup')}
            </Button>
            <Button
              title={t('nav.withShortcut', {
                label: t('hosts.newHost'),
                shortcut: SHORTCUTS.newHost.label,
              })}
              aria-keyshortcuts={SHORTCUTS.newHost.aria}
              onClick={() => {
                openNew()
              }}
            >
              <Plus aria-hidden />
              {t('hosts.newHost')}
            </Button>
          </div>
        </div>
        <QuickConnect />
      </div>

      {(error ?? openError) !== null && (
        <p
          role="alert"
          className="mx-6 mt-4 rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
        >
          {t(`errors.${error ?? openError ?? 'INTERNAL'}`)}
        </p>
      )}

      {empty ? (
        <EmptyState />
      ) : (
        <>
          <Toolbar layout={layout} firstResult={results[0]} />
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-6" data-host-list="">
            {searching ? (
              <SearchResults results={results} groups={groups} layout={layout} />
            ) : (
              <div className="flex flex-col gap-6">
                {favorites.length > 0 && (
                  <HostSection title={t('hosts.favorites')} hosts={favorites} layout={layout} />
                )}
                {recent.length > 0 && (
                  <HostSection title={t('hosts.recent')} hosts={recent} layout={layout} />
                )}
                <section aria-label={t('hosts.allHosts')} className="flex flex-col gap-2">
                  {(favorites.length > 0 || recent.length > 0) && (
                    <h2 className="text-xs font-semibold text-muted-foreground">
                      {t('hosts.allHosts')}
                    </h2>
                  )}
                  {tree.groups.map((node) => (
                    <GroupSection key={node.group.id} node={node} layout={layout} depth={0} />
                  ))}
                  {tree.hosts.length > 0 && (
                    <HostList label={t('hosts.listLabel')} hosts={tree.hosts} layout={layout} />
                  )}
                </section>
              </div>
            )}
          </div>
        </>
      )}

      <DeleteHostDialog />
      <DeleteGroupDialog />
    </section>
  )
}

function Toolbar({
  layout,
  firstResult,
}: {
  layout: HostLayout
  firstResult?: HostView | undefined
}) {
  const { t } = useTranslation()
  const query = useUiStore((state) => state.hostQuery)
  const setQuery = useUiStore((state) => state.setHostQuery)
  const focusRequest = useUiStore((state) => state.hostSearchFocusRequest)
  const update = useSettingsStore((state) => state.update)
  const openHost = useTabsStore((state) => state.openHost)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusRequest === 0) return
    input.current?.focus()
    input.current?.select()
  }, [focusRequest])

  const viewButton = (value: HostLayout, label: string, icon: ReactNode) => (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={layout === value}
      title={t('nav.withShortcut', { label, shortcut: SHORTCUTS.toggleHostsView.label })}
      className={cn(layout === value && 'bg-card text-card-foreground shadow-sm hover:bg-card')}
      onClick={() => {
        if (layout !== value) void update({ hostsView: value })
      }}
    >
      {icon}
    </Button>
  )

  return (
    <div className="flex items-center gap-2 px-6 pt-4 pb-2">
      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden
          className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={input}
          type="search"
          value={query}
          spellCheck={false}
          autoComplete="off"
          aria-label={t('hosts.search')}
          aria-keyshortcuts={SHORTCUTS.searchHosts.aria}
          placeholder={t('hosts.searchPlaceholder', { shortcut: SHORTCUTS.searchHosts.label })}
          className="ps-8 pe-8"
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query !== '') {
              event.preventDefault()
              setQuery('')
            } else if (event.key === 'Enter' && firstResult !== undefined) {
              // Enter connects to the best match.
              event.preventDefault()
              void openHost(firstResult.id)
            } else if (event.key === 'ArrowDown') {
              const first = document.querySelector<HTMLElement>('[data-host-list] [data-host-item]')
              if (first === null) return
              event.preventDefault()
              first.focus()
            }
          }}
        />
        {query !== '' && (
          <button
            type="button"
            aria-label={t('hosts.clearSearch')}
            className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setQuery('')
              input.current?.focus()
            }}
          >
            <X aria-hidden className="size-4" />
          </button>
        )}
      </div>
      <div
        role="group"
        aria-label={t('hosts.view')}
        className="flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5"
      >
        {viewButton('cards', t('hosts.viewCards'), <LayoutGrid aria-hidden />)}
        {viewButton('list', t('hosts.viewList'), <List aria-hidden />)}
      </div>
    </div>
  )
}

function HostList({
  hosts,
  layout,
  label,
}: {
  hosts: readonly HostView[]
  layout: HostLayout
  label: string
}) {
  return (
    <ul
      aria-label={label}
      className={
        layout === 'cards'
          ? 'grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3'
          : 'flex flex-col gap-1.5'
      }
    >
      {hosts.map((host) => (
        <HostItem key={host.id} host={host} layout={layout} />
      ))}
    </ul>
  )
}

function HostSection({
  title,
  hosts,
  layout,
}: {
  title: string
  hosts: readonly HostView[]
  layout: HostLayout
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold text-muted-foreground">{title}</h2>
      <HostList label={title} hosts={hosts} layout={layout} />
    </section>
  )
}

function SearchResults({
  results,
  groups,
  layout,
}: {
  results: readonly HostView[]
  groups: readonly GroupView[]
  layout: HostLayout
}) {
  const { t } = useTranslation()
  if (results.length === 0) {
    return (
      <p role="status" className="py-8 text-center text-sm text-muted-foreground">
        {t('hosts.noResults')}
      </p>
    )
  }
  return (
    <section aria-label={t('hosts.results')} className="flex flex-col gap-2">
      <h2 role="status" className="text-xs font-semibold text-muted-foreground">
        {t('hosts.resultCount', { count: results.length })}
      </h2>
      <ul
        aria-label={t('hosts.results')}
        className={
          layout === 'cards'
            ? 'grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3'
            : 'flex flex-col gap-1.5'
        }
      >
        {results.map((host) => (
          <HostItem key={host.id} host={host} layout={layout} />
        ))}
      </ul>
      {groups.length > 0 && (
        <p className="text-xs text-muted-foreground">{t('hosts.searchHint')}</p>
      )}
    </section>
  )
}

function GroupSection({
  node,
  layout,
  depth,
}: {
  node: GroupNode
  layout: HostLayout
  depth: number
}) {
  const { t } = useTranslation()
  const collapsed = useUiStore((state) => state.collapsedGroups.has(node.group.id))
  const toggle = useUiStore((state) => state.toggleGroup)
  const openNewHost = useHostFormStore((state) => state.openNew)
  const { openNew, openEdit, askDelete } = useGroupFormStore()
  const { group } = node
  const contentId = `group-${group.id}`
  const port = group.defaults.port

  return (
    <section aria-label={group.name} data-group-id={group.id} className="flex flex-col gap-2">
      <div className="group/header flex items-center gap-1 rounded-md hover:bg-muted">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={contentId}
          className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-start"
          onClick={() => {
            toggle(group.id)
          }}
        >
          <ChevronDown
            aria-hidden
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              collapsed && '-rotate-90 rtl:rotate-90',
            )}
          />
          <span
            aria-hidden
            className={cn(
              'size-2.5 shrink-0 rounded-full',
              group.color === undefined ? 'bg-border' : COLOR_DOT[group.color],
            )}
          />
          <h2 className="truncate text-sm font-semibold">{group.name}</h2>
          <span className="shrink-0 text-xs text-muted-foreground">
            {t('groups.hostCount', { count: node.total })}
          </span>
          {port !== undefined && (
            <span dir="ltr" className="shrink-0 font-mono text-xs text-muted-foreground">
              :{port}
            </span>
          )}
          {group.defaults.environment !== undefined && (
            <EnvironmentBadge environment={group.defaults.environment} />
          )}
        </button>
        <div className="flex shrink-0 items-center opacity-70 group-focus-within/header:opacity-100 group-hover/header:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('groups.addHost', { name: group.name })}
            title={t('groups.addHostShort')}
            onClick={() => {
              openNewHost({ groupId: group.id })
            }}
          >
            <Plus aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('groups.addSubgroup', { name: group.name })}
            title={t('groups.addSubgroupShort')}
            onClick={() => {
              openNew(group.id)
            }}
          >
            <FolderPlus aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('groups.edit', { name: group.name })}
            title={t('common.edit')}
            onClick={() => {
              openEdit(group)
            }}
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('groups.delete', { name: group.name })}
            title={t('common.delete')}
            onClick={() => {
              askDelete(group)
            }}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
      <div
        id={contentId}
        hidden={collapsed}
        className={cn('flex flex-col gap-2 border-s border-border ps-4', depth > 0 && 'ms-1')}
      >
        {node.groups.map((child) => (
          <GroupSection key={child.group.id} node={child} layout={layout} depth={depth + 1} />
        ))}
        {node.hosts.length > 0 ? (
          <HostList label={group.name} hosts={node.hosts} layout={layout} />
        ) : (
          node.groups.length === 0 && (
            <p className="py-1 text-xs text-muted-foreground">{t('groups.empty')}</p>
          )
        )}
      </div>
    </section>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
        <Server aria-hidden className="size-7" />
      </div>
      <div className="flex max-w-md flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('hosts.emptyTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('hosts.emptyBody')}</p>
      </div>
    </div>
  )
}

function DeleteHostDialog() {
  const { t } = useTranslation()
  const host = useGroupFormStore((state) => state.deletingHost)
  const askDeleteHost = useGroupFormStore((state) => state.askDeleteHost)
  const remove = useHostsStore((state) => state.remove)
  const [error, setError] = useState<ErrorCode | null>(null)
  const close = (): void => {
    setError(null)
    askDeleteHost(null)
  }

  return (
    <Dialog
      open={host !== null}
      onClose={close}
      role="alertdialog"
      title={t('hosts.deleteTitle', { name: host?.name ?? '' })}
      description={t('hosts.deleteBody')}
      footer={
        <>
          {error !== null && (
            <p role="alert" className="me-auto text-sm text-destructive">
              {t(`errors.${error}`)}
            </p>
          )}
          <Button variant="outline" autoFocus data-autofocus onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              if (host === null) return
              void remove(host.id).then((result) => {
                if (result.ok) close()
                else setError(result.code)
              })
            }}
          >
            {t('common.delete')}
          </Button>
        </>
      }
    />
  )
}

function DeleteGroupDialog() {
  const { t } = useTranslation()
  const group = useGroupFormStore((state) => state.deleting)
  const askDelete = useGroupFormStore((state) => state.askDelete)
  const groups = useHostsStore((state) => state.groups)
  const removeGroup = useHostsStore((state) => state.removeGroup)
  const [error, setError] = useState<ErrorCode | null>(null)
  const close = (): void => {
    setError(null)
    askDelete(null)
  }
  const parent = groupPath(group?.parentId, groups).join(' / ')

  return (
    <Dialog
      open={group !== null}
      onClose={close}
      role="alertdialog"
      title={t('groups.deleteTitle', { name: group?.name ?? '' })}
      description={parent === '' ? t('groups.deleteBodyTop') : t('groups.deleteBody', { parent })}
      footer={
        <>
          {error !== null && (
            <p role="alert" className="me-auto text-sm text-destructive">
              {t(`errors.${error}`)}
            </p>
          )}
          <Button variant="outline" autoFocus data-autofocus onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              if (group === null) return
              void removeGroup(group.id).then((result) => {
                if (result.ok) close()
                else setError(result.code)
              })
            }}
          >
            {t('groups.deleteConfirm')}
          </Button>
        </>
      }
    />
  )
}
