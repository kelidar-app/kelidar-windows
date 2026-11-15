import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@renderer/lib/api'
import { onSessionData } from '@renderer/lib/session-events'
import { usePrefersDark } from '@renderer/lib/use-prefers-dark'
import { useSettingsStore } from '@renderer/stores/settings'
import { tabTitle, type TerminalTab } from '@renderer/stores/tabs'
import { registerTerminal } from './terminal-registry'
import { TERMINAL_THEMES } from './themes'
import { installXtermStyleShim } from './xterm-csp'

/** GPU rendering when available; xterm falls back to its DOM renderer otherwise. */
function loadWebgl(term: Terminal): void {
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => {
      webgl.dispose()
    })
    term.loadAddon(webgl)
  } catch {
    // No WebGL2 (old GPU driver, remote desktop): the DOM renderer still works.
  }
}

/**
 * One xterm.js terminal bound to a tab. It stays mounted while other tabs are
 * shown so its scrollback survives; when the tab reconnects, it switches to
 * the new session and prints a divider.
 */
export function TerminalView({ tab, active }: { tab: TerminalTab; active: boolean }) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionRef = useRef(tab.sessionId)
  const readyRef = useRef(tab.state === 'ready')
  const dark = usePrefersDark()
  const themeId = useSettingsStore((state) => state.settings.terminalTheme)
  const theme = dark ? TERMINAL_THEMES[themeId].dark : TERMINAL_THEMES[themeId].light

  useEffect(() => {
    sessionRef.current = tab.sessionId
    readyRef.current = tab.state === 'ready'
  }, [tab.sessionId, tab.state])

  // Create the terminal once.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    installXtermStyleShim()
    const term = new Terminal({
      allowProposedApi: true,
      fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace",
      fontSize: 14,
      lineHeight: 1.1,
      cursorBlink: true,
      scrollback: 10_000,
      // No clipboard addon: a server cannot write to the clipboard (OSC 52).
      rightClickSelectsWord: false,
      macOptionIsMeta: false,
      theme: TERMINAL_THEMES.kelidar.dark,
      minimumContrastRatio: 1,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new UnicodeGraphemesAddon())
    term.unicode.activeVersion = '15-graphemes'
    term.open(container)
    loadWebgl(term)
    termRef.current = term
    fitRef.current = fit

    const paste = async (): Promise<void> => {
      if (!readyRef.current) return
      const result = await api.invoke('clipboard:readText')
      if (result.ok && result.data.text !== '') term.paste(result.data.text)
      term.focus()
    }

    const subscriptions = [
      term.onData((data) => {
        if (readyRef.current) {
          void api.invoke('session:input', { sessionId: sessionRef.current, data })
        }
      }),
      term.onResize(({ cols, rows }) => {
        void api.invoke('session:resize', { sessionId: sessionRef.current, cols, rows })
      }),
      // Copy on select.
      term.onSelectionChange(() => {
        const text = term.getSelection()
        if (text !== '') void api.invoke('clipboard:writeText', { text })
      }),
    ]

    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault()
      void paste()
    }
    container.addEventListener('contextmenu', onContextMenu)
    const unregister = registerTerminal(tab.id, {
      paste: () => {
        void paste()
      },
      focus: () => {
        term.focus()
      },
    })

    return () => {
      unregister()
      container.removeEventListener('contextmenu', onContextMenu)
      for (const subscription of subscriptions) subscription.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [tab.id])

  // Route this session's output into the terminal; acknowledge what was drawn.
  useEffect(() => {
    const term = termRef.current
    if (term === null) return
    const sessionId = tab.sessionId
    // A new session (after reconnecting) starts at 80x24 in main: send our size.
    void api.invoke('session:resize', { sessionId, cols: term.cols, rows: term.rows })
    return onSessionData(sessionId, (data) => {
      term.write(data, () => {
        void api.invoke('session:ack', { sessionId, bytes: data.length })
      })
    })
  }, [tab.sessionId])

  useEffect(() => {
    if (tab.generation > 0) {
      termRef.current?.write(`\r\n\x1b[2m── ${t('terminal.reconnected')} ──\x1b[0m\r\n`)
    }
  }, [tab.generation, t])

  useEffect(() => {
    const term = termRef.current
    if (term !== null) term.options.theme = theme
  }, [theme])

  // Focus the terminal once it is connected (a dialog may have had focus).
  useEffect(() => {
    if (active && tab.state === 'ready') termRef.current?.focus()
  }, [active, tab.state])

  // Fit to the container while visible.
  useEffect(() => {
    const container = containerRef.current
    const term = termRef.current
    if (!active || container === null || term === null) return
    let frame = 0
    const fit = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (container.clientWidth > 0 && container.clientHeight > 0) fitRef.current?.fit()
      })
    }
    const observer = new ResizeObserver(fit)
    observer.observe(container)
    fit()
    term.focus()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [active])

  return (
    <div
      ref={containerRef}
      dir="ltr"
      role="group"
      aria-label={t('terminal.label', { title: tabTitle(tab) })}
      data-terminal={tab.id}
      className="min-h-0 flex-1 p-2"
      style={{ backgroundColor: theme.background }}
    />
  )
}
