import '@fontsource-variable/vazirmatn'
import './styles/globals.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { APP, TITLE_BAR_HEIGHT } from '@shared/app'
import { DEFAULT_UI_SETTINGS } from '@shared/settings'
import { App } from './app/App'
import { initI18n } from './i18n'
import { api } from './lib/api'
import { useSettingsStore } from './stores/settings'

async function bootstrap(): Promise<void> {
  document.title = APP.name
  document.documentElement.style.setProperty('--titlebar-height', `${String(TITLE_BAR_HEIGHT)}px`)

  const result = await api.invoke('settings:get')
  const settings = result.ok ? result.data : DEFAULT_UI_SETTINGS
  useSettingsStore.setState({ settings, error: result.ok ? null : result.error.code })
  await initI18n(settings.language)

  const container = document.getElementById('root')
  if (container === null) throw new Error('Missing #root element')
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
