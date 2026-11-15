import { create } from 'zustand'
import type { ErrorCode } from '@shared/errors'
import { DEFAULT_UI_SETTINGS, type UiSettings, type UiSettingsPatch } from '@shared/settings'
import { i18next } from '@renderer/i18n'
import { api } from '@renderer/lib/api'

interface SettingsState {
  settings: UiSettings
  error: ErrorCode | null
  update: (patch: UiSettingsPatch) => Promise<void>
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  settings: DEFAULT_UI_SETTINGS,
  error: null,
  update: async (patch) => {
    const result = await api.invoke('settings:update', patch)
    if (!result.ok) {
      set({ error: result.error.code })
      return
    }
    set({ settings: result.data, error: null })
    if (i18next.language !== result.data.language) {
      await i18next.changeLanguage(result.data.language)
    }
  },
}))
