import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from '@shared/settings'
import { api } from '@renderer/lib/api'
import { onSessionData } from '@renderer/lib/session-events'
import { usePrefersDark } from '@renderer/lib/use-prefers-dark'
import { useSettingsStore } from '@renderer/stores/settings'
import { useTabsStore, type Pane } from '@renderer/stores/tabs'
import { isMultiLine, useTerminalUiStore } from '@renderer/stores/terminal-ui'
import { registerTerminal } from './terminal-registry'
import { TERMINAL_THEMES } from './themes'
import { usePaneEnvironment } from './use-environment'
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

/** Only plain web links open, and only with Ctrl held (main checks the URL again). */
function isWebLink(uri: string): boolean {
  return /^https?:\/\//i.test(uri)
}

/**
 * One xterm.js terminal bound to a pane. It stays mounted while other tabs are
 * shown so its scrollback survives; when the pane reconnects, it switches to
 * the new session and prints a divider.
 */
export function TerminalView({
  pane,
  visible,
  focused,
}: {
  pane: Pane
  visible: boolean
  focused: boolean
}) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null)
  const sessionRef = useRef(pane.sessionId)
  const readyRef = useRef(pane.state === 'ready')
  const environment = usePaneEnvironment(pane)
  const productionRef = useRef(environment === 'production')
  const dark = usePrefersDark()
  const settings = useSettingsStore((state) => state.settings)
  const zoom = useTerminalUiStore((state) => state.zoom)
  const theme = dark
    ? TERMINAL_THEMES[settings.terminalTheme].dark
    : TERMINAL_THEMES[settings.terminalTheme].light
  const fontSize = Math.min(
    MAX_FONT_SIZE + 16,
    Math.max(MIN_FONT_SIZE - 2, settings.terminalFontSize + zoom),
  )
  const [searchOpen, setSearchOpen] = useState(false)
  const [linkHover, setLinkHover] = useState(false)

  useEffect(() => {
    sessionRef.current = pane.sessionId
    readyRef.current = pane.state === 'ready'
    productionRef.current = environment === 'production'
  }, [pane.sessionId, pane.state, environment])

  // Create the terminal once.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    installXtermStyleShim()
    const { settings: initial } = useSettingsStore.getState()
    const term = new Terminal({
      allowProposedApi: true,
      fontFamily: initial.terminalFontFamily,
      fontSize: initial.terminalFontSize + useTerminalUiStore.getState().zoom,
      lineHeight: initial.terminalLineHeight,
      cursorBlink: true,
      scrollback: 10_000,
      // No clipboard addon: a server cannot write to the clipboard (OSC 52).
      rightClickSelectsWord: false,
      macOptionIsMeta: false,
      theme: TERMINAL_THEMES.kelidar.dark,
      minimumContrastRatio: 1,
    })
    const fit = new FitAddon()
    const search = new SearchAddon({ highlightLimit: 1000 })
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(new UnicodeGraphemesAddon())
    term.unicode.activeVersion = '15-graphemes'
    term.loadAddon(
      new WebLinksAddon(
        (event, uri) => {
          // Ctrl+click only, so a click to place the cursor never opens a browser.
          if (!event.ctrlKey || !isWebLink(uri)) return
          void api.invoke('app:openExternal', { url: uri })
        },
        {
          hover: () => {
            setLinkHover(true)
          },
          leave: () => {
            setLinkHover(false)
          },
        },
      ),
    )
    term.open(container)
    loadWebgl(term)
    termRef.current = term
    fitRef.current = fit
    searchRef.current = search
    setSearchAddon(search)

    // Ctrl+wheel zooms every terminal, like Ctrl+= and Ctrl+-.
    term.attachCustomWheelEventHandler((event) => {
      if (!event.ctrlKey) return true
      event.preventDefault()
      useTerminalUiStore.getState().zoomBy(event.deltaY < 0 ? 1 : -1)
      return false
    })

    /**
     * Text with line breaks runs as soon as it reaches the shell, so it is
     * shown first: always on production hosts, else when the guard is on.
     */
    // Read anew after each await: the session may have dropped meanwhile.
    const isReady = (): boolean => readyRef.current
    const paste = async (): Promise<void> => {
      if (!readyRef.current) return
      const result = await api.invoke('clipboard:readText')
      if (!result.ok || result.data.text === '') return
      const text = result.data.text
      const production = productionRef.current
      if (isMultiLine(text) && (production || useSettingsStore.getState().settings.pasteGuard)) {
        const confirmed = await useTerminalUiStore
          .getState()
          .askPaste({ paneId: pane.id, text, production })
        if (!confirmed || !isReady()) {
          term.focus()
          return
        }
      }
      term.paste(text)
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
    // A click in a pane makes it the focused one.
    const onFocusIn = (): void => {
      useTabsStore.getState().focusPane(pane.id)
    }
    container.addEventListener('contextmenu', onContextMenu)
    container.addEventListener('focusin', onFocusIn)
    const unregister = registerTerminal(pane.id, {
      paste: () => {
        void paste()
      },
      focus: () => {
        term.focus()
      },
      openSearch: () => {
        setSearchOpen(true)
      },
    })

    return () => {
      unregister()
      container.removeEventListener('contextmenu', onContextMenu)
      container.removeEventListener('focusin', onFocusIn)
      for (const subscription of subscriptions) subscription.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      searchRef.current = null
    }
  }, [pane.id])

  // Route this session's output into the terminal; acknowledge what was drawn.
  useEffect(() => {
    const term = termRef.current
    if (term === null) return
    const sessionId = pane.sessionId
    // A new session (after reconnecting) starts at 80x24 in main: send our size.
    void api.invoke('session:resize', { sessionId, cols: term.cols, rows: term.rows })
    return onSessionData(sessionId, (data) => {
      term.write(data, () => {
        void api.invoke('session:ack', { sessionId, bytes: data.length })
      })
    })
  }, [pane.sessionId])

  useEffect(() => {
    if (pane.generation > 0) {
      termRef.current?.write(`\r\n\x1b[2m── ${t('terminal.reconnected')} ──\x1b[0m\r\n`)
    }
  }, [pane.generation, t])

  useEffect(() => {
    const term = termRef.current
    if (term !== null) term.options.theme = theme
  }, [theme])

  // Font settings and zoom; the fit below adjusts columns and rows.
  useEffect(() => {
    const term = termRef.current
    if (term === null) return
    term.options.fontFamily = settings.terminalFontFamily
    term.options.fontSize = fontSize
    term.options.lineHeight = settings.terminalLineHeight
    if (visible) fitRef.current?.fit()
  }, [settings.terminalFontFamily, settings.terminalLineHeight, fontSize, visible])

  // Focus the terminal of the focused pane once it is connected.
  useEffect(() => {
    if (visible && focused && pane.state === 'ready' && !searchOpen) termRef.current?.focus()
  }, [visible, focused, pane.state, searchOpen])

  // Fit to the container while visible.
  useEffect(() => {
    const container = containerRef.current
    if (!visible || container === null || termRef.current === null) return
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
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [visible])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {searchOpen && (
        <SearchBar
          search={searchAddon}
          onClose={() => {
            searchRef.current?.clearDecorations()
            setSearchOpen(false)
            termRef.current?.focus()
          }}
        />
      )}
      <div
        ref={containerRef}
        dir="ltr"
        role="group"
        aria-label={t('terminal.label', { title: pane.title })}
        title={linkHover ? t('terminal.linkHint') : undefined}
        data-terminal={pane.id}
        className="min-h-0 flex-1 p-2"
        style={{ backgroundColor: theme.background }}
      />
    </div>
  )
}

