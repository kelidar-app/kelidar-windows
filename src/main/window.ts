import path from 'node:path'
import { app, BrowserWindow, nativeTheme, screen, type Rectangle } from 'electron'
import { APP, TITLE_BAR_HEIGHT } from '@shared/app'
import type { WindowState } from '@shared/settings'
import type { SettingsStore } from './settings/store'

const DEFAULT_SIZE = { width: 1200, height: 760 }
const MIN_SIZE = { width: 720, height: 480 }
/** How long to wait for the renderer's title bar colors before showing the window anyway. */
const SHOW_FALLBACK_MS = 1500

export interface MainWindowOptions {
  settings: SettingsStore
  /** app://<host>/index.html, or the Vite dev server URL in development. */
  rendererUrl: string
  preloadPath: string
}

function isVisibleOnSomeDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX =
      Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
      Math.max(bounds.x, workArea.x)
    const overlapY =
      Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
      Math.max(bounds.y, workArea.y)
    return overlapX >= 100 && overlapY >= 50
  })
}

function initialBounds(saved: WindowState | undefined): Partial<Rectangle> {
  if (saved === undefined) return DEFAULT_SIZE
  const size = { width: saved.width, height: saved.height }
  if (saved.x === undefined || saved.y === undefined) return size
  const bounds = { ...size, x: saved.x, y: saved.y }
  return isVisibleOnSomeDisplay(bounds) ? bounds : size
}

export function createMainWindow(options: MainWindowOptions): {
  win: BrowserWindow
  markTitleBarColored: () => void
} {
  const saved = options.settings.get().window
  const dark = nativeTheme.shouldUseDarkColors

  const win = new BrowserWindow({
    ...initialBounds(saved),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: APP.name,
    show: false,
    // The title bar is drawn by the renderer; Windows keeps the native
    // minimize/maximize/close buttons (and Snap Layouts) in an overlay.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      // Placeholder until the renderer sends the colors from its design tokens;
      // the window stays hidden until then.
      color: dark ? '#000000' : '#ffffff',
      symbolColor: dark ? '#ffffff' : '#000000',
      height: TITLE_BAR_HEIGHT,
    },
    ...(app.isPackaged ? {} : { icon: path.join(app.getAppPath(), 'resources', 'icon.png') }),
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  })

  let shown = false
  let painted = false
  let colored = false
  const show = (): void => {
    if (shown || win.isDestroyed()) return
    shown = true
    if (saved?.maximized === true) win.maximize()
    win.show()
  }
  const maybeShow = (): void => {
    if (painted && colored) show()
  }
  win.once('ready-to-show', () => {
    painted = true
    maybeShow()
    setTimeout(show, SHOW_FALLBACK_MS)
  })

  win.on('close', () => {
    const bounds = win.getNormalBounds()
    void options.settings
      .setWindowState({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: win.isMaximized(),
      })
      .catch(() => undefined)
  })

  void win.loadURL(options.rendererUrl)

  return {
    win,
    /** Called once the renderer has painted the title bar overlay in its own colors. */
    markTitleBarColored: (): void => {
      colored = true
      maybeShow()
    },
  }
}

export type MainWindow = ReturnType<typeof createMainWindow>
