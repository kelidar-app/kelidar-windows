import { useEffect } from 'react'
import { GroupFormDialog } from '@renderer/features/hosts/GroupForm'
import { HostFormDialog } from '@renderer/features/hosts/HostForm'
import { HostsView } from '@renderer/features/hosts/HostsView'
import { KeychainDialogs } from '@renderer/features/keychain/KeychainDialogs'
import { KeychainView } from '@renderer/features/keychain/KeychainView'
import { LockScreen } from '@renderer/features/security/LockScreen'
import { SecurityDialogs } from '@renderer/features/security/SecurityDialogs'
import { PromptDialogs } from '@renderer/features/sessions/PromptDialogs'
import { SettingsView } from '@renderer/features/settings/SettingsView'
import { Workspace } from '@renderer/features/terminal/Workspace'
import { PasteGuardDialog } from '@renderer/features/terminal/PasteGuardDialog'
import { subscribeToPrompts } from '@renderer/stores/prompts'
import { subscribeToVault, useVaultStore } from '@renderer/stores/security'
import { HOME_TAB, startTabs, useTabsStore } from '@renderer/stores/tabs'
import { useUiStore } from '@renderer/stores/ui'
import { cn } from '@renderer/lib/cn'
import { CommandPalette } from './CommandPalette'
import { Notice } from './Notice'
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
  const locked = useVaultStore((state) => state.status.state === 'locked')
  useEffect(() => {
    startTabs()
    const stopPrompts = subscribeToPrompts()
    const stopVault = subscribeToVault()
    return () => {
      stopPrompts()
      stopVault()
    }
  }, [])

  const homeActive = activeId === HOME_TAB
  return (
    <>
      {locked && <LockScreen />}
      <AppShell hidden={locked} homeActive={homeActive} section={section} />
    </>
  )
}

/**
 * Everything but the lock screen. While locked it stays mounted (terminals
 * keep their scrollback and connections) but is hidden and inert, and no
 * dialog is shown: a modal would cover the lock screen.
 */
function AppShell({
  hidden,
  homeActive,
  section,
}: {
  hidden: boolean
  homeActive: boolean
  section: ReturnType<typeof useUiStore.getState>['section']
}) {
  return (
    <div
      data-app-shell=""
      inert={hidden}
      aria-hidden={hidden}
      className={cn('h-full flex-col bg-background text-foreground', hidden ? 'hidden' : 'flex')}
    >
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          {!hidden && homeActive && section === 'hosts' && <HostsView />}
          {!hidden && homeActive && section === 'keychain' && <KeychainView />}
          {!hidden && homeActive && section === 'settings' && <SettingsView />}
          {/* Terminals stay mounted while hidden, so their scrollback survives. */}
          <Workspace />
        </main>
      </div>
      {!hidden && (
        <>
          <HostFormDialog />
          <GroupFormDialog />
          <KeychainDialogs />
          <SecurityDialogs />
          <PromptDialogs />
          <PasteGuardDialog />
          <CommandPalette />
          <ShortcutsDialog />
          <Notice />
        </>
      )}
    </div>
  )
}
