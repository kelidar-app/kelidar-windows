import { HostFormDialog } from '@renderer/features/hosts/HostForm'
import { HostsView } from '@renderer/features/hosts/HostsView'
import { PromptDialogs } from '@renderer/features/sessions/PromptDialogs'
import { SettingsView } from '@renderer/features/settings/SettingsView'
import { useEffect } from 'react'
import { subscribeToPrompts } from '@renderer/stores/prompts'
import { useUiStore } from '@renderer/stores/ui'
import { useGlobalShortcuts } from './shortcuts'
import { Sidebar } from './Sidebar'
import { TitleBar } from './TitleBar'
import { useTitleBarOverlaySync } from './title-bar-overlay'

export function App() {
  useGlobalShortcuts()
  useTitleBarOverlaySync()
  const section = useUiStore((state) => state.section)
  useEffect(() => subscribeToPrompts(), [])

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          {section === 'hosts' ? <HostsView /> : <SettingsView />}
        </main>
      </div>
      <HostFormDialog />
      <PromptDialogs />
    </div>
  )
}
