import type { ITheme } from '@xterm/xterm'

/** A terminal theme with a light and a dark variant; the app picks one to match Windows. */
export interface TerminalTheme {
  light: ITheme
  dark: ITheme
}

export const DEFAULT_TERMINAL_THEME: TerminalTheme = {
  dark: {
    background: '#141417',
    foreground: '#e4e4e9',
    cursor: '#2dd4bf',
    cursorAccent: '#141417',
    selectionBackground: '#2dd4bf55',
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
  },
  light: {
    background: '#fbfbfc',
    foreground: '#1f1f24',
    cursor: '#0f766e',
    cursorAccent: '#fbfbfc',
    selectionBackground: '#0f766e33',
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
  },
}
