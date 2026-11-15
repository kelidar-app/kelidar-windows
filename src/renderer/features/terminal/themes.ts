import type { ITheme } from '@xterm/xterm'
import type { TerminalThemeId } from '@shared/settings'

/** A terminal theme with a light and a dark variant; the app picks one to match Windows. */
export interface TerminalTheme {
  light: ITheme
  dark: ITheme
}

type Palette = Required<
  Pick<
    ITheme,
    | 'background'
    | 'foreground'
    | 'cursor'
    | 'black'
    | 'red'
    | 'green'
    | 'yellow'
    | 'blue'
    | 'magenta'
    | 'cyan'
    | 'white'
    | 'brightBlack'
    | 'brightRed'
    | 'brightGreen'
    | 'brightYellow'
    | 'brightBlue'
    | 'brightMagenta'
    | 'brightCyan'
    | 'brightWhite'
  >
> & { selection: string }

function theme(palette: Palette): ITheme {
  const { selection, ...colors } = palette
  return { ...colors, cursorAccent: palette.background, selectionBackground: selection }
}

/** Four built-in themes. Colors are original to this app. */
export const TERMINAL_THEMES: Record<TerminalThemeId, TerminalTheme> = {
  // Matches the app's teal accent.
  kelidar: {
    dark: theme({
      background: '#141417',
      foreground: '#e4e4e9',
      cursor: '#2dd4bf',
      selection: '#2dd4bf55',
      black: '#1f1f24',
      red: '#f2707a',
      green: '#7fd88f',
      yellow: '#e8c66b',
      blue: '#6ea8fe',
      magenta: '#d38cf0',
      cyan: '#4fd6c8',
      white: '#d4d4dc',
      brightBlack: '#6b6b78',
      brightRed: '#ff8f97',
      brightGreen: '#9ff0ad',
      brightYellow: '#f5da8c',
      brightBlue: '#94c0ff',
      brightMagenta: '#e3abf7',
      brightCyan: '#7ee8dd',
      brightWhite: '#f6f6f9',
    }),
    light: theme({
      background: '#fbfbfc',
      foreground: '#1f1f24',
      cursor: '#0f766e',
      selection: '#0f766e33',
      black: '#1f1f24',
      red: '#c4313c',
      green: '#2f7d3b',
      yellow: '#8a6400',
      blue: '#1f5fbf',
      magenta: '#8d3fae',
      cyan: '#0e7c74',
      white: '#c9c9d1',
      brightBlack: '#5c5c68',
      brightRed: '#e0424e',
      brightGreen: '#3a9a49',
      brightYellow: '#a87a00',
      brightBlue: '#2f74db',
      brightMagenta: '#a24fc4',
      brightCyan: '#119a90',
      brightWhite: '#ffffff',
    }),
  },
  // Plain console colors.
  classic: {
    dark: theme({
      background: '#000000',
      foreground: '#d0d0d0',
      cursor: '#d0d0d0',
      selection: '#ffffff44',
      black: '#000000',
      red: '#c23621',
      green: '#25bc24',
      yellow: '#adad27',
      blue: '#492ee1',
      magenta: '#d338d3',
      cyan: '#33bbc8',
      white: '#cbcccd',
      brightBlack: '#818383',
      brightRed: '#fc391f',
      brightGreen: '#31e722',
      brightYellow: '#eaec23',
      brightBlue: '#5833ff',
      brightMagenta: '#f935f8',
      brightCyan: '#14f0f0',
      brightWhite: '#e9ebeb',
    }),
    light: theme({
      background: '#ffffff',
      foreground: '#000000',
      cursor: '#000000',
      selection: '#0000ff33',
      black: '#000000',
      red: '#b21818',
      green: '#18a218',
      yellow: '#9a7600',
      blue: '#1818b2',
      magenta: '#b218b2',
      cyan: '#18a2a2',
      white: '#a8a8a8',
      brightBlack: '#686868',
      brightRed: '#e01c1c',
      brightGreen: '#1fbf1f',
      brightYellow: '#b89200',
      brightBlue: '#2a2aff',
      brightMagenta: '#d61fd6',
      brightCyan: '#1cb8b8',
      brightWhite: '#ffffff',
    }),
  },
  // Lower contrast for long sessions.
  soft: {
    dark: theme({
      background: '#22242e',
      foreground: '#c6c8d2',
      cursor: '#e0b77a',
      selection: '#e0b77a40',
      black: '#2c2f3a',
      red: '#d9878a',
      green: '#9cc38f',
      yellow: '#d8bd84',
      blue: '#8aa7d6',
      magenta: '#b9a0d4',
      cyan: '#86bdbc',
      white: '#b4b6c0',
      brightBlack: '#5f6373',
      brightRed: '#e6a1a3',
      brightGreen: '#b2d4a6',
      brightYellow: '#e6cf9e',
      brightBlue: '#a5bce2',
      brightMagenta: '#cbb6e2',
      brightCyan: '#a0cfce',
      brightWhite: '#dcdee6',
    }),
    light: theme({
      background: '#f5f2ea',
      foreground: '#3d3b36',
      cursor: '#9a6b2f',
      selection: '#9a6b2f33',
      black: '#3d3b36',
      red: '#a8484c',
      green: '#4f7a3f',
      yellow: '#8a6a24',
      blue: '#3e5f94',
      magenta: '#7a528f',
      cyan: '#3d7674',
      white: '#c9c4b8',
      brightBlack: '#77736a',
      brightRed: '#bf5a5e',
      brightGreen: '#5e8f4c',
      brightYellow: '#a07c2c',
      brightBlue: '#4f72aa',
      brightMagenta: '#8e64a4',
      brightCyan: '#4b8b88',
      brightWhite: '#fffdf8',
    }),
  },
  // Maximum contrast for low vision and bright rooms.
  contrast: {
    dark: theme({
      background: '#000000',
      foreground: '#ffffff',
      cursor: '#ffff00',
      selection: '#ffff0066',
      black: '#000000',
      red: '#ff5555',
      green: '#55ff55',
      yellow: '#ffff55',
      blue: '#66aaff',
      magenta: '#ff66ff',
      cyan: '#55ffff',
      white: '#ffffff',
      brightBlack: '#a0a0a0',
      brightRed: '#ff8080',
      brightGreen: '#80ff80',
      brightYellow: '#ffff80',
      brightBlue: '#99c4ff',
      brightMagenta: '#ff99ff',
      brightCyan: '#80ffff',
      brightWhite: '#ffffff',
    }),
    light: theme({
      background: '#ffffff',
      foreground: '#000000',
      cursor: '#0000c0',
      selection: '#0000c040',
      black: '#000000',
      red: '#a00000',
      green: '#005f00',
      yellow: '#6b4f00',
      blue: '#0000c0',
      magenta: '#8b008b',
      cyan: '#00605f',
      white: '#505050',
      brightBlack: '#303030',
      brightRed: '#c00000',
      brightGreen: '#007000',
      brightYellow: '#7a5a00',
      brightBlue: '#0000e0',
      brightMagenta: '#a000a0',
      brightCyan: '#007070',
      brightWhite: '#000000',
    }),
  },
}
