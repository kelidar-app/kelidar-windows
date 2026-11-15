import { z } from 'zod'

/** Bump this and add a migration in src/main/settings/migrations.ts when the shape changes. */
export const SETTINGS_VERSION = 1

export const LANGUAGES = ['en', 'fa'] as const
export const languageSchema = z.enum(LANGUAGES)
export type Language = z.infer<typeof languageSchema>

export const THEMES = ['system', 'light', 'dark'] as const
export const themeSchema = z.enum(THEMES)
export type Theme = z.infer<typeof themeSchema>

const pixels = z.int().min(-100_000).max(100_000)

export const windowStateSchema = z.object({
  width: z.int().min(400).max(20_000),
  height: z.int().min(300).max(20_000),
  x: pixels.optional(),
  y: pixels.optional(),
  maximized: z.boolean(),
})
export type WindowState = z.infer<typeof windowStateSchema>

/** The full settings.json file. Non-secret values only. */
export const settingsFileSchema = z.object({
  version: z.literal(SETTINGS_VERSION),
  language: languageSchema,
  theme: themeSchema,
  window: windowStateSchema.optional(),
})
export type SettingsFile = z.infer<typeof settingsFileSchema>

/** The part of the settings the renderer may see and change. */
export const uiSettingsSchema = z.object({
  language: languageSchema,
  theme: themeSchema,
})
export type UiSettings = z.infer<typeof uiSettingsSchema>

export const uiSettingsPatchSchema = z
  .strictObject({
    language: languageSchema.optional(),
    theme: themeSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Empty patch' })
export type UiSettingsPatch = z.infer<typeof uiSettingsPatchSchema>

export const DEFAULT_UI_SETTINGS: UiSettings = { language: 'en', theme: 'system' }

/** Persian when the system prefers it, otherwise English. */
export function pickDefaultLanguage(preferred: readonly string[]): Language {
  const first = preferred[0]?.toLowerCase() ?? ''
  return first === 'fa' || first.startsWith('fa-') ? 'fa' : 'en'
}
