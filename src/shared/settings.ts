import { z } from 'zod'
import { agentSourceSchema } from './keychain'
import { AUTO_LOCK_MINUTES, CLIPBOARD_CLEAR_SECONDS } from './security'

/** Bump this and add a migration in src/main/settings/migrations.ts when the shape changes. */
export const SETTINGS_VERSION = 7

export const LANGUAGES = ['en', 'fa'] as const
export const languageSchema = z.enum(LANGUAGES)
export type Language = z.infer<typeof languageSchema>

export const THEMES = ['system', 'light', 'dark'] as const
export const themeSchema = z.enum(THEMES)
export type Theme = z.infer<typeof themeSchema>

/** Built-in terminal themes; each has a light and a dark variant. */
export const TERMINAL_THEME_IDS = ['kelidar', 'classic', 'soft', 'contrast'] as const
export const terminalThemeSchema = z.enum(TERMINAL_THEME_IDS)
export type TerminalThemeId = z.infer<typeof terminalThemeSchema>

/** How the Hosts screen shows hosts: cards, or a compact list. */
export const HOSTS_VIEWS = ['cards', 'list'] as const
export const hostsViewSchema = z.enum(HOSTS_VIEWS)
export type HostsView = z.infer<typeof hostsViewSchema>

export const DEFAULT_TERMINAL_FONT = "'Cascadia Mono', Consolas, 'Courier New', monospace"
/** A CSS font-family list: names, quotes, commas and spaces only. */
export const terminalFontFamilySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[\p{L}\p{N} ,'".-]+$/u)
export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 36
export const terminalFontSizeSchema = z.int().min(MIN_FONT_SIZE).max(MAX_FONT_SIZE)
export const terminalLineHeightSchema = z.number().min(1).max(2)

/** Minutes without input before the app locks (with a master password); 0: never. */
export const autoLockMinutesSchema = z.literal(AUTO_LOCK_MINUTES)
/** Seconds before a copied password leaves the clipboard; 0: never. */
export const clipboardClearSecondsSchema = z.literal(CLIPBOARD_CLEAR_SECONDS)

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
  terminalTheme: terminalThemeSchema,
  hostsView: hostsViewSchema,
  agent: agentSourceSchema,
  terminalFontFamily: terminalFontFamilySchema,
  terminalFontSize: terminalFontSizeSchema,
  terminalLineHeight: terminalLineHeightSchema,
  /** Ask before pasting text with line breaks (production hosts always ask). */
  pasteGuard: z.boolean(),
  autoLockMinutes: autoLockMinutesSchema,
  /** Lock when Windows locks or the computer goes to sleep. */
  lockOnWindowsLock: z.boolean(),
  clipboardClearSeconds: clipboardClearSecondsSchema,
  /** Read /etc/os-release after a host's first connection, for its badge. */
  detectOs: z.boolean(),
  /** The first-run import offer was shown (or there was nothing to import). */
  importOffered: z.boolean(),
  window: windowStateSchema.optional(),
})
export type SettingsFile = z.infer<typeof settingsFileSchema>

/** The part of the settings the renderer may see and change. */
export const uiSettingsSchema = z.object({
  language: languageSchema,
  theme: themeSchema,
  terminalTheme: terminalThemeSchema,
  hostsView: hostsViewSchema,
  agent: agentSourceSchema,
  terminalFontFamily: terminalFontFamilySchema,
  terminalFontSize: terminalFontSizeSchema,
  terminalLineHeight: terminalLineHeightSchema,
  pasteGuard: z.boolean(),
  autoLockMinutes: autoLockMinutesSchema,
  lockOnWindowsLock: z.boolean(),
  clipboardClearSeconds: clipboardClearSecondsSchema,
  detectOs: z.boolean(),
  importOffered: z.boolean(),
})
export type UiSettings = z.infer<typeof uiSettingsSchema>

export const uiSettingsPatchSchema = z
  .strictObject({
    language: languageSchema.optional(),
    theme: themeSchema.optional(),
    terminalTheme: terminalThemeSchema.optional(),
    hostsView: hostsViewSchema.optional(),
    agent: agentSourceSchema.optional(),
    terminalFontFamily: terminalFontFamilySchema.optional(),
    terminalFontSize: terminalFontSizeSchema.optional(),
    terminalLineHeight: terminalLineHeightSchema.optional(),
    pasteGuard: z.boolean().optional(),
    autoLockMinutes: autoLockMinutesSchema.optional(),
    lockOnWindowsLock: z.boolean().optional(),
    clipboardClearSeconds: clipboardClearSecondsSchema.optional(),
    detectOs: z.boolean().optional(),
    importOffered: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Empty patch' })
export type UiSettingsPatch = z.infer<typeof uiSettingsPatchSchema>

export const DEFAULT_UI_SETTINGS: UiSettings = {
  language: 'en',
  theme: 'system',
  terminalTheme: 'kelidar',
  hostsView: 'cards',
  agent: 'auto',
  terminalFontFamily: DEFAULT_TERMINAL_FONT,
  terminalFontSize: 14,
  terminalLineHeight: 1.1,
  pasteGuard: true,
  autoLockMinutes: 15,
  lockOnWindowsLock: true,
  clipboardClearSeconds: 30,
  detectOs: true,
  importOffered: false,
}

/** Persian when the system prefers it, otherwise English. */
export function pickDefaultLanguage(preferred: readonly string[]): Language {
  const first = preferred[0]?.toLowerCase() ?? ''
  return first === 'fa' || first.startsWith('fa-') ? 'fa' : 'en'
}