const DECORATIONS = {
  matchBackground: '#a0782866',
  matchBorder: '#a07828',
  matchOverviewRuler: '#a07828',
  activeMatchBackground: '#f59e0b',
  activeMatchBorder: '#f59e0b',
  activeMatchColorOverviewRuler: '#f59e0b',
} as const

/** Search in the scrollback: Enter for the next match, Shift+Enter for the previous one. */
function SearchBar({ search, onClose }: { search: SearchAddon | null; onClose: () => void }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ index: number; count: number } | null>(null)

  useEffect(() => {
    if (search === null) return
    const subscription = search.onDidChangeResults(({ resultIndex, resultCount }) => {
      setResults({ index: resultIndex, count: resultCount })
    })
    return () => {
      subscription.dispose()
    }
  }, [search])

  const find = (direction: 'next' | 'previous', text = query): void => {
    if (search === null) return
    if (text === '') {
      search.clearDecorations()
      setResults(null)
      return
    }
    const options = { decorations: DECORATIONS, incremental: false }
    if (direction === 'next') search.findNext(text, options)
    else search.findPrevious(text, options)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      find(event.shiftKey ? 'previous' : 'next')
    }
  }

  const status =
    results === null || query === ''
      ? ''
      : results.count === 0
        ? t('terminal.searchNone')
        : t('terminal.searchCount', {
            index: results.index < 0 ? 0 : results.index + 1,
            count: results.count,
          })

  return (
    <div
      role="search"
      className="absolute end-4 top-2 z-10 flex items-center gap-1 rounded-md border border-border bg-card p-1 shadow-md"
    >
      <input
        aria-label={t('terminal.search')}
        autoFocus
        value={query}
        placeholder={t('terminal.search')}
        spellCheck={false}
        className="h-7 w-52 rounded border border-input bg-background px-2 text-sm"
        onChange={(event) => {
          setQuery(event.target.value)
          find('next', event.target.value)
        }}
        onKeyDown={onKeyDown}
      />
      <span role="status" className="min-w-16 px-1 text-center text-xs text-muted-foreground">
        {status}
      </span>
      <button
        type="button"
        aria-label={t('terminal.searchPrevious')}
        title={t('terminal.searchPrevious')}
        className="rounded p-1 hover:bg-muted"
        onClick={() => {
          find('previous')
        }}
      >
        <ChevronUp aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        aria-label={t('terminal.searchNext')}
        title={t('terminal.searchNext')}
        className="rounded p-1 hover:bg-muted"
        onClick={() => {
          find('next')
        }}
      >
        <ChevronDown aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        aria-label={t('common.close')}
        className="rounded p-1 hover:bg-muted"
        onClick={onClose}
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  )
}
