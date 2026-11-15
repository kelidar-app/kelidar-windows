import { describe, expect, it } from 'vitest'
import { TERMINAL_THEMES } from '../../src/renderer/features/terminal/themes'
import { TERMINAL_THEME_IDS } from '../../src/shared/settings'

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

const ANSI = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const

describe('terminal themes', () => {
  it('has the four built-in themes, each with a light and a dark variant', () => {
    expect(Object.keys(TERMINAL_THEMES).sort()).toEqual([...TERMINAL_THEME_IDS].sort())
    for (const id of TERMINAL_THEME_IDS) {
      for (const variant of ['light', 'dark'] as const) {
        const theme = TERMINAL_THEMES[id][variant]
        for (const key of [...ANSI, 'background', 'foreground', 'cursor'] as const) {
          expect(theme[key], `${id}.${variant}.${key}`).toMatch(/^#[0-9a-f]{6}$/i)
        }
      }
    }
  })

  it('keeps normal text readable (WCAG 4.5:1) in every variant', () => {
    for (const id of TERMINAL_THEME_IDS) {
      for (const variant of ['light', 'dark'] as const) {
        const { background = '', foreground = '' } = TERMINAL_THEMES[id][variant]
        expect(contrast(foreground, background), `${id}.${variant}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('has a light background for light variants and a dark one for dark variants', () => {
    for (const id of TERMINAL_THEME_IDS) {
      expect(luminance(TERMINAL_THEMES[id].light.background ?? '')).toBeGreaterThan(0.7)
      expect(luminance(TERMINAL_THEMES[id].dark.background ?? '')).toBeLessThan(0.05)
    }
  })
})
