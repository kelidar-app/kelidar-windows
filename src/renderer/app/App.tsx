import { useEffect } from 'react'
import { GroupFormDialog } from '@renderer/features/hosts/GroupForm'
import { HostFormDialog } from '@renderer/features/hosts/HostForm'
import { HostsView } from '@renderer/features/hosts/HostsView'
import { KeychainDialogs } from '@renderer/features/keychain/KeychainDialogs'
import { KeychainView } from '@renderer/features/keychain/KeychainView'
import { PromptDialogs } from '@renderer/features/sessions/PromptDialogs'
import { SettingsView } from '@renderer/features/settings/SettingsView'
import { Workspace } from '@renderer/features/terminal/Workspace'
import { PasteGuardDialog } from '@renderer/features/terminal/PasteGuardDialog'
import { subscribeToPrompts } from '@renderer/stores/prompts'
import { HOME_TAB, startTabs, useTabsStore } from '@renderer/stores/tabs'
import { useUiStore } from '@renderer/stores/ui'
import { CommandPalette } from './CommandPalette'
import { ShortcutsDialog } from './ShortcutsDialog'
import { useGlobalShortcuts } from './shortcuts'
import { Sidebar } from './Sidebar'
import { TitleBar } from './TitleBar'
import { useTitleBarOverlaySync } from './title-bar-overlay'

export function App() {
  useGlobalShortcuts()
  useTitleBarOverlaySync()
  const section = useUiStore((state) => state.section)
  const activeId = useTabsStore((state) => state.activeId)
  useEffect(() => {
    startTabs()
    return subscribeToPrompts()
  }, [])

  const homeActive = activeId === HOME_TAB
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          {homeActive && section === 'hosts' && <HostsView />}
          {homeActive && section === 'keychain' && <KeychainView />}
          {homeActive && section === 'settings' && <SettingsView />}
          {/* Terminals stay mounted while hidden, so their scrollback survives. */}
          <Workspace />
        </main>
      </div>
      <HostFormDialog />
      <GroupFormDialog />
      <KeychainDialogs />
      <PromptDialogs />
      <PasteGuardDialog />
      <CommandPalette />
      <ShortcutsDialog />
    </div>
  )
}
